"""Slide Planner Agent (task 5.1/5.2).

Expands a CONFIRMED `Outline` (+ confirmed `PresentationSpec` context) into per-page
`SlidePlan`s via the LLM text interface. Mirrors `spec_builder.py::build_spec`'s OWN
bounded-repair loop (it does NOT use `agents/_generate.generate_validated`): each
attempt runs `provider.generate -> parse -> assemble -> inline validateSlidePlan +
set-level slideId uniqueness + total-count <= cap`. Exhausted invalidity ->
`SlidePlanValidationError` (-> 400). Provider transport exceptions propagate out as
`LLMProviderError` (-> 502); the loop only retries validation failures.

`slideId` is runtime-owned, not from the LLM: this module assigns deterministic
`slide-0001`-style ids by order before validating (so the set-level uniqueness check
is meaningful and `PUT /slides/{slideId}/plan` has a stable addressable key). The LLM
groups pages by outline section so we can attach the `estimatedSlides`-mismatch soft
riskNote to a section's FIRST page at generation time (the only point where section↔
page ownership is known); a mismatch is never a hard failure.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from ..errors import SlidePlanValidationError
from ..llm import LLMProvider
from ..shared_schema_adapter import validate_shared_schema_entity
from .models import parse_json_object
from .prompts import DEFAULT_PROMPT_VERSION, load_prompt

_JSON_RESPONSE_FORMAT: Mapping[str, Any] = {"type": "json_object"}


def slide_id_for(order: int) -> str:
    """Deterministic, stable, unique slide id by 1-based order (e.g. slide-0001)."""

    return f"slide-{order:04d}"


def _assemble_plans(
    candidate: Mapping[str, Any],
    outline_sections: Sequence[Mapping[str, Any]],
    max_total_slides: int,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Flatten section-grouped LLM output into a validated per-page plan list.

    Returns `(plans, errors)`; a non-empty `errors` means the caller must repair or
    reject (plans are then ignored). Assigns runtime-owned slideIds, appends the
    `estimatedSlides`-mismatch soft riskNote to each section's first page, then runs
    per-plan `validateSlidePlan` + set-level slideId uniqueness + total-count cap.
    """

    errors: list[str] = []
    # Trust-boundary defense-in-depth: a confirmed outline always has >=1 section
    # (validateOutline enforces it at generate/update), but don't silently rely on the
    # caller — an empty outline here would slip to plans=[] -> slideCount=0 -> 500.
    if not outline_sections:
        return [], ["outline has no sections to plan"]
    out_sections = candidate.get("sections")
    if not isinstance(out_sections, list):
        return [], ["output must be an object with a 'sections' array"]
    # Spec: expand the confirmed outline 逐 section — the provider must return exactly one
    # section group per outline section (no silent under-coverage where a 3-section outline
    # yields a 1-section plan). Combined with the per-section >=1-page guard below, this
    # guarantees a non-empty plan set, so an empty/under-covered response fails as a
    # SlidePlanValidationError (400) rather than an empty plan list / slideCount=0 → 500.
    if len(out_sections) != len(outline_sections):
        return [], [
            f"expected {len(outline_sections)} section group(s) to match the outline, "
            f"got {len(out_sections)}"
        ]

    plans: list[dict[str, Any]] = []
    section_first_index: list[int | None] = []  # flattened index of each section's 1st page
    for section in out_sections:
        slides = section.get("slides") if isinstance(section, Mapping) else None
        # Every outline section has estimatedSlides>=1, so a section that produces no
        # pages is degenerate output: reject it (repair -> SlidePlanValidationError/400)
        # rather than silently dropping the section from the plan set.
        if not isinstance(slides, list) or not slides:
            errors.append(
                f"section {len(section_first_index) + 1}: must produce at least one slide plan"
            )
            section_first_index.append(None)
            continue
        section_first_index.append(len(plans))
        for slide in slides:
            plan = dict(slide) if isinstance(slide, Mapping) else {}
            plan["slideId"] = slide_id_for(len(plans) + 1)  # runtime-owned; overwrite LLM
            plans.append(plan)

    if errors:
        return plans, errors

    # Soft estimatedSlides-vs-actual riskNote, attached at generation time to each
    # section's first page (never a hard failure, no post-hoc recompute).
    for i, out_sec in enumerate(outline_sections):
        if i >= len(out_sections):
            break
        actual = len(out_sections[i].get("slides", []))
        expected = out_sec.get("estimatedSlides")
        first = section_first_index[i]
        if expected is not None and actual != expected and first is not None:
            note = (
                f"section {i + 1} planned {actual} slide(s) but the outline "
                f"estimated {expected}"
            )
            plans[first].setdefault("riskNotes", [])
            if isinstance(plans[first]["riskNotes"], list):
                plans[first]["riskNotes"].append(note)

    if len(plans) > max_total_slides:
        errors.append(
            f"total slide plans {len(plans)} exceeds the cap of {max_total_slides}"
        )

    validated: list[dict[str, Any]] = []
    for index, plan in enumerate(plans):
        result = validate_shared_schema_entity("SlidePlan", plan)
        if result.ok:
            validated.append(result.normalized if result.normalized is not None else plan)
        else:
            errors.append(f"slide {index + 1}: " + "; ".join(result.errors))

    ids = [p.get("slideId") for p in plans]
    if len(set(ids)) != len(ids):
        errors.append("slideIds are not unique across the plan set")

    return validated, errors


def plan_slides(
    provider: LLMProvider,
    outline: Mapping[str, Any],
    spec: Mapping[str, Any],
    *,
    max_total_slides: int,
    model: str | None = None,
    prompt_version: str = DEFAULT_PROMPT_VERSION,
    max_repair: int = 1,
) -> list[dict[str, Any]]:
    """Return a validated list of per-page `SlidePlan` dicts, or raise.

    Pure with respect to persistence: it never writes to the repository, so a raised
    `SlidePlanValidationError` inherently leaves no half-written state. A provider
    transport failure propagates as `LLMProviderError`.
    """

    system = load_prompt("slide_planner", prompt_version)
    user_payload = {"outline": dict(outline), "spec": dict(spec)}
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
    ]
    outline_sections = outline.get("sections") or []

    last_errors: tuple[str, ...] = ("no attempt made",)
    for attempt in range(max_repair + 1):
        text = provider.generate(
            messages, model=model, response_format=_JSON_RESPONSE_FORMAT
        )
        try:
            candidate = parse_json_object(text)
        except ValueError as exc:
            last_errors = (f"unparseable JSON: {exc}",)
        else:
            plans, errors = _assemble_plans(candidate, outline_sections, max_total_slides)
            if not errors:
                return plans
            last_errors = tuple(errors)

        if attempt < max_repair:
            messages = [
                *messages,
                {"role": "assistant", "content": text},
                {
                    "role": "user",
                    "content": (
                        "Your previous output was rejected: "
                        + "; ".join(last_errors)
                        + ". Return corrected slide plans as a JSON object only."
                    ),
                },
            ]

    raise SlidePlanValidationError(
        "slide planner output invalid after bounded repair: " + "; ".join(last_errors)
    )
