"""Phase 6 group E: end-to-end integration (task 5.1).

Drives the full materialization chain over the REAL HTTP surface, hermetic (no
LLM, no network — materialize is deterministic and Asset-free):

    (confirmed spec + plans, at SLIDE_PLAN_REVIEW)
    -> POST slides/plans/confirm            (confirm the plans over HTTP)
    -> POST transitions {to: SLIDE_GENERATION}   (real Group B forward edge)
    -> POST slides/materialize              (materialize the Presentation)
    -> GET  presentation                    (read it back over HTTP)

Group C (test_presentation.py) covers the materialize service unit-by-unit by
poking state directly onto the store. This module's job is the *continuous chain*
through transitions + GET endpoints: driving the state with the /transitions
endpoint and reading the product back with the GET endpoint. Sub-scenarios that
overlap Group C (None-safe reject, rollback clear, wrong-state, unmaterialized
GET) are re-asserted here as e2e paths, not deleted from Group C.
"""

from __future__ import annotations

from app.shared_schema_adapter import validate_shared_schema_entity

# Confirmed, valid PresentationSpec (a complete spec so the embedded
# validatePresentationSpec cross-check inside validatePresentation passes).
_SPEC = {
    "id": "spec_e2e_corporate",
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


def _plan(slide_id: str, *, visual_intent: str, key_message: str) -> dict:
    return {
        "slideId": slide_id,
        "title": f"Title for {slide_id}",
        "objective": "obj",
        "keyMessage": key_message,
        "contentIntent": "ci",
        "visualIntent": visual_intent,
        "layoutSuggestion": "title-and-body",
        "requiredAssets": ["asset_kept_on_source"],
        "riskNotes": [],
    }


_PLANS = [
    _plan("slide-0001", visual_intent="text", key_message="Baseline is stable"),
    _plan("slide-0002", visual_intent="chart", key_message="Utilization grew 60%"),
    _plan("slide-0003", visual_intent="image", key_message="Three investments unlock scale"),
]


def _seed_confirmed_plan_review(client, repo, *, spec=_SPEC, plans=_PLANS):
    """Create a project and land it at SLIDE_PLAN_REVIEW with a confirmed spec and
    (unconfirmed) plans on the store. The chain then confirms + transitions over HTTP."""

    pid = client.post("/api/projects", json={}).json()["projectId"]
    project = repo.get_project(pid)
    project.spec = None if spec is None else dict(spec)
    project.slidePlans = None if plans is None else [dict(p) for p in plans]
    project.slidePlansConfirmed = False
    project.state = "SLIDE_PLAN_REVIEW"
    return pid


def _types(repo, pid):
    return [e["type"] for e in repo.list_events(pid)]


# --------------------------------------------------------------------------- #
# 5.1 full chain: confirm plans -> transition -> materialize -> GET
# --------------------------------------------------------------------------- #


def test_e2e_confirm_transition_materialize_readback(client, repo):
    pid = _seed_confirmed_plan_review(client, repo)

    # Confirm the plans over HTTP.
    confirmed = client.post(f"/api/projects/{pid}/slides/plans/confirm", json={})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["slidePlansConfirmed"] is True

    # Drive the real Group B forward edge SLIDE_PLAN_REVIEW -> SLIDE_GENERATION.
    trans = client.post(f"/api/projects/{pid}/transitions", json={"to": "SLIDE_GENERATION"})
    assert trans.status_code == 200, trans.text
    assert trans.json()["status"] == "SLIDE_GENERATION"

    # Materialize over HTTP.
    mat = client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert mat.status_code == 200, mat.text
    pres = mat.json()

    # Read the persisted Presentation back over HTTP; must equal the materialized one.
    got = client.get(f"/api/projects/{pid}/presentation")
    assert got.status_code == 200, got.text
    assert got.json() == pres

    # The materialized Presentation passes FULL shared-schema validation
    # (per-slide Slide/Element/theme, id chains, scene==spec.scene).
    assert validate_shared_schema_entity("Presentation", pres).ok
    assert validate_shared_schema_entity("ThemeTokens", pres["theme"]).ok

    assert pres["id"] == f"pres_{pid}"
    assert pres["scene"] == _SPEC["scene"] == pres["spec"]["scene"]
    assert pres["assets"] == []  # no Assets this phase
    assert len(pres["slides"]) == 3
    for i, slide in enumerate(pres["slides"], start=1):
        assert slide["index"] == i  # 1-based
        assert slide["presentationId"] == pres["id"]
        assert slide["status"] == "planned"
        assert slide["id"] == slide["plan"]["slideId"]  # id chain
        assert slide["title"]  # non-empty
        assert slide["plan"]["requiredAssets"] == []  # forced empty on the copy
        assert all(el["slideId"] == slide["id"] for el in slide["elements"])
        # image intent falls to shape this phase (validateElement forbids image
        # without an assetId), so no element is ever type "image".
        assert all(el["type"] != "image" for el in slide["elements"])

    # image-intent slide materializes a shape placeholder.
    image_slide = [s for s in pres["slides"] if s["plan"]["visualIntent"] == "image"][0]
    visual = [el for el in image_slide["elements"] if el["id"].endswith("_visual")][0]
    assert visual["type"] == "shape"
    assert visual["content"]["placeholderFor"] == "image"

    # Event sequence over the whole chain: plan-confirm, the forward transition,
    # then the materialization event (state does not advance on materialize).
    assert _types(repo, pid) == [
        "SLIDE_PLAN_CONFIRMED",
        "WORKFLOW_STATE_CHANGED",
        "SLIDES_MATERIALIZED",
    ]
    assert repo.get_project(pid).state == "SLIDE_GENERATION"
    ev = repo.list_events(pid)[-1]
    assert ev["payload"] == {"slideCount": 3, "nextState": "SLIDE_GENERATION"}

    # Source plans keep their original requiredAssets (only the embedded copy empties).
    assert repo.get_project(pid).slidePlans[0]["requiredAssets"] == ["asset_kept_on_source"]


# --------------------------------------------------------------------------- #
# 5.1 e2e rejection / rollback paths (re-asserted through the HTTP endpoints)
# --------------------------------------------------------------------------- #


def _drive_to_slide_generation(client, repo, *, spec=_SPEC):
    """confirm plans + transition to SLIDE_GENERATION over HTTP; return pid."""
    pid = _seed_confirmed_plan_review(client, repo, spec=spec)
    client.post(f"/api/projects/{pid}/slides/plans/confirm", json={})
    client.post(f"/api/projects/{pid}/transitions", json={"to": "SLIDE_GENERATION"})
    return pid


def test_e2e_wrong_state_materialize_is_invalid_state_transition(client, repo):
    # Still in SLIDE_PLAN_REVIEW (never transitioned): materialize is a wrong-state
    # action -> INVALID_STATE_TRANSITION (409), field='to' cleared, zero side effect.
    pid = _seed_confirmed_plan_review(client, repo)
    client.post(f"/api/projects/{pid}/slides/plans/confirm", json={})
    resp = client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert resp.status_code == 409, resp.text
    data = resp.json()
    assert data["code"] == "INVALID_STATE_TRANSITION"
    assert data["error"] == "STATE_ERROR"
    assert data.get("details", {}).get("field") is None
    assert repo.get_project(pid).presentation is None
    assert "SLIDES_MATERIALIZED" not in _types(repo, pid)


def test_e2e_none_spec_is_none_safe_not_materializable(client, repo):
    # Spec is None but the project still reaches SLIDE_GENERATION by transition-only:
    # materialize must reject None-safely with SLIDES_NOT_MATERIALIZABLE (409).
    pid = _drive_to_slide_generation(client, repo, spec=None)
    resp = client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert resp.status_code == 409 and resp.json()["code"] == "SLIDES_NOT_MATERIALIZABLE"
    assert repo.get_project(pid).presentation is None
    assert "SLIDES_MATERIALIZED" not in _types(repo, pid)


def test_e2e_unconfirmed_spec_not_materializable(client, repo):
    pid = _drive_to_slide_generation(client, repo, spec={**_SPEC, "confirmedByUser": False})
    resp = client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert resp.status_code == 409 and resp.json()["code"] == "SLIDES_NOT_MATERIALIZABLE"
    assert "SLIDES_MATERIALIZED" not in _types(repo, pid)


def test_e2e_unmaterialized_get_is_404(client, repo):
    # Reached SLIDE_GENERATION but never materialized: GET -> PRESENTATION_NOT_FOUND.
    pid = _drive_to_slide_generation(client, repo)
    got = client.get(f"/api/projects/{pid}/presentation")
    assert got.status_code == 404 and got.json()["code"] == "PRESENTATION_NOT_FOUND"


def test_e2e_rollback_clears_presentation_get_becomes_404(client, repo):
    # Materialize, then roll back SLIDE_GENERATION -> SLIDE_PLAN_REVIEW over HTTP:
    # presentation is cleared (GET -> 404) while confirmed plans survive.
    pid = _drive_to_slide_generation(client, repo)
    client.post(f"/api/projects/{pid}/slides/materialize", json={})
    assert client.get(f"/api/projects/{pid}/presentation").status_code == 200

    back = client.post(f"/api/projects/{pid}/transitions", json={"to": "SLIDE_PLAN_REVIEW"})
    assert back.status_code == 200, back.text
    got = client.get(f"/api/projects/{pid}/presentation")
    assert got.status_code == 404 and got.json()["code"] == "PRESENTATION_NOT_FOUND"
    assert repo.get_project(pid).slidePlans is not None
    assert repo.get_project(pid).slidePlansConfirmed is True
