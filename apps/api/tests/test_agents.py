"""Phase 3 group D agent-runtime tests (task 3.7).

All LLM interaction goes through MockLLMProvider — no real network. Covers:
- discovery extraction + structural rejection of bad output
- scene-aware gap ordering + DO_NOT_ASK not asked
- stable questionId
- policy resolved FROM the constants bridge (not hand-copied)
- the four stop conditions (threshold / max / all-must / skip)
- Spec Builder: valid snapshot, skipped -> riskNotes, invalid -> reject w/o half-write
"""

from __future__ import annotations

import json

import pytest

from app.agents import (
    Answer,
    DiscoveryDraft,
    Gap,
    ResolvedPolicy,
    build_risk_notes,
    build_spec,
    classify_gaps,
    evaluate_stop,
    generate_questions,
    open_session,
    question_id_for,
    resolve_question_policy,
    run_discovery,
)
from app.agents.policy import (
    STOP_MAX_QUESTIONS,
    STOP_THRESHOLD_REACHED,
    STOP_USER_SKIPPED,
)
from app.agents._generate import generate_validated
from app.errors import LLMProviderError, SpecValidationError, ValidationError
from app.llm import MockLLMProvider
from app.shared_schema_constants import load_shared_schema_constants


@pytest.fixture(scope="module")
def constants():
    # One Node subprocess for the whole module (bridge is immutable).
    return load_shared_schema_constants()


def _router(mapping: dict[str, str]):
    """A MockLLMProvider callable that picks a response by a substring of the
    system prompt, so tests are robust to agent call order."""

    def respond(messages, *, model, response_format):
        system = messages[0]["content"]
        for needle, reply in mapping.items():
            if needle in system:
                return reply
        raise AssertionError(f"no scripted reply for system prompt: {system[:40]!r}")

    return respond


# --------------------------------------------------------------------------- #
# Discovery (3.2)
# --------------------------------------------------------------------------- #


def test_discovery_extracts_known_unknown_confidence():
    provider = MockLLMProvider(
        json.dumps(
            {
                "known": {"topic": "AI safety", "language": "zh-CN"},
                "unknowns": ["audience", "purpose"],
                "confidence": 0.4,
            }
        )
    )
    draft = run_discovery(provider, initial_request="Talk about AI safety", scene="education")
    assert draft.known["topic"] == "AI safety"
    assert draft.unknowns == ["audience", "purpose"]
    assert draft.confidence == 0.4


def test_discovery_rejects_unparseable_output():
    provider = MockLLMProvider("this is not json at all")
    with pytest.raises(LLMProviderError):
        run_discovery(provider, initial_request="x", scene="default")


def test_discovery_rejects_out_of_range_confidence():
    provider = MockLLMProvider(json.dumps({"known": {}, "unknowns": [], "confidence": 1.7}))
    with pytest.raises(LLMProviderError):
        run_discovery(provider, initial_request="x", scene="default")


# --------------------------------------------------------------------------- #
# Gap classification + scene ordering (3.3)
# --------------------------------------------------------------------------- #


def test_gap_scene_priority_puts_audience_first_for_education():
    # "aaa" sorts before "audience" alphabetically; education priority must still
    # rank audience ahead of the unlisted field within the MUST_ASK class.
    provider = MockLLMProvider(
        json.dumps(
            {
                "gaps": [
                    {"field": "aaa", "classification": "MUST_ASK"},
                    {"field": "audience", "classification": "MUST_ASK"},
                ]
            }
        )
    )
    draft = DiscoveryDraft(known={}, unknowns=["aaa", "audience"], confidence=0.1)
    gaps = classify_gaps(provider, draft, scene="education")
    assert [g.field for g in gaps] == ["audience", "aaa"]


def test_gap_must_ask_ordered_before_should_and_do_not():
    provider = MockLLMProvider(
        json.dumps(
            {
                "gaps": [
                    {"field": "logo", "classification": "DO_NOT_ASK"},
                    {"field": "style", "classification": "SHOULD_ASK"},
                    {"field": "purpose", "classification": "MUST_ASK"},
                ]
            }
        )
    )
    draft = DiscoveryDraft(known={}, unknowns=["logo", "style", "purpose"], confidence=0.1)
    gaps = classify_gaps(provider, draft, scene="default")
    assert [g.classification for g in gaps] == ["MUST_ASK", "SHOULD_ASK", "DO_NOT_ASK"]


def test_gap_rejects_invalid_classification():
    provider = MockLLMProvider(json.dumps({"gaps": [{"field": "x", "classification": "MAYBE"}]}))
    draft = DiscoveryDraft(known={}, unknowns=["x"], confidence=0.1)
    with pytest.raises(LLMProviderError):
        classify_gaps(provider, draft, scene="default")


# --------------------------------------------------------------------------- #
# Question Agent (3.4)
# --------------------------------------------------------------------------- #


def _questions_provider():
    return MockLLMProvider(
        json.dumps(
            {
                "questions": [
                    {
                        "field": "audience",
                        "prompt": "Who is the audience?",
                        "options": ["Students", "Executives"],
                        "freeTextAllowed": True,
                    }
                ]
            }
        )
    )


def test_questions_have_stable_ids_and_do_not_ask_is_skipped():
    gaps = [
        Gap(field="audience", classification="MUST_ASK"),
        Gap(field="logo", classification="DO_NOT_ASK"),
    ]
    q1 = generate_questions(_questions_provider(), gaps)
    q2 = generate_questions(_questions_provider(), gaps)
    assert [q.field for q in q1] == ["audience"]  # DO_NOT_ASK not asked
    assert q1[0].questionId == question_id_for("audience")
    assert q1[0].questionId == q2[0].questionId  # stable across regenerations
    assert q1[0].freeTextAllowed is True
    assert q1[0].options == ["Students", "Executives"]


# --------------------------------------------------------------------------- #
# Policy consumed from the constants bridge, not hand-copied (3.5)
# --------------------------------------------------------------------------- #


def test_policy_resolved_from_bridge_constants(constants):
    fast_edu = resolve_question_policy(constants, scene="education", mode="fast")
    assert fast_edu.sceneThreshold == constants.default_fast_scene_threshold_by_scene["education"]
    assert fast_edu.maxQuestions == constants.default_max_questions_by_mode["fast"]

    thorough = resolve_question_policy(constants, scene="corporate", mode="thorough")
    assert thorough.sceneThreshold == constants.thorough_min_scene_threshold
    assert thorough.maxQuestions == constants.default_max_questions_by_mode["thorough"]


def test_policy_override_layer(constants):
    overridden = resolve_question_policy(
        constants, scene="default", mode="fast", threshold_override=0.6, max_questions_override=1
    )
    assert overridden.sceneThreshold == 0.6
    assert overridden.maxQuestions == 1


def test_policy_thorough_override_below_floor_rejected(constants):
    with pytest.raises(ValidationError):
        resolve_question_policy(constants, scene="default", mode="thorough", threshold_override=0.5)


# --------------------------------------------------------------------------- #
# Stop conditions (3.5 / 3.7)
# --------------------------------------------------------------------------- #


def test_stop_on_threshold_reached():
    policy = ResolvedPolicy(mode="fast", sceneThreshold=0.82, maxQuestions=3)
    reason = evaluate_stop(
        confidence=0.82,
        policy=policy,
        questions_asked=1,
        must_ask_remaining=1,
        user_skipped_remaining=False,
    )
    assert reason == STOP_THRESHOLD_REACHED


def test_stop_on_max_questions_reached():
    policy = ResolvedPolicy(mode="fast", sceneThreshold=0.82, maxQuestions=3)
    reason = evaluate_stop(
        confidence=0.5,
        policy=policy,
        questions_asked=3,
        must_ask_remaining=1,
        user_skipped_remaining=False,
    )
    assert reason == STOP_MAX_QUESTIONS


def test_stop_on_user_skip():
    policy = ResolvedPolicy(mode="fast", sceneThreshold=0.82, maxQuestions=3)
    reason = evaluate_stop(
        confidence=0.1,
        policy=policy,
        questions_asked=0,
        must_ask_remaining=2,
        user_skipped_remaining=True,
    )
    assert reason == STOP_USER_SKIPPED


def test_no_stop_when_below_threshold_and_under_cap():
    policy = ResolvedPolicy(mode="fast", sceneThreshold=0.82, maxQuestions=3)
    reason = evaluate_stop(
        confidence=0.5,
        policy=policy,
        questions_asked=1,
        must_ask_remaining=1,
        user_skipped_remaining=False,
    )
    assert reason is None


# --------------------------------------------------------------------------- #
# Spec Builder (3.6) — needs the shared-schema validateEntity bridge (Node).
# --------------------------------------------------------------------------- #


def _valid_spec_json():
    # scene/styleProfileId/questionPolicy/riskNotes/confirmedByUser are snapshotted
    # by the runtime, so the model only needs the content fields.
    return json.dumps(
        {
            "topic": "Museum for kids",
            "audience": "Children",
            "purpose": "Educate",
            "language": "zh-CN",
        }
    )


def _session_with_skip(constants):
    session = open_session(
        constants,
        scene="education",
        style_profile_id="style_education_default",
        initial_request="A fun museum talk",
        mode="fast",
    )
    from app.agents.models import Question

    session.questions = [
        Question(
            questionId="q_audience",
            field="audience",
            prompt="Who is the audience?",
            options=["Kids"],
            freeTextAllowed=True,
            kind="multiple_choice",
        )
    ]
    session.skipped = ["q_audience"]
    session.answers = {"q_purpose": Answer(questionId="q_purpose", freeText="educate")}
    session.confidence = 0.5  # below education 0.82 -> low-confidence risk note too
    return session


def test_build_spec_snapshots_scene_policy_and_risknotes(constants):
    session = _session_with_skip(constants)
    provider = MockLLMProvider(_valid_spec_json())
    spec = build_spec(provider, session)

    assert spec["scene"] == "education"
    assert spec["styleProfileId"] == "style_education_default"
    assert spec["questionPolicy"]["mode"] == "fast"
    assert spec["questionPolicy"]["sceneThreshold"] == (
        constants.default_fast_scene_threshold_by_scene["education"]
    )
    assert spec["confirmedByUser"] is False
    # Skipped question and low confidence both surface as riskNotes.
    assert any("audience" in note for note in spec["riskNotes"])
    assert any("Low confidence" in note for note in spec["riskNotes"])


def test_build_risk_notes_records_skipped(constants):
    session = _session_with_skip(constants)
    notes = build_risk_notes(session)
    assert any("audience" in note for note in notes)


def test_build_risk_notes_itemizes_capped_must_ask(constants):
    # A MUST_ASK gap dropped by the maxQuestions cap has no question at all, so it
    # gets its own explicit risk note (not just the generic low-confidence one).
    session = open_session(
        constants, scene="education", style_profile_id="style_education_default", mode="fast"
    )
    session.gaps = [
        Gap(field="audience", classification="MUST_ASK"),
        Gap(field="purpose", classification="MUST_ASK"),  # capped out (no question)
    ]
    from app.agents.models import Question

    session.questions = [
        Question(
            questionId=question_id_for("audience"),
            field="audience",
            prompt="Who?",
            options=["Kids"],
            freeTextAllowed=True,
            kind="multiple_choice",
        )
    ]
    notes = build_risk_notes(session)
    assert any("purpose" in note and "capped" in note for note in notes)
    # The asked MUST_ASK field must NOT produce a capped note.
    assert not any("audience" in note and "capped" in note for note in notes)


def test_build_risk_notes_dedupes_capped_must_ask(constants):
    # Duplicate MUST_ASK gaps for the same capped field must yield exactly ONE
    # capped note, not one per duplicate.
    session = open_session(
        constants, scene="education", style_profile_id="style_education_default", mode="fast"
    )
    session.gaps = [
        Gap(field="purpose", classification="MUST_ASK"),
        Gap(field="purpose", classification="MUST_ASK"),  # duplicate, also capped out
    ]
    session.questions = []  # neither asked -> capped
    notes = build_risk_notes(session)
    capped = [n for n in notes if "purpose" in n and "capped" in n]
    assert len(capped) == 1


def test_build_risk_notes_no_capped_note_when_all_must_ask_asked(constants):
    session = open_session(
        constants, scene="education", style_profile_id="style_education_default", mode="fast"
    )
    session.gaps = [Gap(field="audience", classification="MUST_ASK")]
    from app.agents.models import Question

    session.questions = [
        Question(
            questionId=question_id_for("audience"),
            field="audience",
            prompt="Who?",
            options=["Kids"],
            freeTextAllowed=True,
            kind="multiple_choice",
        )
    ]
    assert not any("capped" in note for note in build_risk_notes(session))


def test_build_spec_rejects_invalid_output_without_half_write(constants):
    session = open_session(
        constants, scene="default", style_profile_id="style_default", mode="fast"
    )
    # Missing required topic/audience/purpose -> invalid on both the initial call
    # and the single repair retry.
    bad = json.dumps({"language": "zh-CN"})
    provider = MockLLMProvider([bad, bad])
    with pytest.raises(SpecValidationError):
        build_spec(provider, session)
    # Pure builder: nothing written onto the session on failure.
    assert session.stopped is False
    assert session.answers == {}


def test_build_spec_repairs_once_then_succeeds(constants):
    session = open_session(
        constants, scene="default", style_profile_id="style_default", mode="fast"
    )
    bad = json.dumps({"language": "zh-CN"})  # missing required fields
    provider = MockLLMProvider([bad, _valid_spec_json()])
    spec = build_spec(provider, session)
    assert spec["topic"] == "Museum for kids"
    assert len(provider.calls) == 2  # one repair retry consumed


# --------------------------------------------------------------------------- #
# Transient-agent bounded repair retry (llm-provider spec parity with builder).
# The transient agents must also repair once before rejecting (not only builder).
# --------------------------------------------------------------------------- #


def test_discovery_repairs_once_then_succeeds():
    valid = json.dumps({"known": {"topic": "AI"}, "unknowns": ["audience"], "confidence": 0.3})
    provider = MockLLMProvider(["not json at all", valid])
    draft = run_discovery(provider, initial_request="x", scene="default")
    assert draft.confidence == 0.3
    assert len(provider.calls) == 2  # one repair retry consumed


def test_discovery_rejects_after_repair_exhausted():
    provider = MockLLMProvider(["not json", "still not json"])
    with pytest.raises(LLMProviderError):
        run_discovery(provider, initial_request="x", scene="default")
    assert len(provider.calls) == 2


def test_gap_repairs_once_then_succeeds():
    bad = json.dumps({"gaps": [{"field": "x", "classification": "MAYBE"}]})
    good = json.dumps({"gaps": [{"field": "x", "classification": "MUST_ASK"}]})
    provider = MockLLMProvider([bad, good])
    draft = DiscoveryDraft(known={}, unknowns=["x"], confidence=0.1)
    gaps = classify_gaps(provider, draft, scene="default")
    assert [g.classification for g in gaps] == ["MUST_ASK"]
    assert len(provider.calls) == 2


def test_gap_rejects_after_repair_exhausted():
    bad = json.dumps({"gaps": [{"field": "x", "classification": "MAYBE"}]})
    provider = MockLLMProvider([bad, bad])
    draft = DiscoveryDraft(known={}, unknowns=["x"], confidence=0.1)
    with pytest.raises(LLMProviderError):
        classify_gaps(provider, draft, scene="default")
    assert len(provider.calls) == 2


def test_questions_repair_once_then_succeed():
    gaps = [Gap(field="audience", classification="MUST_ASK")]
    bad = json.dumps({"questions": []})  # omits the required audience question
    good = json.dumps(
        {"questions": [{"field": "audience", "prompt": "Who?", "options": ["Kids"]}]}
    )
    provider = MockLLMProvider([bad, good])
    questions = generate_questions(provider, gaps)
    assert [q.field for q in questions] == ["audience"]
    assert len(provider.calls) == 2


def test_questions_reject_after_repair_exhausted():
    gaps = [Gap(field="audience", classification="MUST_ASK")]
    bad = json.dumps({"questions": []})  # omits the required audience question
    provider = MockLLMProvider([bad, bad])
    with pytest.raises(LLMProviderError):
        generate_questions(provider, gaps)
    assert len(provider.calls) == 2


# --------------------------------------------------------------------------- #
# generate_validated: malformed-output exceptions (not just LLMProviderError)
# route through the bounded repair retry, then map to LLMProviderError (->502).
# --------------------------------------------------------------------------- #


def test_generate_validated_maps_parse_typeerror_to_llm_error_after_retry():
    provider = MockLLMProvider(["x", "y"])
    messages = [{"role": "user", "content": "hi"}]

    def parse(text):
        raise TypeError("options is None")  # malformed model structure

    with pytest.raises(LLMProviderError):
        generate_validated(provider, messages, model=None, parse=parse)
    assert len(provider.calls) == 2  # one repair retry consumed


def test_generate_validated_does_not_swallow_code_bugs():
    provider = MockLLMProvider(["x", "y"])
    messages = [{"role": "user", "content": "hi"}]

    def parse(text):
        raise AttributeError("real code bug")  # must surface as 500, not repaired

    with pytest.raises(AttributeError):
        generate_validated(provider, messages, model=None, parse=parse)
    assert len(provider.calls) == 1  # no repair retry on a code bug
