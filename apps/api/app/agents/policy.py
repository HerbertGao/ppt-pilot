"""Scene-aware question policy + stop conditions (task 3.5).

Thresholds/limits are NEVER hand-copied here: the base values come from the
shared-schema constants bridge (`SharedSchemaConstants`), which surfaces
`profiles.ts`' `DEFAULT_FAST_SCENE_THRESHOLD_BY_SCENE` / `THOROUGH_MIN_SCENE_THRESHOLD`
/ `DEFAULT_MAX_QUESTIONS_BY_MODE`. Calibration knobs (`*_override`) sit on TOP of
those defaults as an override layer, not a re-declaration.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..errors import ValidationError
from ..shared_schema_constants import SharedSchemaConstants

QUESTION_MODES = ("fast", "thorough")

# Stop-condition reason codes (the four normative stop conditions).
STOP_THRESHOLD_REACHED = "threshold_reached"
STOP_MAX_QUESTIONS = "max_questions_reached"
STOP_ALL_MUST_ASK_ANSWERED = "all_must_ask_answered"
STOP_USER_SKIPPED = "user_skipped_remaining"


@dataclass(frozen=True)
class ResolvedPolicy:
    """The effective policy snapshotted into `PresentationSpec.questionPolicy`."""

    mode: str
    sceneThreshold: float
    maxQuestions: int

    def as_question_policy(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "sceneThreshold": self.sceneThreshold,
            "maxQuestions": self.maxQuestions,
        }


def resolve_question_policy(
    constants: SharedSchemaConstants,
    *,
    scene: str,
    mode: str = "fast",
    threshold_override: float | None = None,
    max_questions_override: int | None = None,
) -> ResolvedPolicy:
    """Resolve the effective policy from bridge defaults + optional overrides.

    Mirrors `getDefaultSceneThreshold`: thorough -> `thorough_min_scene_threshold`,
    fast -> per-scene fast threshold. Overrides replace the base value but the
    thorough-mode floor is still enforced (kept schema-valid for validateEntity).
    """

    if mode not in QUESTION_MODES:
        raise ValidationError(f"unknown question mode: {mode!r}", field="mode")

    if mode == "thorough":
        base_threshold = constants.thorough_min_scene_threshold
    else:
        try:
            base_threshold = constants.default_fast_scene_threshold_by_scene[scene]
        except KeyError as exc:
            raise ValidationError(f"unknown scene: {scene!r}", field="scene") from exc

    threshold = base_threshold if threshold_override is None else float(threshold_override)

    if mode == "thorough" and threshold < constants.thorough_min_scene_threshold:
        raise ValidationError(
            f"thorough-mode sceneThreshold must be >= "
            f"{constants.thorough_min_scene_threshold}",
            field="sceneThreshold",
        )

    base_max = constants.default_max_questions_by_mode[mode]
    max_questions = base_max if max_questions_override is None else int(max_questions_override)
    if max_questions < 1:
        raise ValidationError("maxQuestions must be >= 1", field="maxQuestions")

    return ResolvedPolicy(mode=mode, sceneThreshold=threshold, maxQuestions=max_questions)


def evaluate_stop(
    *,
    confidence: float,
    policy: ResolvedPolicy,
    questions_asked: int,
    must_ask_remaining: int,
    user_skipped_remaining: bool,
) -> str | None:
    """Return the stop-reason code if asking should stop, else None.

    The four normative stop conditions, evaluated in a stable order:
    user skip -> confidence threshold -> all MUST_ASK answered -> max questions.
    """

    if user_skipped_remaining:
        return STOP_USER_SKIPPED
    if confidence >= policy.sceneThreshold:
        return STOP_THRESHOLD_REACHED
    if must_ask_remaining <= 0:
        return STOP_ALL_MUST_ASK_ANSWERED
    if questions_asked >= policy.maxQuestions:
        return STOP_MAX_QUESTIONS
    return None
