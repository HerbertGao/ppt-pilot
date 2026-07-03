"""Phase 5 Slide Plan group D tests (tasks 5.4 + 6.5).

Two layers, both hermetic (mock LLM, no network):
- agent: `plan_slides` deterministic output, bounded repair on out-of-enum
  visualIntent, over-cap rejection, provider-failure -> LLM_PROVIDER_ERROR.
- service/API: three-state success, GET readback, precondition rejections,
  wrong-state -> INVALID_STATE_TRANSITION, None-safe inert generate, PUT forces the
  path slideId (body id ignored), regenerate overwrites/voids confirmation+edits,
  repeat-confirm replay safety, event sequence + payloads.
"""

from __future__ import annotations

import json

import pytest

import app.routes as routes
from app.agents import plan_slides
from app.errors import LLMProviderError, SlidePlanValidationError
from app.llm import MockLLMProvider, mock_slide_plan_response

_SPEC = {
    "id": "spec_1",
    "scene": "default",
    "styleProfileId": "style_default",
    "topic": "Testing",
    "confirmedByUser": True,
}

# Confirmed outline: 2 + 3 + 1 = 6 pages under the deterministic mock.
_OUTLINE = {
    "id": "outline_1",
    "sections": [
        {"title": "Introduction", "purpose": "Set context", "estimatedSlides": 2},
        {"title": "Core Content", "purpose": "Explain ideas", "estimatedSlides": 3},
        {"title": "Summary", "purpose": "Recap", "estimatedSlides": 1},
    ],
    "confirmedByUser": True,
}

_VALID_PLAN = {
    "objective": "Edited objective",
    "keyMessage": "Edited key message",
    "contentIntent": "Edited content",
    "visualIntent": "chart",
    "layoutSuggestion": "split",
    "requiredAssets": [],
    "riskNotes": [],
}


def _one_page(*, visual_intent: str = "text") -> dict:
    return {
        "objective": "o",
        "keyMessage": "k",
        "contentIntent": "c",
        "visualIntent": visual_intent,
        "layoutSuggestion": "l",
        "requiredAssets": [],
        "riskNotes": [],
    }


def _sections_response(page_counts: list[int], *, visual_intent: str = "text") -> str:
    return json.dumps(
        {
            "sections": [
                {"slides": [_one_page(visual_intent=visual_intent) for _ in range(n)]}
                for n in page_counts
            ]
        }
    )


# --------------------------------------------------------------------------- #
# Agent layer (task 5.4)
# --------------------------------------------------------------------------- #


def test_plan_slides_deterministic_mock_output():
    provider = MockLLMProvider(mock_slide_plan_response)
    plans = plan_slides(provider, _OUTLINE, _SPEC, max_total_slides=60)
    assert [p["slideId"] for p in plans] == [
        "slide-0001",
        "slide-0002",
        "slide-0003",
        "slide-0004",
        "slide-0005",
        "slide-0006",
    ]
    assert all(p["visualIntent"] in {"text"} for p in plans)
    # No estimatedSlides mismatch under the matching mock -> no injected riskNote.
    assert all(p["riskNotes"] == [] for p in plans)
    again = plan_slides(
        MockLLMProvider(mock_slide_plan_response), _OUTLINE, _SPEC, max_total_slides=60
    )
    assert again == plans


def test_plan_slides_out_of_enum_repaired_then_recovers():
    # _OUTLINE has 3 sections, so responses must carry 3 section groups (逐 section).
    bad = _sections_response([1, 1, 1], visual_intent="hologram")  # not in VisualIntent
    good = _sections_response([1, 1, 1])
    provider = MockLLMProvider([bad, good])
    plans = plan_slides(provider, _OUTLINE, _SPEC, max_total_slides=60)
    assert len(plans) == 3
    assert len(provider.calls) == 2  # one repair round


def test_plan_slides_out_of_enum_exhausted_raises_validation_error():
    bad = _sections_response([1, 1, 1], visual_intent="hologram")
    provider = MockLLMProvider([bad, bad])
    with pytest.raises(SlidePlanValidationError):
        plan_slides(provider, _OUTLINE, _SPEC, max_total_slides=60)


def test_plan_slides_over_cap_rejected():
    over = _sections_response([20, 20, 21])  # 61 > cap of 60, across the 3 outline sections
    provider = MockLLMProvider(over)  # str repeats every call, so repair can't help
    with pytest.raises(SlidePlanValidationError):
        plan_slides(provider, _OUTLINE, _SPEC, max_total_slides=60)


def test_plan_slides_empty_outline_rejected_not_500():
    # Defense-in-depth: even a (non-production) empty-section outline must map to a
    # validation error, never a slideCount=0 event -> 500.
    empty_outline = {"id": "o", "sections": [], "confirmedByUser": True}
    with pytest.raises(SlidePlanValidationError):
        plan_slides(MockLLMProvider(_sections_response([1])), empty_outline, _SPEC, max_total_slides=60)


def test_plan_slides_section_count_mismatch_rejected():
    # A 3-section outline whose plan output covers fewer sections must fail (no silent
    # under-coverage), not persist a partial plan set.
    under = _sections_response([1])  # 1 section group for a 3-section outline
    with pytest.raises(SlidePlanValidationError):
        plan_slides(MockLLMProvider(under), _OUTLINE, _SPEC, max_total_slides=60)


def test_plan_slides_mismatch_adds_soft_risk_note():
    # Section 1 estimated 2 but the mock returns 1 -> soft riskNote on its first page.
    resp = _sections_response([1, 3, 1])
    plans = plan_slides(MockLLMProvider(resp), _OUTLINE, _SPEC, max_total_slides=60)
    assert len(plans) == 5
    assert any("outline estimated 2" in note for note in plans[0]["riskNotes"])


def test_plan_slides_provider_transport_error_propagates():
    def boom(messages, *, model=None, response_format=None):
        raise LLMProviderError("upstream down")

    with pytest.raises(LLMProviderError):
        plan_slides(MockLLMProvider(boom), _OUTLINE, _SPEC, max_total_slides=60)


def test_plan_slides_empty_output_rejected_as_validation_error():
    # A degenerate provider (no sections, or every section zero pages) must raise a
    # validation error (-> 400), never return [] that would later trip slideCount=0.
    # [] exercises the section-count guard; [0,0,0] the per-section >=1-page guard.
    for empty in (_sections_response([]), _sections_response([0, 0, 0])):
        with pytest.raises(SlidePlanValidationError):
            plan_slides(MockLLMProvider(empty), _OUTLINE, _SPEC, max_total_slides=60)


def test_plan_slides_unparseable_json_repaired_then_recovers():
    provider = MockLLMProvider(["not json at all", _sections_response([1, 1, 1])])
    plans = plan_slides(provider, _OUTLINE, _SPEC, max_total_slides=60)
    assert len(plans) == 3 and len(provider.calls) == 2  # repaired the unparseable round


def test_plan_slides_unparseable_json_exhausted_raises_validation_error():
    provider = MockLLMProvider(["still not json", "also not json"])
    with pytest.raises(SlidePlanValidationError):
        plan_slides(provider, _OUTLINE, _SPEC, max_total_slides=60)


# --------------------------------------------------------------------------- #
# Service / API layer (task 6.5)
# --------------------------------------------------------------------------- #


@pytest.fixture
def plan_llm():
    routes._llm_provider = MockLLMProvider(mock_slide_plan_response)
    yield
    routes._llm_provider = None


def _project_in_slide_planning(client, repo, *, outline=_OUTLINE, spec=_SPEC) -> str:
    """Create a project and drop it into SLIDE_PLANNING with the given outline/spec
    directly on the store (hermetic: no upstream requirement/outline flow needed)."""

    pid = client.post("/api/projects", json={}).json()["projectId"]
    project = repo.get_project(pid)
    project.spec = None if spec is None else dict(spec)
    project.outline = None if outline is None else dict(outline)
    project.state = "SLIDE_PLANNING"
    return pid


def _types(repo, pid):
    return [e["type"] for e in repo.list_events(pid)]


def test_generate_persists_plans_and_event(client, repo, plan_llm):
    pid = _project_in_slide_planning(client, repo)
    resp = client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["slidePlansConfirmed"] is False
    assert [p["slideId"] for p in body["slidePlans"]] == [f"slide-{i:04d}" for i in range(1, 7)]
    # Action does not advance the workflow state.
    assert repo.get_project(pid).state == "SLIDE_PLANNING"
    assert _types(repo, pid) == ["SLIDE_PLAN_GENERATED"]
    ev = repo.list_events(pid)[-1]
    assert ev["actor"] == "ai"
    assert ev["payload"] == {
        "slideCount": 6,
        "slideIds": [f"slide-{i:04d}" for i in range(1, 7)],
        "nextState": "SLIDE_PLANNING",
    }


def test_generate_rejected_when_outline_unconfirmed(client, repo, plan_llm):
    pid = _project_in_slide_planning(
        client, repo, outline={**_OUTLINE, "confirmedByUser": False}
    )
    resp = client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
    assert resp.status_code == 409 and resp.json()["code"] == "SLIDE_PLAN_NOT_CONFIRMABLE"


def test_generate_empty_provider_output_is_400_not_500(client, repo):
    # A degenerate provider that returns no pages must surface as a mapped
    # SLIDE_PLAN_VALIDATION_ERROR (400), never a 500 from a slideCount=0 event.
    routes._llm_provider = MockLLMProvider(_sections_response([]))
    try:
        pid = _project_in_slide_planning(client, repo)
        resp = client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
        assert resp.status_code == 400, resp.text
        assert resp.json()["code"] == "SLIDE_PLAN_VALIDATION_ERROR"
        # Zero-persist: no plans stored, no event appended.
        assert repo.get_project(pid).slidePlans is None
        assert _types(repo, pid) == []
    finally:
        routes._llm_provider = None
    assert repo.get_project(pid).slidePlans is None
    assert _types(repo, pid) == []


def test_generate_none_outline_is_none_safe_not_confirmable(client, repo, plan_llm):
    pid = _project_in_slide_planning(client, repo, outline=None)
    resp = client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
    # Must not crash dereferencing None; stable SLIDE_PLAN_NOT_CONFIRMABLE.
    assert resp.status_code == 409 and resp.json()["code"] == "SLIDE_PLAN_NOT_CONFIRMABLE"
    assert repo.get_project(pid).slidePlans is None
    assert _types(repo, pid) == []


def test_wrong_state_generate_is_invalid_state_transition(client, repo, plan_llm):
    pid = client.post("/api/projects", json={}).json()["projectId"]  # NEW_PROJECT
    resp = client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
    assert resp.status_code == 409, resp.text
    data = resp.json()
    assert data["code"] == "INVALID_STATE_TRANSITION"
    assert data["error"] == "STATE_ERROR"
    assert data.get("details", {}).get("field") is None
    assert _types(repo, pid) == []


def test_three_state_success_and_get_readback(client, repo, plan_llm):
    pid = _project_in_slide_planning(client, repo)
    client.post(f"/api/projects/{pid}/slides/plans/generate", json={})

    got = client.get(f"/api/projects/{pid}/slides/plans")
    assert got.status_code == 200 and len(got.json()["slidePlans"]) == 6

    # Single-page edit (allowed in SLIDE_PLANNING).
    resp = client.put(f"/api/projects/{pid}/slides/slide-0002/plan", json=dict(_VALID_PLAN))
    assert resp.status_code == 200, resp.text
    edited = [p for p in resp.json()["slidePlans"] if p["slideId"] == "slide-0002"][0]
    assert edited["objective"] == "Edited objective"
    assert resp.json()["slidePlansConfirmed"] is False

    # Move to review and confirm (confirm does NOT advance state).
    repo.get_project(pid).state = "SLIDE_PLAN_REVIEW"
    resp = client.post(f"/api/projects/{pid}/slides/plans/confirm", json={})
    assert resp.status_code == 200 and resp.json()["slidePlansConfirmed"] is True
    assert repo.get_project(pid).state == "SLIDE_PLAN_REVIEW"

    assert _types(repo, pid) == [
        "SLIDE_PLAN_GENERATED",
        "SLIDE_PLAN_UPDATED",
        "SLIDE_PLAN_CONFIRMED",
    ]
    # Event payloads for update + confirm.
    events = repo.list_events(pid)
    assert events[1]["payload"] == {"slideId": "slide-0002", "nextState": "SLIDE_PLANNING"}
    assert events[2]["payload"] == {"slideCount": 6, "nextState": "SLIDE_PLAN_REVIEW"}


def test_update_forces_path_slide_id_ignoring_body(client, repo, plan_llm):
    pid = _project_in_slide_planning(client, repo)
    client.post(f"/api/projects/{pid}/slides/plans/generate", json={})

    # Body tries to smuggle a different slideId; the path value must win.
    body = {**_VALID_PLAN, "slideId": "slide-9999"}
    resp = client.put(f"/api/projects/{pid}/slides/slide-0002/plan", json=body)
    assert resp.status_code == 200, resp.text
    ids = [p["slideId"] for p in resp.json()["slidePlans"]]
    assert "slide-0002" in ids and "slide-9999" not in ids
    assert len(ids) == len(set(ids)) == 6  # still unique
    edited = [p for p in resp.json()["slidePlans"] if p["slideId"] == "slide-0002"][0]
    assert edited["objective"] == "Edited objective"


def test_update_unknown_slide_id_rejected(client, repo, plan_llm):
    pid = _project_in_slide_planning(client, repo)
    client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
    before = list(repo.get_project(pid).slidePlans)
    before_events = len(repo.list_events(pid))

    resp = client.put(f"/api/projects/{pid}/slides/slide-nope/plan", json=dict(_VALID_PLAN))
    assert resp.status_code == 404 and resp.json()["code"] == "SLIDE_PLAN_NOT_FOUND"
    assert repo.get_project(pid).slidePlans == before
    assert len(repo.list_events(pid)) == before_events


def test_update_rejects_invalid_plan_no_side_effect(client, repo, plan_llm):
    pid = _project_in_slide_planning(client, repo)
    client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
    before = list(repo.get_project(pid).slidePlans)
    before_events = len(repo.list_events(pid))

    bad = {**_VALID_PLAN, "visualIntent": "hologram"}  # out of enum
    resp = client.put(f"/api/projects/{pid}/slides/slide-0001/plan", json=bad)
    assert resp.status_code == 400 and resp.json()["code"] == "SLIDE_PLAN_VALIDATION_ERROR"
    assert repo.get_project(pid).slidePlans == before
    assert len(repo.list_events(pid)) == before_events


def test_regenerate_overwrites_and_voids_confirmation_and_edits(client, repo, plan_llm):
    pid = _project_in_slide_planning(client, repo)
    client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
    # Edit a page, then confirm at review.
    client.put(f"/api/projects/{pid}/slides/slide-0001/plan", json=dict(_VALID_PLAN))
    repo.get_project(pid).state = "SLIDE_PLAN_REVIEW"
    client.post(f"/api/projects/{pid}/slides/plans/confirm", json={})
    assert repo.get_project(pid).slidePlansConfirmed is True

    # Back to SLIDE_PLANNING and regenerate: overwrite voids confirmation + edit.
    repo.get_project(pid).state = "SLIDE_PLANNING"
    resp = client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
    assert resp.status_code == 200
    assert resp.json()["slidePlansConfirmed"] is False
    first = [p for p in resp.json()["slidePlans"] if p["slideId"] == "slide-0001"][0]
    assert first["objective"] != "Edited objective"  # fresh mock output, edit gone
    assert _types(repo, pid).count("SLIDE_PLAN_GENERATED") == 2


def test_confirm_without_plans_is_not_found(client, repo, plan_llm):
    pid = _project_in_slide_planning(client, repo)
    repo.get_project(pid).state = "SLIDE_PLAN_REVIEW"  # in review, never generated
    resp = client.post(f"/api/projects/{pid}/slides/plans/confirm", json={})
    assert resp.status_code == 404 and resp.json()["code"] == "SLIDE_PLAN_NOT_FOUND"
    assert _types(repo, pid) == []


def test_get_without_plans_is_not_found(client, repo, plan_llm):
    pid = _project_in_slide_planning(client, repo)
    resp = client.get(f"/api/projects/{pid}/slides/plans")
    assert resp.status_code == 404 and resp.json()["code"] == "SLIDE_PLAN_NOT_FOUND"


def test_repeat_confirm_replay_safe(client, repo, plan_llm):
    pid = _project_in_slide_planning(client, repo)
    client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
    repo.get_project(pid).state = "SLIDE_PLAN_REVIEW"

    for _ in range(2):
        resp = client.post(f"/api/projects/{pid}/slides/plans/confirm", json={})
        assert resp.status_code == 200 and resp.json()["slidePlansConfirmed"] is True

    assert repo.get_project(pid).state == "SLIDE_PLAN_REVIEW"
    assert repo.get_project(pid).slidePlansConfirmed is True
    assert _types(repo, pid) == [
        "SLIDE_PLAN_GENERATED",
        "SLIDE_PLAN_CONFIRMED",
        "SLIDE_PLAN_CONFIRMED",
    ]
