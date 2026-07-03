"""Phase 5 group E: end-to-end integration (task 8.1).

Drives the FULL chain over the real HTTP surface, hermetic (mock LLM, no network):

    create -> [transition]-> REQUIREMENT_DISCOVERY -> discover
    -> [transition]-> REQUIREMENT_REVIEW -> requirements/confirm (Spec confirmed)
    -> [transition]-> OUTLINE_GENERATION -> outline/generate
    -> [transition]-> OUTLINE_REVIEW -> outline/confirm
    -> [transition]-> SLIDE_PLANNING -> slides/plans/generate
    -> [transition]-> SLIDE_PLAN_REVIEW -> slides/plans/confirm

One scripted provider routes every agent (requirement + outline + planner) by a
substring of its system prompt, so the whole flow runs through the real service
layer in one continuous run. Also ties together the cross-cutting behaviors that
only make sense integrated: None-safe rollback to an empty-product state,
rollback clearing downstream + resetting slidePlansConfirmed, regenerate voiding
confirmation/edits, replay-safe repeat-confirm, and wrong-state -> state error.
"""

from __future__ import annotations

import itertools
import json

import pytest

import app.routes as routes
from app.llm import MockLLMProvider, mock_outline_response, mock_slide_plan_response

# Requirement-agent scripted replies (mirrors test_phase3_contract).
_DISC_LOW = json.dumps(
    {"known": {"topic": "AI safety", "language": "zh-CN"}, "unknowns": ["audience"], "confidence": 0.4}
)
_GAPS = json.dumps({"gaps": [{"field": "audience", "classification": "MUST_ASK"}]})
_QUESTIONS = json.dumps(
    {
        "questions": [
            {"field": "audience", "prompt": "Who?", "options": ["Kids", "Adults"], "freeTextAllowed": True}
        ]
    }
)
_SPEC_VALID = json.dumps(
    {"topic": "AI safety", "audience": "Kids", "purpose": "Educate", "language": "zh-CN"}
)


@pytest.fixture
def full_chain_llm():
    """Install one provider that answers every agent in the Phase 3->5 chain."""

    reqs = {
        "Requirement Discovery Agent": itertools.repeat(_DISC_LOW),
        "Requirement Gap Agent": itertools.repeat(_GAPS),
        "Question Agent": itertools.repeat(_QUESTIONS),
        "Spec Builder Agent": itertools.repeat(_SPEC_VALID),
    }

    def respond(messages, *, model=None, response_format=None):
        system = messages[0]["content"]
        # Most specific first: "Slide Planner Agent" before "Outline Agent".
        if "Slide Planner Agent" in system:
            return mock_slide_plan_response(messages)
        if "Outline Agent" in system:
            return mock_outline_response(messages)
        for needle, seq in reqs.items():
            if needle in system:
                return next(seq)
        raise AssertionError(f"no scripted reply for: {system[:40]!r}")

    routes._llm_provider = MockLLMProvider(respond)
    yield
    routes._llm_provider = None


def _transition(client, pid, to):
    return client.post(f"/api/projects/{pid}/transitions", json={"to": to})


def _types(repo, pid):
    return [e["type"] for e in repo.list_events(pid)]


def _domain_events(repo, pid):
    """Event types with WORKFLOW_STATE_CHANGED filtered out (the structural noise)."""
    return [t for t in _types(repo, pid) if t != "WORKFLOW_STATE_CHANGED"]


# --------------------------------------------------------------------------- #
# 8.1 full-chain happy path + event sequence
# --------------------------------------------------------------------------- #


def test_full_chain_spec_to_confirmed_slide_plans(client, repo, full_chain_llm):
    pid = client.post("/api/projects", json={"scene": "education"}).json()["projectId"]

    # --- Spec: discover -> review -> confirm.
    assert _transition(client, pid, "REQUIREMENT_DISCOVERY").status_code == 200
    assert client.post(f"/api/projects/{pid}/requirements/discover", json={}).status_code == 200
    assert _transition(client, pid, "REQUIREMENT_REVIEW").status_code == 200
    confirmed = client.post(f"/api/projects/{pid}/requirements/confirm", json={})
    assert confirmed.status_code == 200, confirmed.text
    assert repo.get_project(pid).spec["confirmedByUser"] is True

    # --- Outline: generate -> review -> confirm.
    assert _transition(client, pid, "OUTLINE_GENERATION").status_code == 200
    gen = client.post(f"/api/projects/{pid}/outline/generate", json={})
    assert gen.status_code == 200, gen.text
    assert len(gen.json()["sections"]) == 3 and gen.json()["confirmedByUser"] is False
    assert repo.get_project(pid).state == "OUTLINE_GENERATION"  # action does not advance

    assert _transition(client, pid, "OUTLINE_REVIEW").status_code == 200
    oc = client.post(f"/api/projects/{pid}/outline/confirm", json={})
    assert oc.status_code == 200 and oc.json()["confirmedByUser"] is True

    # --- Slide plans: generate -> review -> confirm.
    assert _transition(client, pid, "SLIDE_PLANNING").status_code == 200
    pg = client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
    assert pg.status_code == 200, pg.text
    assert [p["slideId"] for p in pg.json()["slidePlans"]] == [f"slide-{i:04d}" for i in range(1, 7)]
    assert pg.json()["slidePlansConfirmed"] is False

    assert _transition(client, pid, "SLIDE_PLAN_REVIEW").status_code == 200
    pc = client.post(f"/api/projects/{pid}/slides/plans/confirm", json={})
    assert pc.status_code == 200 and pc.json()["slidePlansConfirmed"] is True
    assert repo.get_project(pid).state == "SLIDE_PLAN_REVIEW"

    # Event sequence: 6 workflow transitions + the domain events in order.
    assert _types(repo, pid).count("WORKFLOW_STATE_CHANGED") == 6
    assert _domain_events(repo, pid)[-5:] == [
        "PRESENTATION_SPEC_CONFIRMED",
        "OUTLINE_GENERATED",
        "OUTLINE_CONFIRMED",
        "SLIDE_PLAN_GENERATED",
        "SLIDE_PLAN_CONFIRMED",
    ]


# --------------------------------------------------------------------------- #
# 8.1 cross-cutting behaviors, integrated
# --------------------------------------------------------------------------- #


def test_transition_only_path_to_empty_state_rolls_back_none_safe(client, repo):
    """(i) A content-free transition to OUTLINE_GENERATION (no spec/outline ever
    produced) can roll back without dereferencing None."""
    pid = client.post("/api/projects", json={}).json()["projectId"]
    for to in ("REQUIREMENT_DISCOVERY", "REQUIREMENT_REVIEW", "OUTLINE_GENERATION"):
        assert _transition(client, pid, to).status_code == 200
    assert repo.get_project(pid).outline is None

    back = _transition(client, pid, "REQUIREMENT_REVIEW")  # rollback, empty downstream
    assert back.status_code == 200, back.text
    project = repo.get_project(pid)
    assert project.state == "REQUIREMENT_REVIEW"
    assert project.outline is None and project.slidePlans is None
    assert project.slidePlansConfirmed is False


def _drive_to_confirmed_plans(client, repo, pid):
    """Fast-path a project to SLIDE_PLAN_REVIEW with confirmed plans (hermetic)."""
    project = repo.get_project(pid)
    project.spec = {"id": "s", "scene": "default", "styleProfileId": "d", "confirmedByUser": True}
    project.state = "OUTLINE_GENERATION"
    client.post(f"/api/projects/{pid}/outline/generate", json={})
    repo.get_project(pid).state = "OUTLINE_REVIEW"
    client.post(f"/api/projects/{pid}/outline/confirm", json={})
    repo.get_project(pid).state = "SLIDE_PLANNING"
    client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
    repo.get_project(pid).state = "SLIDE_PLAN_REVIEW"
    client.post(f"/api/projects/{pid}/slides/plans/confirm", json={})


@pytest.fixture
def chain_llm():
    def respond(messages, *, model=None, response_format=None):
        system = messages[0]["content"]
        if "Slide Planner Agent" in system:
            return mock_slide_plan_response(messages)
        return mock_outline_response(messages)

    routes._llm_provider = MockLLMProvider(respond)
    yield
    routes._llm_provider = None


def test_rollback_clears_downstream_and_resets_confirmed(client, repo, chain_llm):
    """(ii) Rolling back down the chain clears downstream artifacts and resets
    slidePlansConfirmed / the outline's confirmedByUser."""
    pid = client.post("/api/projects", json={}).json()["projectId"]
    _drive_to_confirmed_plans(client, repo, pid)
    assert repo.get_project(pid).slidePlansConfirmed is True

    # SLIDE_PLAN_REVIEW -> SLIDE_PLANNING: keep plans, void confirmation.
    assert _transition(client, pid, "SLIDE_PLANNING").status_code == 200
    assert repo.get_project(pid).slidePlansConfirmed is False
    assert repo.get_project(pid).slidePlans is not None

    # SLIDE_PLANNING -> OUTLINE_REVIEW: clear plans.
    assert _transition(client, pid, "OUTLINE_REVIEW").status_code == 200
    assert repo.get_project(pid).slidePlans is None

    # OUTLINE_REVIEW -> OUTLINE_GENERATION: un-confirm the outline.
    assert _transition(client, pid, "OUTLINE_GENERATION").status_code == 200
    assert repo.get_project(pid).outline["confirmedByUser"] is False


def test_regenerate_voids_confirmation_and_edits_integrated(client, repo, chain_llm):
    """(iii) After confirm, going back and regenerating overwrites plans, drops the
    manual edit, and resets slidePlansConfirmed."""
    pid = client.post("/api/projects", json={}).json()["projectId"]
    _drive_to_confirmed_plans(client, repo, pid)

    repo.get_project(pid).state = "SLIDE_PLANNING"
    client.put(
        f"/api/projects/{pid}/slides/slide-0001/plan",
        json={
            "objective": "MANUAL EDIT",
            "keyMessage": "k",
            "contentIntent": "c",
            "visualIntent": "chart",
            "layoutSuggestion": "l",
            "requiredAssets": [],
            "riskNotes": [],
        },
    )
    regen = client.post(f"/api/projects/{pid}/slides/plans/generate", json={})
    assert regen.status_code == 200
    assert regen.json()["slidePlansConfirmed"] is False
    first = [p for p in regen.json()["slidePlans"] if p["slideId"] == "slide-0001"][0]
    assert first["objective"] != "MANUAL EDIT"  # edit overwritten by fresh generation


def test_repeat_confirm_replay_safe_integrated(client, repo, chain_llm):
    """(iv) Both outline/confirm and plans/confirm are replay-safe (append again)."""
    pid = client.post("/api/projects", json={}).json()["projectId"]
    _drive_to_confirmed_plans(client, repo, pid)  # already 1x each confirm

    # A second plans/confirm while still in review stays 200 and re-appends.
    again = client.post(f"/api/projects/{pid}/slides/plans/confirm", json={})
    assert again.status_code == 200 and again.json()["slidePlansConfirmed"] is True
    assert _types(repo, pid).count("SLIDE_PLAN_CONFIRMED") == 2


def test_wrong_state_action_is_invalid_state_transition_no_field_to(client, repo, chain_llm):
    """(v) An action called in the wrong state -> INVALID_STATE_TRANSITION with the
    meaningless default field='to' cleared."""
    pid = client.post("/api/projects", json={}).json()["projectId"]
    _drive_to_confirmed_plans(client, repo, pid)  # now at SLIDE_PLAN_REVIEW

    # outline/generate is illegal here (state != OUTLINE_GENERATION).
    resp = client.post(f"/api/projects/{pid}/outline/generate", json={})
    assert resp.status_code == 409
    data = resp.json()
    assert data["code"] == "INVALID_STATE_TRANSITION"
    assert data["error"] == "STATE_ERROR"
    assert data.get("details", {}).get("field") is None
