"""Phase 5 Outline group C tests (tasks 3.4 + 4.5).

Two layers, both hermetic (mock LLM, no network):
- agent: `build_outline` bounded repair, provider-failure -> LLM_PROVIDER_ERROR,
  validation-failure -> OUTLINE_VALIDATION_ERROR.
- service/API: three-state success, GET readback, precondition rejections,
  wrong-state -> INVALID_STATE_TRANSITION (no meaningless field="to"), None-safe
  inert generate, repeat-confirm replay safety, event sequence.
"""

from __future__ import annotations

import json

import pytest

import app.routes as routes
from app.agents import build_outline
from app.errors import LLMProviderError, OutlineValidationError
from app.llm import MockLLMProvider, mock_outline_response

_SPEC = {
    "id": "spec_1",
    "scene": "default",
    "styleProfileId": "style_default",
    "topic": "Testing",
    "confirmedByUser": True,
}


# --------------------------------------------------------------------------- #
# Agent layer (task 3.4)
# --------------------------------------------------------------------------- #


def test_build_outline_deterministic_mock_output():
    provider = MockLLMProvider(mock_outline_response)
    outline = build_outline(provider, _SPEC)
    # Runtime injects confirmedByUser regardless of what the model emitted.
    assert outline["confirmedByUser"] is False
    assert len(outline["sections"]) == 3
    assert outline["sections"][0]["title"] == "Introduction"
    # Deterministic: same programming -> identical output.
    again = build_outline(MockLLMProvider(mock_outline_response), _SPEC)
    assert again == outline


def test_build_outline_bounded_repair_recovers():
    bad = json.dumps({"sections": []})  # empty sections is invalid
    provider = MockLLMProvider([bad, mock_outline_response()])
    outline = build_outline(provider, _SPEC)
    assert len(outline["sections"]) == 3
    assert len(provider.calls) == 2  # one repair round


def test_build_outline_exhausted_raises_validation_error():
    bad = json.dumps({"sections": [{"title": "A", "purpose": "B", "estimatedSlides": 0}]})
    provider = MockLLMProvider([bad, bad])
    with pytest.raises(OutlineValidationError):
        build_outline(provider, _SPEC)


def test_build_outline_provider_transport_error_propagates():
    def boom(messages, *, model=None, response_format=None):
        raise LLMProviderError("upstream down")

    with pytest.raises(LLMProviderError):
        build_outline(MockLLMProvider(boom), _SPEC)


# --------------------------------------------------------------------------- #
# Service / API layer (task 4.5)
# --------------------------------------------------------------------------- #


@pytest.fixture
def outline_llm():
    routes._llm_provider = MockLLMProvider(mock_outline_response)
    yield
    routes._llm_provider = None


def _project_in_outline_generation(client, repo, *, spec=_SPEC) -> str:
    """Create a project and drop it into OUTLINE_GENERATION with the given spec
    directly on the store (hermetic: no requirement/spec LLM flow needed)."""

    pid = client.post("/api/projects", json={}).json()["projectId"]
    project = repo.get_project(pid)
    project.spec = None if spec is None else dict(spec)
    project.state = "OUTLINE_GENERATION"
    return pid


def _types(repo, pid):
    return [e["type"] for e in repo.list_events(pid)]


def test_generate_persists_outline_and_event(client, repo, outline_llm):
    pid = _project_in_outline_generation(client, repo)
    resp = client.post(f"/api/projects/{pid}/outline/generate", json={})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["confirmedByUser"] is False
    assert len(body["sections"]) == 3
    # Action does not advance the workflow state.
    assert repo.get_project(pid).state == "OUTLINE_GENERATION"
    assert _types(repo, pid) == ["OUTLINE_GENERATED"]
    ev = repo.list_events(pid)[-1]
    assert ev["actor"] == "ai"
    assert ev["payload"] == {"sectionCount": 3, "nextState": "OUTLINE_GENERATION"}


def test_generate_rejected_when_spec_unconfirmed(client, repo, outline_llm):
    pid = _project_in_outline_generation(
        client, repo, spec={**_SPEC, "confirmedByUser": False}
    )
    resp = client.post(f"/api/projects/{pid}/outline/generate", json={})
    assert resp.status_code == 409 and resp.json()["code"] == "OUTLINE_NOT_CONFIRMABLE"
    assert repo.get_project(pid).outline is None
    assert _types(repo, pid) == []


def test_generate_none_spec_is_none_safe_not_confirmable(client, repo, outline_llm):
    pid = _project_in_outline_generation(client, repo, spec=None)
    resp = client.post(f"/api/projects/{pid}/outline/generate", json={})
    # Must not crash dereferencing None; stable OUTLINE_NOT_CONFIRMABLE.
    assert resp.status_code == 409 and resp.json()["code"] == "OUTLINE_NOT_CONFIRMABLE"
    assert repo.get_project(pid).outline is None
    assert _types(repo, pid) == []


def test_wrong_state_generate_is_invalid_state_transition(client, repo, outline_llm):
    # Fresh project is NEW_PROJECT, not OUTLINE_GENERATION.
    pid = client.post("/api/projects", json={}).json()["projectId"]
    resp = client.post(f"/api/projects/{pid}/outline/generate", json={})
    assert resp.status_code == 409, resp.text
    data = resp.json()
    assert data["code"] == "INVALID_STATE_TRANSITION"
    assert data["error"] == "STATE_ERROR"
    # The meaningless default field="to" must be cleared for action endpoints.
    assert data.get("details", {}).get("field") is None
    assert _types(repo, pid) == []


def test_three_state_success_and_get_readback(client, repo, outline_llm):
    pid = _project_in_outline_generation(client, repo)
    client.post(f"/api/projects/{pid}/outline/generate", json={})

    # GET reads back the persisted outline.
    got = client.get(f"/api/projects/{pid}/outline")
    assert got.status_code == 200 and len(got.json()["sections"]) == 3

    # Edit (whole-outline PUT) stays unconfirmed; allowed in OUTLINE_GENERATION.
    edited = {
        "sections": [{"title": "Only", "purpose": "One", "estimatedSlides": 4}],
        "confirmedByUser": True,  # must be forced back to False by the service
    }
    resp = client.put(f"/api/projects/{pid}/outline", json=edited)
    assert resp.status_code == 200, resp.text
    assert resp.json()["confirmedByUser"] is False
    assert len(resp.json()["sections"]) == 1

    # Move to review and confirm (confirm does NOT advance state).
    repo.get_project(pid).state = "OUTLINE_REVIEW"
    resp = client.post(f"/api/projects/{pid}/outline/confirm", json={})
    assert resp.status_code == 200 and resp.json()["confirmedByUser"] is True
    assert repo.get_project(pid).state == "OUTLINE_REVIEW"

    assert _types(repo, pid) == [
        "OUTLINE_GENERATED",
        "OUTLINE_UPDATED",
        "OUTLINE_CONFIRMED",
    ]


def test_update_rejects_invalid_outline_no_side_effect(client, repo, outline_llm):
    pid = _project_in_outline_generation(client, repo)
    client.post(f"/api/projects/{pid}/outline/generate", json={})
    before = repo.get_project(pid).outline
    before_events = len(repo.list_events(pid))

    resp = client.put(
        f"/api/projects/{pid}/outline",
        json={"sections": [], "confirmedByUser": False},  # empty sections invalid
    )
    assert resp.status_code == 400 and resp.json()["code"] == "OUTLINE_VALIDATION_ERROR"
    assert repo.get_project(pid).outline == before
    assert len(repo.list_events(pid)) == before_events


def test_confirm_without_outline_is_not_found(client, repo, outline_llm):
    pid = _project_in_outline_generation(client, repo)
    repo.get_project(pid).state = "OUTLINE_REVIEW"  # in review but never generated
    resp = client.post(f"/api/projects/{pid}/outline/confirm", json={})
    assert resp.status_code == 404 and resp.json()["code"] == "OUTLINE_NOT_FOUND"
    assert _types(repo, pid) == []


def test_get_without_outline_is_not_found(client, repo, outline_llm):
    pid = _project_in_outline_generation(client, repo)
    resp = client.get(f"/api/projects/{pid}/outline")
    assert resp.status_code == 404 and resp.json()["code"] == "OUTLINE_NOT_FOUND"


def test_repeat_confirm_replay_safe(client, repo, outline_llm):
    pid = _project_in_outline_generation(client, repo)
    client.post(f"/api/projects/{pid}/outline/generate", json={})
    repo.get_project(pid).state = "OUTLINE_REVIEW"

    for _ in range(2):
        resp = client.post(f"/api/projects/{pid}/outline/confirm", json={})
        assert resp.status_code == 200 and resp.json()["confirmedByUser"] is True

    assert repo.get_project(pid).state == "OUTLINE_REVIEW"
    assert repo.get_project(pid).outline["confirmedByUser"] is True
    # Replay-safe, non-idempotent: a second OUTLINE_CONFIRMED is allowed.
    assert _types(repo, pid) == [
        "OUTLINE_GENERATED",
        "OUTLINE_CONFIRMED",
        "OUTLINE_CONFIRMED",
    ]
