"""Phase 3 requirement-discovery agent runtime (design D1).

The runtime lives here in `apps/api`; the versioned prompt templates it loads
live in `packages/ai-workflow/prompts`. Every agent runs through the injected
`LLMProvider` text interface (no direct network here). Transient outputs
(discovery draft / gaps / questions) are validated structurally; only the final
`PresentationSpec` from `build_spec` goes through the shared-schema bridge.

Clean callable surface for the HTTP group (E) to wire:
- `open_session`               open a discovery session off a project
- `run_discovery`              Discovery Agent -> DiscoveryDraft
- `classify_gaps`              Gap Agent -> ordered gaps
- `generate_questions`         Question Agent -> stable-id questions
- `resolve_question_policy`    scene/mode -> effective policy (+ overrides)
- `evaluate_stop`              the four stop conditions
- `build_spec` / `build_risk_notes`  Spec Builder -> validated PresentationSpec
"""

from __future__ import annotations

from .discovery import run_discovery
from .gap import classify_gaps
from .outline import build_outline
from .models import (
    DO_NOT_ASK,
    GAP_CLASSES,
    MUST_ASK,
    SHOULD_ASK,
    Answer,
    DiscoveryDraft,
    DiscoverySession,
    Gap,
    Question,
    open_session,
    parse_json_object,
)
from .policy import (
    STOP_ALL_MUST_ASK_ANSWERED,
    STOP_MAX_QUESTIONS,
    STOP_THRESHOLD_REACHED,
    STOP_USER_SKIPPED,
    ResolvedPolicy,
    evaluate_stop,
    resolve_question_policy,
)
from .prompts import DEFAULT_PROMPT_VERSION, load_prompt
from .question import generate_questions, question_id_for
from .slide_planner import plan_slides, slide_id_for
from .spec_builder import build_risk_notes, build_spec

__all__ = [
    "DEFAULT_PROMPT_VERSION",
    "DO_NOT_ASK",
    "GAP_CLASSES",
    "MUST_ASK",
    "SHOULD_ASK",
    "STOP_ALL_MUST_ASK_ANSWERED",
    "STOP_MAX_QUESTIONS",
    "STOP_THRESHOLD_REACHED",
    "STOP_USER_SKIPPED",
    "Answer",
    "DiscoveryDraft",
    "DiscoverySession",
    "Gap",
    "Question",
    "ResolvedPolicy",
    "build_outline",
    "build_risk_notes",
    "build_spec",
    "classify_gaps",
    "evaluate_stop",
    "generate_questions",
    "load_prompt",
    "open_session",
    "parse_json_object",
    "plan_slides",
    "question_id_for",
    "resolve_question_policy",
    "run_discovery",
    "slide_id_for",
]
