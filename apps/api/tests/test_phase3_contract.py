"""Phase 3 group F contract tests (tasks 6.1-6.6).

Comprehensive HTTP-surface contract coverage for requirement discovery + Spec
building, complementing the group-E smoke tests in `test_requirements.py` (which
this file deliberately does NOT re-run). Everything is driven by a scripted
`MockLLMProvider` — no real network is ever touched (6.1).

Focus is the behaviour group E does not exercise:
- stop conditions surfaced by discover (threshold reached / max questions) (6.2)
- Spec validation failure at confirm rejects with no side effect (6.3)
- LLM upstream failure and confirm-after-rollback re-confirmation (6.4)
- every appended event passes the shared-schema `validateEvent`, and an
  incomplete payload is rejected (so it can never be appended) (6.6)
- security regression: confirm/transitions perform no out-of-scope writes and the
  Phase-2 store boundary (no lock/version runtime) is preserved (6.5)
"""

from __future__ import annotations

import itertools
import json

import pytest

import app.routes as routes
from app.agents.policy import STOP_MAX_QUESTIONS, STOP_THRESHOLD_REACHED
from app.events import EventValidationError, build_event, validate_event
from app.llm import MockLLMProvider

# --------------------------------------------------------------------------- #
# Scripted mock provider: routes a reply by a substring of the system prompt so
# tests can force any agent's output (valid/invalid/threshold/malformed).
# --------------------------------------------------------------------------- #

_DISC_LOW = json.dumps(
    {"known": {"topic": "AI safety", "language": "zh-CN"}, "unknowns": ["audience"], "confidence": 0.4}
)
_DISC_HIGH = json.dumps(
    {"known": {"topic": "AI safety", "language": "zh-CN"}, "unknowns": ["audience"], "confidence": 0.9}
)
_GAPS = json.dumps({"gaps": [{"field": "audience", "classification": "MUST_ASK"}]})
_QUESTIONS = json.dumps(
    {
        "questions": [
            {"field": "audience", "prompt": "Who is the audience?", "options": ["Kids", "Adults"], "freeTextAllowed": True}
        ]
    }
)
_SPEC_VALID = json.dumps(
    {"topic": "AI safety", "audience": "Kids", "purpose": "Educate", "language": "zh-CN"}
)
_SPEC_BAD = json.dumps({"language": "zh-CN"})  # missing required topic/audience/purpose


def _as_iter(value):
    # A bare string is repeated for every call; a list is consumed in order.
    if isinstance(value, str):
        return itertools.repeat(value)
    return iter(value)


def _provider(*, discovery=_DISC_LOW, gaps=_GAPS, questions=_QUESTIONS, spec=_SPEC_VALID):
    seqs = {
        "Requirement Discovery Agent": _as_iter(discovery),
        "Requirement Gap Agent": _as_iter(gaps),
        "Question Agent": _as_iter(questions),
        "Spec Builder Agent": _as_iter(spec),
    }

    def respond(messages, *, model, response_format):
        system = messages[0]["content"]
        for needle, seq in seqs.items():
            if needle in system:
                return next(seq)
        raise AssertionError(f"no scripted reply for: {system[:40]!r}")

    return MockLLMProvider(respond)


@pytest.fixture
def use_provider():
    """Install a scripted provider into the route singleton for one test."""

    def install(provider: MockLLMProvider) -> MockLLMProvider:
        routes._llm_provider = provider
        return provider

    yield install
    routes._llm_provider = None


def _in_discovery(client) -> str:
    pid = client.post("/api/projects", json={"scene": "education"}).json()["projectId"]
    client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_DISCOVERY"})
    return pid


def _in_review(client) -> str:
    pid = _in_discovery(client)
    client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_REVIEW"})
    return pid


# --------------------------------------------------------------------------- #
# 6.2 stop conditions surfaced by discover
# --------------------------------------------------------------------------- #


def test_discover_threshold_reached_stops(client, repo, use_provider):
    use_provider(_provider(discovery=_DISC_HIGH))
    pid = _in_discovery(client)
    data = client.post(f"/api/projects/{pid}/requirements/discover", json={}).json()

    assert data["confidence"] == 0.9
    assert data["thresholdReached"] is True  # 0.9 >= education 0.82
    session = repo.get_project(pid).discovery
    assert session.stopped is True
    assert session.stopReason == STOP_THRESHOLD_REACHED


def test_discover_max_questions_reached_stops(client, repo, use_provider):
    # Confidence below threshold, but the single question hits the maxQuestions=1
    # cap -> the runtime records the max-questions stop reason.
    use_provider(_provider(discovery=_DISC_LOW))
    pid = _in_discovery(client)
    data = client.post(
        f"/api/projects/{pid}/requirements/discover", json={"maxQuestions": 1}
    ).json()

    assert data["thresholdReached"] is False
    session = repo.get_project(pid).discovery
    assert session.stopped is True
    assert session.stopReason == STOP_MAX_QUESTIONS


_MANY_FIELDS = ["audience", "purpose", "durationMinutes", "tone", "language2"]
_DISC_MANY = json.dumps(
    {"known": {"topic": "AI safety"}, "unknowns": _MANY_FIELDS, "confidence": 0.4}
)
_GAPS_MANY = json.dumps(
    {"gaps": [{"field": f, "classification": "MUST_ASK"} for f in _MANY_FIELDS]}
)
_QUESTIONS_MANY = json.dumps(
    {
        "questions": [
            {"field": f, "prompt": f"Q {f}?", "options": ["a", "b"], "freeTextAllowed": True}
            for f in _MANY_FIELDS
        ]
    }
)


def test_discover_caps_questions_and_events_to_max_questions(client, repo, use_provider):
    # Gap agent yields 5 askable gaps and the question agent a question for each,
    # but fast mode caps maxQuestions at 3 -> exactly 3 questions returned and
    # exactly 3 REQUIREMENT_QUESTION_ASKED events (plus 1 QUESTION_POLICY_APPLIED).
    use_provider(_provider(discovery=_DISC_MANY, gaps=_GAPS_MANY, questions=_QUESTIONS_MANY))
    pid = _in_discovery(client)
    data = client.post(f"/api/projects/{pid}/requirements/discover", json={}).json()

    assert len(data["questions"]) == 3
    session = repo.get_project(pid).discovery
    assert len(session.questions) == 3

    events = repo.list_events(pid)
    asked = [e for e in events if e["type"] == "REQUIREMENT_QUESTION_ASKED"]
    policy = [e for e in events if e["type"] == "QUESTION_POLICY_APPLIED"]
    assert len(asked) == 3
    assert len(policy) == 1


_MIXED_MUST = ["audience", "purpose"]
_MIXED_SHOULD = ["tone", "durationMinutes", "language2"]
_MIXED_ALL = _MIXED_MUST + _MIXED_SHOULD
_DISC_MIXED = json.dumps(
    {"known": {"topic": "AI safety"}, "unknowns": _MIXED_ALL, "confidence": 0.4}
)
_GAPS_MIXED = json.dumps(
    {
        "gaps": [
            *({"field": f, "classification": "MUST_ASK"} for f in _MIXED_MUST),
            *({"field": f, "classification": "SHOULD_ASK"} for f in _MIXED_SHOULD),
        ]
    }
)
_QUESTIONS_MIXED = json.dumps(
    {
        "questions": [
            {"field": f, "prompt": f"Q {f}?", "options": ["a", "b"], "freeTextAllowed": True}
            for f in _MIXED_ALL
        ]
    }
)


def test_discover_cap_keeps_must_ask_over_should_ask(client, repo, use_provider):
    # 2 MUST_ASK + 3 SHOULD_ASK gaps, maxQuestions=2 -> the 2 surviving questions
    # must be the MUST_ASK fields (priority is preserved across the cap, which the
    # B1 max-questions cap depends on).
    use_provider(
        _provider(discovery=_DISC_MIXED, gaps=_GAPS_MIXED, questions=_QUESTIONS_MIXED)
    )
    pid = _in_discovery(client)
    data = client.post(
        f"/api/projects/{pid}/requirements/discover", json={"maxQuestions": 2}
    ).json()

    session = repo.get_project(pid).discovery
    assert len(session.questions) == 2
    assert {q.field for q in session.questions} == set(_MIXED_MUST)


# --------------------------------------------------------------------------- #
# B2: a profile change invalidates the stale discovery session / spec
# --------------------------------------------------------------------------- #


def test_profile_change_after_confirm_forces_rediscovery(client, repo, use_provider):
    use_provider(_provider())
    pid = _in_review(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})
    assert client.post(f"/api/projects/{pid}/requirements/confirm", json={}).status_code == 200

    # Roll back REVIEW -> DISCOVERY, change the profile, re-enter REVIEW.
    client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_DISCOVERY"})
    patch = client.patch(f"/api/projects/{pid}/profile", json={"scene": "corporate"})
    assert patch.status_code == 200, patch.text
    assert repo.get_project(pid).discovery is None  # stale session voided
    assert repo.get_project(pid).spec is None
    client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_REVIEW"})

    # No session to confirm -> SPEC_NOT_CONFIRMABLE (must re-discover first).
    resp = client.post(f"/api/projects/{pid}/requirements/confirm", json={})
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "SPEC_NOT_CONFIRMABLE"


def test_profile_change_before_confirm_voids_session(client, repo, use_provider):
    use_provider(_provider())
    pid = _in_discovery(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})
    assert repo.get_project(pid).discovery is not None

    patch = client.patch(f"/api/projects/{pid}/profile", json={"scene": "corporate"})
    assert patch.status_code == 200, patch.text
    assert repo.get_project(pid).discovery is None  # forces re-discovery


# --------------------------------------------------------------------------- #
# 6.3 Spec validation failure at confirm rejects with no side effect
# --------------------------------------------------------------------------- #


def test_confirm_rejects_invalid_spec_no_side_effect(client, repo, use_provider):
    use_provider(_provider(spec=_SPEC_BAD))  # bad on initial + repair -> reject
    pid = _in_review(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})
    events_before = len(repo.list_events(pid))

    resp = client.post(f"/api/projects/{pid}/requirements/confirm", json={})
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == "SPEC_VALIDATION_ERROR"

    project = repo.get_project(pid)
    assert project.state == "REQUIREMENT_REVIEW"  # unchanged
    assert project.spec is None  # nothing confirmed
    assert len(repo.list_events(pid)) == events_before  # no event appended
    assert not any(e["type"] == "PRESENTATION_SPEC_CONFIRMED" for e in repo.list_events(pid))


# --------------------------------------------------------------------------- #
# 6.4 LLM upstream failure + confirm-after-rollback re-confirmation
# --------------------------------------------------------------------------- #


def test_discover_llm_upstream_failure_no_side_effect(client, repo, use_provider):
    # Malformed discovery output on both the initial call and the bounded repair
    # retry -> LLM_PROVIDER_ERROR (502) with no persistent side effect.
    use_provider(_provider(discovery="this is not json"))
    pid = _in_discovery(client)
    events_before = len(repo.list_events(pid))

    resp = client.post(f"/api/projects/{pid}/requirements/discover", json={})
    assert resp.status_code == 502, resp.text
    assert resp.json()["code"] == "LLM_PROVIDER_ERROR"

    project = repo.get_project(pid)
    assert project.discovery is None  # no session attached
    assert len(repo.list_events(pid)) == events_before  # no event appended


# A malformed question structure (questions is not a list). After the systemic
# widening in generate_validated, any malformed model structure maps to
# LLM_PROVIDER_ERROR (->502) via bounded repair rather than escaping as a 500.
# (`options: null` specifically is now normalised to an empty-options free-text
# question by question.py's belt-and-suspenders, so it is valid, not malformed;
# this uses a genuinely-malformed shape to exercise the malformed -> 502 path.)
_QUESTIONS_MALFORMED = json.dumps({"questions": None})


def test_discover_malformed_question_structure_maps_to_llm_error(client, repo, use_provider):
    use_provider(_provider(questions=_QUESTIONS_MALFORMED))
    pid = _in_discovery(client)
    events_before = len(repo.list_events(pid))

    resp = client.post(f"/api/projects/{pid}/requirements/discover", json={})
    assert resp.status_code == 502, resp.text
    assert resp.json()["code"] == "LLM_PROVIDER_ERROR"

    project = repo.get_project(pid)
    assert project.discovery is None  # no session attached
    assert len(repo.list_events(pid)) == events_before  # no event appended


def test_confirm_after_rollback_requires_reconfirmation(client, repo, use_provider):
    use_provider(_provider())
    pid = _in_review(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})

    first = client.post(f"/api/projects/{pid}/requirements/confirm", json={})
    assert first.status_code == 200, first.text
    assert repo.get_project(pid).spec["confirmedByUser"] is True

    # Roll back REVIEW -> DISCOVERY: voids the confirmed Spec snapshot.
    client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_DISCOVERY"})
    assert repo.get_project(pid).spec is None  # confirmation reset

    # Must re-run discovery + re-enter review, then confirm again from scratch.
    client.post(f"/api/projects/{pid}/requirements/discover", json={})
    client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_REVIEW"})
    second = client.post(f"/api/projects/{pid}/requirements/confirm", json={})
    assert second.status_code == 200, second.text
    assert repo.get_project(pid).spec["confirmedByUser"] is True
    assert repo.list_events(pid)[-1]["type"] == "PRESENTATION_SPEC_CONFIRMED"


# --------------------------------------------------------------------------- #
# 6.6 every appended event passes validateEvent; incomplete payload rejected
# --------------------------------------------------------------------------- #


def test_all_appended_phase3_events_pass_validate_event(client, repo, use_provider):
    use_provider(_provider())
    pid = _in_review(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})
    client.post(f"/api/projects/{pid}/requirements/questions/q_audience/skip", json={})
    client.post(f"/api/projects/{pid}/requirements/confirm", json={})

    events = repo.list_events(pid)
    types = {e["type"] for e in events}
    assert {
        "QUESTION_POLICY_APPLIED",
        "REQUIREMENT_QUESTION_ASKED",
        "REQUIREMENT_QUESTION_SKIPPED",
        "PRESENTATION_SPEC_CONFIRMED",
    } <= types

    # The whole appended sequence must survive the shared-schema validateEvent.
    for event in events:
        validate_event(event)

    policy_event = next(e for e in events if e["type"] == "QUESTION_POLICY_APPLIED")
    assert policy_event["actor"] == "ai"
    assert {"mode", "sceneThreshold", "maxQuestions", "confidence", "thresholdReached"} <= set(
        policy_event["payload"]
    )


def test_incomplete_question_policy_payload_is_rejected_before_append():
    # The runtime validates BEFORE appending; an incomplete QUESTION_POLICY_APPLIED
    # payload (missing the required `confidence`) must fail validateEvent, so such
    # an event can never reach the log.
    incomplete = build_event(
        "p1",
        "QUESTION_POLICY_APPLIED",
        {"mode": "fast", "sceneThreshold": 0.82, "maxQuestions": 3, "thresholdReached": False},
        actor="ai",
    )
    with pytest.raises(EventValidationError):
        validate_event(incomplete)


# --------------------------------------------------------------------------- #
# 6.5 security regression: no out-of-scope writes; Phase-2 store boundary intact
# --------------------------------------------------------------------------- #


def test_confirm_writes_only_spec_and_one_event(client, repo, use_provider):
    use_provider(_provider())
    pid = _in_review(client)
    client.post(f"/api/projects/{pid}/requirements/discover", json={})

    before = repo.get_project(pid)
    snapshot = (before.title, before.initialRequest, before.scene, before.styleProfileId, before.state)
    events_before = len(repo.list_events(pid))

    resp = client.post(f"/api/projects/{pid}/requirements/confirm", json={})
    assert resp.status_code == 200, resp.text

    after = repo.get_project(pid)
    # Only the Spec snapshot changes; identity/context/state are untouched.
    assert (after.title, after.initialRequest, after.scene, after.styleProfileId, after.state) == snapshot
    assert after.spec is not None
    # Exactly one new event (PRESENTATION_SPEC_CONFIRMED), no extra writes.
    assert len(repo.list_events(pid)) == events_before + 1
    assert repo.list_events(pid)[-1]["type"] == "PRESENTATION_SPEC_CONFIRMED"


def test_transitions_never_invoke_llm_and_preserve_phase2_boundary(client, repo, use_provider):
    provider = use_provider(_provider())
    pid = _in_discovery(client)  # NEW -> DISCOVERY (one transition, no LLM)
    client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_REVIEW"})
    client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_DISCOVERY"})

    # Pure workflow transitions never call the LLM provider.
    assert provider.calls == []
    # The Phase-2 store shape carries no lock/version runtime this phase.
    project = repo.get_project(pid)
    assert not hasattr(project, "lock")
    assert not hasattr(project, "version")
    # No requirement/Spec side effects from transitions alone.
    assert project.discovery is None
    assert project.spec is None
