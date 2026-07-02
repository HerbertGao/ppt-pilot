"""Group E smoke tests: requirement/Spec HTTP surface end-to-end via the mock LLM.

Full contract coverage is group F; this drives the happy path plus the rejection
paths this group introduces (unknown questionId, invalid scene, confirm gating,
profile-after-confirm rollback), asserting the no-side-effect invariant.
"""

from __future__ import annotations

import json

import pytest

import app.routes as routes
from app.llm import MockLLMProvider


def _mock(messages, *, model, response_format):
    system = messages[0]["content"]
    user = messages[-1]["content"] if len(messages) > 1 else ""
    if "Requirement Discovery Agent" in system:
        # Confidence jumps once an answer is folded into the discovery context.
        confidence = 0.9 if '"answers"' in user else 0.4
        return json.dumps(
            {
                "known": {"topic": "AI safety", "language": "zh-CN"},
                "unknowns": ["audience"],
                "confidence": confidence,
            }
        )
    if "Requirement Gap Agent" in system:
        return json.dumps({"gaps": [{"field": "audience", "classification": "MUST_ASK"}]})
    if "Question Agent" in system:
        return json.dumps(
            {
                "questions": [
                    {
                        "field": "audience",
                        "prompt": "Who is the audience?",
                        "options": ["Kids", "Adults"],
                        "freeTextAllowed": True,
                    }
                ]
            }
        )
    if "Spec Builder Agent" in system:
        return json.dumps(
            {
                "topic": "AI safety",
                "audience": "Kids",
                "purpose": "Educate",
                "language": "zh-CN",
            }
        )
    raise AssertionError(f"no scripted reply for: {system[:40]!r}")


@pytest.fixture
def mock_llm():
    routes._llm_provider = MockLLMProvider(_mock)
    yield
    routes._llm_provider = None


def _new_project_in_discovery(client) -> str:
    pid = client.post("/api/projects", json={"scene": "education"}).json()["projectId"]
    client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_DISCOVERY"})
    return pid


def _to_review(client, pid: str) -> None:
    client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_REVIEW"})


def test_discover_returns_questions_and_confidence(client, repo, mock_llm):
    pid = _new_project_in_discovery(client)
    resp = client.post(f"/api/projects/{pid}/requirements/discover", json={})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["questions"][0]["questionId"] == "q_audience"
    assert data["confidence"] == 0.4
    assert data["threshold"] == 0.82
    assert data["thresholdReached"] is False
    assert data["nextState"] == "REQUIREMENT_DISCOVERY"

    # QUESTION_POLICY_APPLIED + one REQUIREMENT_QUESTION_ASKED (after the 1 transition).
    types = [e["type"] for e in repo.list_events(pid)]
    assert types == [
        "WORKFLOW_STATE_CHANGED",
        "QUESTION_POLICY_APPLIED",
        "REQUIREMENT_QUESTION_ASKED",
    ], types
    asked = repo.list_events(pid)[-1]
    assert asked["actor"] == "ai"
    assert asked["payload"]["confidenceBefore"] == 0.4
    assert asked["payload"]["options"] == ["Kids", "Adults"]


def test_discover_invalid_scene_rejected_no_side_effect(client, repo, mock_llm):
    pid = _new_project_in_discovery(client)
    before = len(repo.list_events(pid))
    resp = client.post(
        f"/api/projects/{pid}/requirements/discover", json={"scene": "education2"}
    )
    assert resp.status_code == 400 and resp.json()["code"] == "INVALID_SCENE", resp.text
    assert len(repo.list_events(pid)) == before
    assert repo.get_project(pid).discovery is None


def test_answer_updates_confidence_without_event(client, repo, mock_llm):
    pid = _new_project_in_discovery(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})
    before = len(repo.list_events(pid))

    resp = client.post(
        f"/api/projects/{pid}/requirements/questions/q_audience/answer",
        json={"answer": "Kids"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["confidence"] == 0.9
    assert data["thresholdReached"] is True
    # answer has no dedicated event type.
    assert len(repo.list_events(pid)) == before


def test_answer_unknown_question_not_found(client, repo, mock_llm):
    pid = _new_project_in_discovery(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})
    resp = client.post(
        f"/api/projects/{pid}/requirements/questions/q_bogus/answer",
        json={"answer": "x"},
    )
    assert resp.status_code == 404 and resp.json()["code"] == "QUESTION_NOT_FOUND"


def test_skip_records_risk_and_event(client, repo, mock_llm):
    pid = _new_project_in_discovery(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})
    resp = client.post(f"/api/projects/{pid}/requirements/questions/q_audience/skip", json={})
    assert resp.status_code == 200, resp.text
    assert resp.json()["skippedQuestionIds"] == ["q_audience"]
    last = repo.list_events(pid)[-1]
    assert last["type"] == "REQUIREMENT_QUESTION_SKIPPED"
    assert last["actor"] == "user"
    assert last["payload"]["questionId"] == "q_audience"
    assert "riskNote" in last["payload"]


def test_skip_unknown_question_not_found(client, repo, mock_llm):
    pid = _new_project_in_discovery(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})
    resp = client.post(f"/api/projects/{pid}/requirements/questions/q_bogus/skip", json={})
    assert resp.status_code == 404 and resp.json()["code"] == "QUESTION_NOT_FOUND"


def test_confirm_sets_flag_keeps_review_and_forward_edge_absent(client, repo, mock_llm):
    pid = _new_project_in_discovery(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})
    _to_review(client, pid)

    resp = client.post(f"/api/projects/{pid}/requirements/confirm", json={})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["confirmed"] is True
    assert data["nextState"] == "REQUIREMENT_REVIEW"
    assert data["presentationSpecId"]
    assert repo.get_project(pid).state == "REQUIREMENT_REVIEW"
    assert repo.list_events(pid)[-1]["type"] == "PRESENTATION_SPEC_CONFIRMED"

    # Forward edge to OUTLINE_GENERATION still does not exist post-confirm.
    resp = client.post(
        f"/api/projects/{pid}/transitions", json={"to": "OUTLINE_GENERATION"}
    )
    assert resp.status_code == 409 and resp.json()["code"] == "INVALID_STATE_TRANSITION"


def test_confirm_requires_review_state(client, repo, mock_llm):
    pid = _new_project_in_discovery(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})
    # Still in REQUIREMENT_DISCOVERY.
    resp = client.post(f"/api/projects/{pid}/requirements/confirm", json={})
    assert resp.status_code == 409 and resp.json()["code"] == "SPEC_NOT_CONFIRMABLE"


def test_profile_after_confirm_requires_rollback(client, repo, mock_llm):
    pid = _new_project_in_discovery(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})
    _to_review(client, pid)
    client.post(f"/api/projects/{pid}/requirements/confirm", json={})

    # Direct profile change on a confirmed project is rejected, no side effect.
    before = len(repo.list_events(pid))
    resp = client.patch(f"/api/projects/{pid}/profile", json={"scene": "corporate"})
    assert resp.status_code == 409 and resp.json()["code"] == "SPEC_NOT_CONFIRMABLE"
    assert len(repo.list_events(pid)) == before
    assert repo.get_project(pid).scene == "education"

    # Roll back: resets confirmedByUser + voids the Spec snapshot.
    client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_DISCOVERY"})
    assert repo.get_project(pid).spec is None

    resp = client.patch(f"/api/projects/{pid}/profile", json={"scene": "corporate"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["scene"] == "corporate"
    last = repo.list_events(pid)[-1]
    assert last["type"] == "SCENE_STYLE_PROFILE_UPDATED"
    assert last["payload"]["previousScene"] == "education"
    assert last["payload"]["scene"] == "corporate"


def test_profile_style_mismatch_rejected(client, repo, mock_llm):
    pid = _new_project_in_discovery(client)
    resp = client.patch(
        f"/api/projects/{pid}/profile",
        json={"scene": "education", "styleProfileId": "style_corporate_default"},
    )
    assert resp.status_code == 400 and resp.json()["code"] == "STYLE_PROFILE_MISMATCH"
