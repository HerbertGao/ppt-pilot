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
