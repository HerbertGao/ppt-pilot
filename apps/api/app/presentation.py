"""Phase 6 slide-materialization service layer (task 3.x), mirroring `slide_plan.py`.

Deterministic, LLM-free, Asset-free: turns a confirmed `SlidePlan[]` + confirmed
`PresentationSpec` into a `Presentation` that passes `validateEntity("Presentation")`.
No-side-effect invariant: the assembled ThemeTokens AND the whole Presentation are
validated BEFORE any persistent write, so a rejected request leaves the stored
presentation and the event sequence untouched (zero persist on failure).

State vs content preconditions are layered (design D5): a wrong-state call raises
`InvalidStateTransitionError` (409) with its default `field="to"` cleared;
`SLIDES_NOT_MATERIALIZABLE` means "in SLIDE_GENERATION but spec/plans are not
confirmed" (None-safe, dict access). Materialize does NOT advance the workflow
state (nextState == current state) and is replay-safe (whole-set overwrite).
"""

from __future__ import annotations

from typing import Any

from .errors import (
    InvalidStateTransitionError,
    PresentationNotFoundError,
    SlidesNotMaterializableError,
    SlideValidationError,
)
from .events import build_event, validate_event
from .repository import Repository
from .shared_schema_adapter import validate_shared_schema_entity

SLIDE_GENERATION = "SLIDE_GENERATION"

# Deterministic sentinel timestamp (design D7): never wall-clock, so repeat
# materialization is byte-identical and golden fixtures stay lockable.
MATERIALIZED_TIMESTAMP = "2026-07-01T00:00:00.000Z"

# visualIntent -> ElementType (design D1/D6). image falls to `shape` this phase:
# validateElement forces `content.assetId` on image elements and there are no
# Assets yet. `text` produces no visual element (title + body only).
_INTENT_TO_ELEMENT: dict[str, str] = {
    "chart": "chart",
    "diagram": "diagram",
    "comparison": "shape",
    "timeline": "shape",
    "image": "shape",
}

# Deterministic base-layout token templates (design D6). Geometry is driven by
# whether the slide carries a visual placeholder; unknown layoutSuggestion falls
# to the default template with a soft note (never a hard failure).
_KNOWN_LAYOUTS = {
    "title-and-body",
    "title-only",
    "title-and-visual",
    "split",
    "title plus image",
}


def _wrong_state(message: str) -> InvalidStateTransitionError:
    """Wrong-state action call: reuse InvalidStateTransitionError but clear its
    default `field="to"` (no `to` on an action endpoint)."""

    err = InvalidStateTransitionError(message)
    err.field = None
    return err


def _theme_for(scene: str, style_profile_id: str) -> dict[str, Any]:
    """Deterministic ThemeTokens derived from scene/styleProfile (design D3).

    Kept small on purpose: one base theme whose primary accent varies by scene.
    ponytail: single base palette; add per-scene palettes when visual polish matters.
    """

    accent = {
        "corporate": "#4F9CF9",
        "education": "#F5A623",
        "creative": "#B368F0",
        "technical": "#2ECC71",
    }.get(scene, "#4F9CF9")
    return {
        "palette": {
            "background": "#0B1F3A",
            "surface": "#13294B",
            "primary": accent,
            "text": "#F5F7FA",
            "muted": "#9AB0C7",
        },
        "fonts": {
            "heading": "Inter, sans-serif",
            "body": "Inter, sans-serif",
            "mono": "JetBrains Mono, monospace",
        },
        "spacing": {"xs": 4, "sm": 8, "md": 16, "lg": 32, "gutter": "5%"},
    }


def _element(
    element_id: str,
    slide_id: str,
    element_type: str,
    content: dict[str, Any],
    *,
    x: int,
    y: int,
    width: int,
    height: int,
    z_index: int,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Fill every required Element field deterministically (design D6)."""

    return {
        "id": element_id,
        "slideId": slide_id,
        "type": element_type,
        "content": content,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "rotation": 0,
        "zIndex": z_index,
        "style": {},
        "locked": False,
        "metadata": metadata or {},
    }


def _build_slide(
    plan: dict[str, Any], index: int, presentation_id: str
) -> dict[str, Any]:
    slide_id = plan["slideId"]
    # slide.title top-level is required non-empty; SlidePlan.title is optional so
    # fall back to the required keyMessage (design D6).
    title_text = plan.get("title") or plan["keyMessage"]

    visual_intent = plan.get("visualIntent", "text")
    element_type = _INTENT_TO_ELEMENT.get(visual_intent)
    has_visual = element_type is not None

    layout = plan.get("layoutSuggestion")
    note_meta: dict[str, Any] = {}
    if layout not in _KNOWN_LAYOUTS:
        # Soft note, never a hard failure (design D6): unknown layout -> default.
        note_meta = {"layoutNote": f"unknown layoutSuggestion {layout!r}; used default"}

    elements: list[dict[str, Any]] = [
        _element(
            f"{slide_id}_title",
            slide_id,
            "text",
            {"kind": "title", "text": title_text},
            x=80,
            y=60,
            width=1120,
            height=120,
            z_index=1,
            metadata=note_meta,
        )
    ]

    body_width = 620 if has_visual else 1120
    elements.append(
        _element(
            f"{slide_id}_body",
            slide_id,
            "text",
            {"kind": "body", "text": plan["keyMessage"]},
            x=80,
            y=220,
            width=body_width,
            height=400,
            z_index=2,
        )
    )

    if has_visual:
        elements.append(
            _element(
                f"{slide_id}_visual",
                slide_id,
                element_type,
                {
                    "kind": "placeholder",
                    "placeholder": True,
                    "placeholderFor": visual_intent,
                    "caption": plan["keyMessage"],
                },
                x=740,
                y=220,
                width=460,
                height=400,
                z_index=3,
            )
        )

    # slide.plan is a COPY of the source plan with requiredAssets=[] (design D6):
    # there are no Assets this phase, so a non-empty requiredAssets would fail the
    # validatePresentation requiredAssets<->$.assets cross-check. The source plan on
    # project.slidePlans keeps its original requiredAssets for a later Image phase.
    plan_copy = dict(plan)
    plan_copy["requiredAssets"] = []

    return {
        "id": slide_id,
        "presentationId": presentation_id,
        "index": index,  # 1-based (design D6)
        "title": title_text,
        "status": "planned",
        "locked": False,
        "plan": plan_copy,
        "elements": elements,
        "createdAt": MATERIALIZED_TIMESTAMP,
        "updatedAt": MATERIALIZED_TIMESTAMP,
    }


def materialize(
    repository: Repository,
    project_id: str,
) -> dict[str, Any]:
    """Deterministically materialize + persist a `Presentation` and append
    SLIDES_MATERIALIZED. Does not advance the workflow state; replay-safe."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    if project.state != SLIDE_GENERATION:
        raise _wrong_state(
            "slides can only be materialized while the project is in SLIDE_GENERATION"
        )

    spec = project.spec
    # None-safe content preconditions (dict access): never dereference None.
    if not (spec is not None and spec.get("confirmedByUser")):
        raise SlidesNotMaterializableError(
            "spec must be confirmed before materializing slides"
        )
    plans = project.slidePlans
    if not plans or not project.slidePlansConfirmed:
        raise SlidesNotMaterializableError(
            "slide plans must be confirmed and non-empty before materializing"
        )
    # Plans are validated at generation, but `slideId` is schema-optional and both
    # `slideId`/`keyMessage` are hard-subscripted when building slides. Guard here so
    # a stored plan missing either yields a clean 400, never a raw KeyError/500.
    # ponytail: defense-in-depth behind the generator's slideId-assignment invariant.
    for plan in plans:
        if not plan.get("slideId") or not plan.get("keyMessage"):
            raise SlideValidationError(
                "each confirmed slide plan must carry a slideId and keyMessage"
            )

    presentation_id = f"pres_{project.projectId}"
    scene = spec["scene"]
    theme = _theme_for(scene, spec.get("styleProfileId", ""))
    presentation = {
        "id": presentation_id,
        "projectId": project.projectId,
        "title": spec.get("topic") or project.title,
        "spec": spec,  # embed the confirmed, already-validated PresentationSpec
        "theme": theme,
        "scene": scene,  # validatePresentation requires scene == spec.scene
        "styleProfileId": spec.get("styleProfileId"),
        "assets": [],  # no Assets this phase (design D6)
        "slides": [
            _build_slide(plan, i, presentation_id)
            for i, plan in enumerate(plans, start=1)
        ],
        "createdAt": MATERIALIZED_TIMESTAMP,
        "updatedAt": MATERIALIZED_TIMESTAMP,
    }

    # validate-before-persist (design D5): ThemeTokens first (validatePresentation
    # is loose on theme), then the whole Presentation for full cross-reference
    # consistency. Either failing -> SLIDE_VALIDATION_ERROR (400), zero persist.
    theme_result = validate_shared_schema_entity("ThemeTokens", theme)
    if not theme_result.ok:
        raise SlideValidationError("; ".join(theme_result.errors) or "theme rejected")
    pres_result = validate_shared_schema_entity("Presentation", presentation)
    if not pres_result.ok:
        raise SlideValidationError(
            "; ".join(pres_result.errors) or "presentation rejected"
        )

    # Build -> validate -> append the event BEFORE any persistent write.
    event = build_event(
        project_id,
        "SLIDES_MATERIALIZED",
        {"slideCount": len(presentation["slides"]), "nextState": project.state},
        actor="ai",
    )
    validate_event(event)  # raises before any append
    repository.append_event(project_id, event)

    # Whole-set overwrite (replay-safe); store the normalized dict. Does NOT
    # advance the workflow state.
    normalized = pres_result.normalized if pres_result.normalized is not None else presentation
    project.presentation = normalized
    return normalized


def read_presentation(
    repository: Repository,
    project_id: str,
) -> dict[str, Any]:
    """Read the persisted Presentation; missing -> PRESENTATION_NOT_FOUND (404)."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    if project.presentation is None:
        raise PresentationNotFoundError("no materialized presentation for this project")
    return project.presentation
