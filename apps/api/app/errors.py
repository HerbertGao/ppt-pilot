"""Phase 2 domain error hierarchy carrying the unified error contract.

Every error exposes two stable strings for the `{error, code, details}` contract
(see `main.py` exception handlers):

- `error`: the error *class* — one of VALIDATION_ERROR / STATE_ERROR / NOT_FOUND.
- `code`: the machine-readable stable code.

Concrete classes keep the `*Error` suffix used by `repository.py` / `projects.py`
imports; the three group bases (`ValidationError` / `StateError` / `NotFoundError`)
express the error-class grouping the handler maps to HTTP + `error`.
"""

from __future__ import annotations


class DomainError(Exception):
    error = "VALIDATION_ERROR"
    code = "VALIDATION_ERROR"
    field: str | None = None

    def __init__(self, message: str = "", *, field: str | None = None) -> None:
        super().__init__(message)
        if field is not None:
            self.field = field


class ValidationError(DomainError):
    error = "VALIDATION_ERROR"


class StateError(DomainError):
    error = "STATE_ERROR"


class NotFoundError(DomainError):
    error = "NOT_FOUND"


class UpstreamError(DomainError):
    # Subclasses DomainError so it flows through handle_domain_error; the handler
    # maps error -> HTTP via _STATUS_BY_ERROR, where UPSTREAM_ERROR is 502.
    error = "UPSTREAM_ERROR"


class InvalidSceneError(ValidationError):
    code = "INVALID_SCENE"
    field = "scene"


class StyleProfileMismatchError(ValidationError):
    code = "STYLE_PROFILE_MISMATCH"
    field = "styleProfileId"


class InvalidWorkflowStateError(ValidationError):
    code = "INVALID_WORKFLOW_STATE"
    field = "to"


class InvalidRequestBodyError(ValidationError):
    code = "INVALID_REQUEST_BODY"


class InvalidStateTransitionError(StateError):
    code = "INVALID_STATE_TRANSITION"
    field = "to"
    # Phase 5 note (task 7.1): action endpoints (outline/slide-plan) reuse this for
    # "wrong state" but have no `to` field, so their throw site must clear the class
    # default with `err = InvalidStateTransitionError(...); err.field = None`
    # (DomainError.__init__ only assigns field when not None, so passing field=None
    # won't override the class attr — reassign after construction). Not adding a
    # separate fieldless subclass: one throw-site line is smaller than a new class.


class ProjectNotFoundError(NotFoundError):
    code = "PROJECT_NOT_FOUND"
    field = "projectId"


class SpecValidationError(ValidationError):
    code = "SPEC_VALIDATION_ERROR"


class QuestionNotFoundError(NotFoundError):
    code = "QUESTION_NOT_FOUND"
    field = "questionId"


class SpecNotConfirmableError(StateError):
    code = "SPEC_NOT_CONFIRMABLE"


class LLMProviderError(UpstreamError):
    code = "LLM_PROVIDER_ERROR"


# --------------------------------------------------------------------------- #
# Phase 5 outline / slide-plan codes. HTTP status is derived from the base class
# via main.py::_STATUS_BY_ERROR (VALIDATION_ERROR=400 / STATE_ERROR=409 /
# NOT_FOUND=404), so no status-table change is needed.
# --------------------------------------------------------------------------- #


class OutlineValidationError(ValidationError):
    code = "OUTLINE_VALIDATION_ERROR"


class OutlineNotFoundError(NotFoundError):
    code = "OUTLINE_NOT_FOUND"


class OutlineNotConfirmableError(StateError):
    code = "OUTLINE_NOT_CONFIRMABLE"


class SlidePlanValidationError(ValidationError):
    code = "SLIDE_PLAN_VALIDATION_ERROR"


class SlidePlanNotFoundError(NotFoundError):
    code = "SLIDE_PLAN_NOT_FOUND"


class SlidePlanNotConfirmableError(StateError):
    code = "SLIDE_PLAN_NOT_CONFIRMABLE"
