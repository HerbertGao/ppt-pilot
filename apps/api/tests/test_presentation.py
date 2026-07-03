"""Phase 6 slide-materialization group C tests (task 3.7).

Hermetic (no LLM/network): the service is deterministic and Asset-free. Covers
materialize success (per-slide elements/theme/event + the produced Presentation
passing validateEntity("Presentation")), GET readback, precondition rejections
(unconfirmed/empty plans, None-safe unconfirmed spec) -> SLIDES_NOT_MATERIALIZABLE,
wrong-state -> INVALID_STATE_TRANSITION (no field="to"), a validation failure ->
SLIDE_VALIDATION_ERROR with zero persist, image intent -> shape element, repeat
materialize whole-set overwrite/replay safety, and rollback clearing presentation.
"""

from __future__ import annotations

from app.shared_schema_adapter import validate_shared_schema_entity

# Confirmed, valid PresentationSpec (mirrors the known-good materialized fixture spec).
_SPEC = {
    "id": "spec_c_corporate",
    "topic": "Quarterly Platform Roadmap",
    "audience": "engineering leadership",
    "purpose": "Align leadership on the next quarter of platform investments",
    "durationMinutes": 20,
    "slideCountTarget": 3,
    "language": "en-US",
    "tone": "confident",
    "scene": "corporate",
    "styleProfileId": "style_corporate_default",
    "questionPolicy": {"mode": "fast", "sceneThreshold": 0.75, "maxQuestions": 3},
    "riskNotes": [],
    "constraints": [],
    "sourceMaterials": [],
    "confirmedByUser": True,
}


def _plan(slide_id: str, *, visual_intent: str = "text", key_message: str = "km", **over) -> dict:
    plan = {
        "slideId": slide_id,
        "title": f"Title for {slide_id}",
        "objective": "obj",
        "keyMessage": key_message,
        "contentIntent": "ci",
        "visualIntent": visual_intent,
        "layoutSuggestion": "title-and-body",
        # Non-empty on the SOURCE plan to prove materialize forces the copy to [].
        "requiredAssets": ["asset_should_be_dropped"],
        "riskNotes": [],
    }
    plan.update(over)
    return plan


_PLANS = [
    _plan("slide-0001", visual_intent="text", key_message="Baseline is stable"),
    _plan("slide-0002", visual_intent="chart", key_message="Utilization grew 60%"),
    _plan("slide-0003", visual_intent="image", key_message="Three investments unlock scale"),
]


def _project_in_slide_generation(client, repo, *, spec=_SPEC, plans=_PLANS, confirmed=True) -> str:
    """Create a project and drop it into SLIDE_GENERATION with confirmed spec/plans
    directly on the store (hermetic: no upstream flow needed)."""

    pid = client.post("/api/projects", json={}).json()["projectId"]
    project = repo.get_project(pid)
    project.spec = None if spec is None else dict(spec)
    project.slidePlans = None if plans is None else [dict(p) for p in plans]
    project.slidePlansConfirmed = confirmed
    project.state = "SLIDE_GENERATION"
    return pid


def _types(repo, pid):
    return [e["type"] for e in repo.list_events(pid)]


def test_materialize_success_persists_valid_presentation_and_event(client, repo):
    pid = _project_in_slide_generation(client, repo)
    resp = client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert resp.status_code == 200, resp.text
    pres = resp.json()

    # The produced Presentation passes full shared-schema validation.
    assert validate_shared_schema_entity("Presentation", pres).ok

    assert pres["id"] == f"pres_{pid}"
    assert pres["scene"] == _SPEC["scene"] == pres["spec"]["scene"]
    assert pres["assets"] == []
    assert len(pres["slides"]) == 3
    for i, slide in enumerate(pres["slides"], start=1):
        assert slide["index"] == i
        assert slide["presentationId"] == pres["id"]
        assert slide["status"] == "planned"
        assert slide["id"] == slide["plan"]["slideId"]
        assert slide["title"]  # non-empty
        assert slide["plan"]["requiredAssets"] == []  # forced empty on the copy
        assert all(el["slideId"] == slide["id"] for el in slide["elements"])
        assert all(el["type"] != "image" for el in slide["elements"])

    # Theme is a valid ThemeTokens.
    assert validate_shared_schema_entity("ThemeTokens", pres["theme"]).ok

    # Action does not advance state; one validated event appended.
    assert repo.get_project(pid).state == "SLIDE_GENERATION"
    assert _types(repo, pid) == ["SLIDES_MATERIALIZED"]
    ev = repo.list_events(pid)[-1]
    assert ev["payload"] == {"slideCount": 3, "nextState": "SLIDE_GENERATION"}

    # Source plans keep their original requiredAssets (only the copy is emptied).
    assert repo.get_project(pid).slidePlans[0]["requiredAssets"] == ["asset_should_be_dropped"]


def test_get_presentation_readback(client, repo):
    pid = _project_in_slide_generation(client, repo)
    client.post(f"/api/projects/{pid}/slides/materialize", json={})
    got = client.get(f"/api/projects/{pid}/presentation")
    assert got.status_code == 200
    assert got.json()["id"] == f"pres_{pid}"
    assert len(got.json()["slides"]) == 3


def test_get_presentation_missing_is_404(client, repo):
    pid = _project_in_slide_generation(client, repo)  # not materialized yet
    got = client.get(f"/api/projects/{pid}/presentation")
    assert got.status_code == 404 and got.json()["code"] == "PRESENTATION_NOT_FOUND"


def test_image_intent_materializes_shape_element(client, repo):
    pid = _project_in_slide_generation(client, repo)
    pres = client.post(f"/api/projects/{pid}/slides/materialize", json={}).json()
    image_slide = [s for s in pres["slides"] if s["plan"]["visualIntent"] == "image"][0]
    visual = [el for el in image_slide["elements"] if el["id"].endswith("_visual")][0]
    assert visual["type"] == "shape"  # image -> shape this phase (no Asset)
    assert visual["content"]["placeholderFor"] == "image"


def test_unconfirmed_plans_rejected_not_materializable(client, repo):
    pid = _project_in_slide_generation(client, repo, confirmed=False)
    resp = client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert resp.status_code == 409 and resp.json()["code"] == "SLIDES_NOT_MATERIALIZABLE"
    assert repo.get_project(pid).presentation is None
    assert _types(repo, pid) == []


def test_empty_plans_rejected_not_materializable(client, repo):
    pid = _project_in_slide_generation(client, repo, plans=[])
    resp = client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert resp.status_code == 409 and resp.json()["code"] == "SLIDES_NOT_MATERIALIZABLE"
    assert _types(repo, pid) == []


def test_none_spec_is_none_safe_not_materializable(client, repo):
    pid = _project_in_slide_generation(client, repo, spec=None)
    resp = client.post(f"/api/projects/{pid}/slides/materialize", json={})
    # Must not crash dereferencing None; stable SLIDES_NOT_MATERIALIZABLE.
    assert resp.status_code == 409 and resp.json()["code"] == "SLIDES_NOT_MATERIALIZABLE"
    assert repo.get_project(pid).presentation is None
    assert _types(repo, pid) == []


def test_unconfirmed_spec_rejected_not_materializable(client, repo):
    pid = _project_in_slide_generation(
        client, repo, spec={**_SPEC, "confirmedByUser": False}
    )
    resp = client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert resp.status_code == 409 and resp.json()["code"] == "SLIDES_NOT_MATERIALIZABLE"
    assert _types(repo, pid) == []


def test_wrong_state_is_invalid_state_transition(client, repo):
    pid = _project_in_slide_generation(client, repo)
    repo.get_project(pid).state = "SLIDE_PLAN_REVIEW"  # not yet in SLIDE_GENERATION
    resp = client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert resp.status_code == 409, resp.text
    data = resp.json()
    assert data["code"] == "INVALID_STATE_TRANSITION"
    assert data["error"] == "STATE_ERROR"
    assert data.get("details", {}).get("field") is None
    assert repo.get_project(pid).presentation is None
    assert _types(repo, pid) == []


def test_validation_failure_is_400_zero_persist(client, repo):
    # Plans pass the slideId/keyMessage guard; a confirmed-but-malformed spec
    # (missing required `purpose`) makes the embedded PresentationSpec fail
    # validatePresentation -> exercises the validate-before-persist branch.
    bad_spec = {k: v for k, v in _SPEC.items() if k != "purpose"}
    pid = _project_in_slide_generation(client, repo, spec=bad_spec)
    resp = client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert resp.status_code == 400 and resp.json()["code"] == "SLIDE_VALIDATION_ERROR"
    # Zero persist: no presentation stored, no event appended.
    assert repo.get_project(pid).presentation is None
    assert _types(repo, pid) == []


def test_source_plan_missing_slideid_is_400_not_500(client, repo):
    # slideId is schema-optional; a stored plan lacking it must produce a clean 400
    # (guard before building slides), never a raw KeyError/500. Zero persist.
    bad = _plan("slide-0001")
    del bad["slideId"]
    pid = _project_in_slide_generation(client, repo, plans=[bad])
    resp = client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert resp.status_code == 400 and resp.json()["code"] == "SLIDE_VALIDATION_ERROR", resp.text
    assert repo.get_project(pid).presentation is None
    assert _types(repo, pid) == []


def test_repeat_materialize_overwrites_replay_safe(client, repo):
    pid = _project_in_slide_generation(client, repo)
    first = client.post(f"/api/projects/{pid}/slides/materialize", json={}).json()
    second = client.post(f"/api/projects/{pid}/slides/materialize", json={}).json()
    # Deterministic: identical output; whole-set overwrite; both events appended.
    assert first == second
    assert repo.get_project(pid).presentation["id"] == f"pres_{pid}"
    assert _types(repo, pid) == ["SLIDES_MATERIALIZED", "SLIDES_MATERIALIZED"]


def test_rollback_clears_presentation(client, repo):
    pid = _project_in_slide_generation(client, repo)
    client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert repo.get_project(pid).presentation is not None

    # SLIDE_GENERATION -> SLIDE_PLAN_REVIEW rollback (Group B) clears presentation,
    # keeps the confirmed plans intact.
    resp = client.post(f"/api/projects/{pid}/transitions", json={"to": "SLIDE_PLAN_REVIEW"})
    assert resp.status_code == 200, resp.text
    assert repo.get_project(pid).presentation is None
    assert repo.get_project(pid).slidePlans is not None
    assert repo.get_project(pid).slidePlansConfirmed is True
