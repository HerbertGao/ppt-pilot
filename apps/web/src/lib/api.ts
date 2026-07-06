/**
 * Type-safe, same-origin (`/api/*`) client for the Phase 3 backend.
 *
 * Request/response shapes for canonical entities come from
 * `@ppt-pilot/shared-schema`; Phase 3 transient responses (question cards,
 * confidence views) are described by local types below — they are not canonical
 * entities and have no schema export.
 *
 * Every non-2xx response is parsed as the unified `{error, code, details}`
 * envelope and thrown as `ApiError`. Network failures (proxy target down) throw
 * an `ApiError` with `code === "NETWORK_ERROR"`, so callers never see an
 * unstructured exception.
 */
import type {
  ExportArtifact,
  Outline,
  Presentation,
  QuestionMode,
  QuestionPolicy,
  Scene,
  SlidePlan,
  WorkflowState,
} from "@ppt-pilot/shared-schema";

// --------------------------------------------------------------------------- //
// Structured error
// --------------------------------------------------------------------------- //

export interface ErrorEnvelope {
  error: string;
  code: string;
  details?: { field?: string; message?: string };
}

/** Synthetic code for "the request never reached the backend". */
export const NETWORK_ERROR_CODE = "NETWORK_ERROR";

export class ApiError extends Error {
  /** Stable business code (`INVALID_SCENE`, ...) or `NETWORK_ERROR`. */
  readonly code: string;
  /** Error class from the envelope (`VALIDATION_ERROR` / `STATE_ERROR` / ...). */
  readonly errorClass: string;
  /** HTTP status, or 0 for a network failure. */
  readonly status: number;
  /** Offending field for field-scoped validation errors. */
  readonly field?: string | undefined;
  /** Backend `details.message`, used for unknown-code fallback display. */
  readonly detailMessage?: string | undefined;

  constructor(args: {
    code: string;
    errorClass: string;
    status: number;
    field?: string | undefined;
    detailMessage?: string | undefined;
  }) {
    super(args.detailMessage || args.code);
    this.name = "ApiError";
    this.code = args.code;
    this.errorClass = args.errorClass;
    this.status = args.status;
    this.field = args.field;
    this.detailMessage = args.detailMessage;
  }
}

// --------------------------------------------------------------------------- //
// Response types — canonical fields reuse schema types; transient views local.
// --------------------------------------------------------------------------- //

export interface ProjectCreateResponse {
  projectId: string;
  status: WorkflowState;
}

export interface ProjectSummary {
  projectId: string;
  title: string;
  scene: Scene;
  styleProfileId: string;
  status: WorkflowState;
}

export interface TransitionResponse {
  projectId: string;
  status: WorkflowState;
}

/** Phase 3 transient: a rendered clarification question card. */
export interface QuestionCard {
  questionId: string;
  kind: string;
  prompt: string;
  options: string[];
  freeTextAllowed: boolean;
}

/** Phase 3 transient: confidence/threshold view returned by answer/skip. */
export interface SessionView {
  confidence: number;
  threshold: number;
  thresholdReached: boolean;
  skippedQuestionIds: string[];
  nextState: WorkflowState;
}

/** discover = session view + the freshly generated question cards. */
export interface DiscoverResponse extends SessionView {
  questions: QuestionCard[];
}

export interface ConfirmResponse {
  presentationSpecId: string;
  confirmed: boolean;
  scene: Scene;
  styleProfileId: string;
  questionPolicy: QuestionPolicy;
  riskNotes: string[];
  nextState: WorkflowState;
}

export interface ProfileResponse {
  projectId: string;
  scene: Scene;
  styleProfileId: string;
  status: WorkflowState;
}

// --------------------------------------------------------------------------- //
// Phase 5–7 response types — canonical fields reuse schema types.
// --------------------------------------------------------------------------- //

/** Phase 5 slide-plan read shape: shared by generate/update/confirm/GET. */
export interface SlidePlansPayload {
  slidePlans: SlidePlan[];
  slidePlansConfirmed: boolean;
}

/**
 * Phase 7 export metadata: an `ExportArtifact` without the unbounded
 * `bytesBase64` field. The list/POST endpoints serve this shape; the
 * single-item download serves the raw bytes via a separate endpoint.
 */
export type ExportArtifactMetadata = Omit<ExportArtifact, "bytesBase64">;

// --------------------------------------------------------------------------- //
// Request types
// --------------------------------------------------------------------------- //

export interface CreateProjectInput {
  title?: string;
  initialRequest?: string;
  scene?: Scene;
  styleProfileId?: string;
}

export interface DiscoverInput {
  mode?: QuestionMode;
  maxQuestions?: number;
  scene?: Scene;
  styleProfileId?: string;
}

export interface AnswerInput {
  answer?: string;
  selectedOptions?: string[];
}

export interface SkipInput {
  reason?: string;
}

export interface ProfileInput {
  scene?: Scene;
  styleProfileId?: string;
}

// --------------------------------------------------------------------------- //
// Core fetch wrapper
// --------------------------------------------------------------------------- //

async function apiFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal | undefined },
): Promise<T> {
  const requestInit: RequestInit = { method: init?.method ?? "GET" };
  if (init?.body !== undefined) {
    requestInit.headers = { "Content-Type": "application/json" };
    requestInit.body = JSON.stringify(init.body);
  }
  if (init?.signal) {
    requestInit.signal = init.signal;
  }

  let response: Response;
  try {
    response = await fetch(path, requestInit);
  } catch (cause) {
    // fetch rejects (TypeError) only on network / proxy-unreachable failures.
    throw new ApiError({
      code: NETWORK_ERROR_CODE,
      errorClass: NETWORK_ERROR_CODE,
      status: 0,
      detailMessage: cause instanceof Error ? cause.message : "network request failed",
    });
  }

  if (response.ok) {
    // 2xx with no body (shouldn't happen on these endpoints) -> {} as T.
    const text = await response.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // A malformed 2xx body (e.g. the proxy returning an HTML page with 200)
      // must still surface as a structured ApiError, per this module's contract
      // ("callers never see an unstructured exception") — mirroring toApiError.
      throw new ApiError({
        code: "MALFORMED_RESPONSE",
        errorClass: "MALFORMED_RESPONSE",
        status: response.status,
        detailMessage: "响应体解析失败",
      });
    }
  }

  throw await toApiError(response);
}

export async function toApiError(response: Response): Promise<ApiError> {
  let envelope: Partial<ErrorEnvelope> = {};
  try {
    const parsed = (await response.json()) as unknown;
    if (parsed && typeof parsed === "object") {
      envelope = parsed as Partial<ErrorEnvelope>;
    }
  } catch {
    // Non-JSON body (e.g. a proxy error page): fall through to fallback below.
  }
  return new ApiError({
    code: typeof envelope.code === "string" ? envelope.code : "UNKNOWN_ERROR",
    errorClass: typeof envelope.error === "string" ? envelope.error : "UNKNOWN_ERROR",
    status: response.status,
    field: envelope.details?.field,
    detailMessage: envelope.details?.message,
  });
}

/**
 * Raw-`fetch` wrapper for endpoints that return non-JSON (e.g. binary streams).
 * Mirrors `apiFetch`'s error handling: network failures synthesize
 * `NETWORK_ERROR`, non-2xx responses are parsed as the `{error, code, details}`
 * envelope and thrown as `ApiError`. Returns the raw `Response` so callers can
 * call `.blob()` / `.arrayBuffer()` / etc.
 */
export async function blobFetch(
  path: string,
  init?: { method?: string; signal?: AbortSignal | undefined },
): Promise<Response> {
  const requestInit: RequestInit = { method: init?.method ?? "GET" };
  if (init?.signal) {
    requestInit.signal = init.signal;
  }

  let response: Response;
  try {
    response = await fetch(path, requestInit);
  } catch (cause) {
    throw new ApiError({
      code: NETWORK_ERROR_CODE,
      errorClass: NETWORK_ERROR_CODE,
      status: 0,
      detailMessage: cause instanceof Error ? cause.message : "network request failed",
    });
  }

  if (response.ok) return response;
  throw await toApiError(response);
}

// --------------------------------------------------------------------------- //
// Endpoint functions
// --------------------------------------------------------------------------- //

export const api = {
  createProject(input: CreateProjectInput, signal?: AbortSignal) {
    return apiFetch<ProjectCreateResponse>("/api/projects", {
      method: "POST",
      body: input,
      signal,
    });
  },

  getProject(projectId: string, signal?: AbortSignal) {
    return apiFetch<ProjectSummary>(`/api/projects/${encodeURIComponent(projectId)}`, {
      signal,
    });
  },

  transition(projectId: string, to: WorkflowState, signal?: AbortSignal) {
    return apiFetch<TransitionResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/transitions`,
      { method: "POST", body: { to }, signal },
    );
  },

  discover(projectId: string, input: DiscoverInput = {}, signal?: AbortSignal) {
    return apiFetch<DiscoverResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/requirements/discover`,
      { method: "POST", body: input, signal },
    );
  },

  answerQuestion(
    projectId: string,
    questionId: string,
    input: AnswerInput,
    signal?: AbortSignal,
  ) {
    return apiFetch<SessionView>(
      `/api/projects/${encodeURIComponent(projectId)}/requirements/questions/${encodeURIComponent(
        questionId,
      )}/answer`,
      { method: "POST", body: input, signal },
    );
  },

  skipQuestion(
    projectId: string,
    questionId: string,
    input: SkipInput = {},
    signal?: AbortSignal,
  ) {
    return apiFetch<SessionView>(
      `/api/projects/${encodeURIComponent(projectId)}/requirements/questions/${encodeURIComponent(
        questionId,
      )}/skip`,
      { method: "POST", body: input, signal },
    );
  },

  confirm(projectId: string, signal?: AbortSignal) {
    return apiFetch<ConfirmResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/requirements/confirm`,
      { method: "POST", body: {}, signal },
    );
  },

  updateProfile(projectId: string, input: ProfileInput, signal?: AbortSignal) {
    return apiFetch<ProfileResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/profile`,
      { method: "PATCH", body: input, signal },
    );
  },

  // --- Phase 5 outline (returns bare Outline) ---
  generateOutline(projectId: string, signal?: AbortSignal) {
    return apiFetch<Outline>(
      `/api/projects/${encodeURIComponent(projectId)}/outline/generate`,
      { method: "POST", body: {}, signal },
    );
  },

  updateOutline(projectId: string, outline: Outline, signal?: AbortSignal) {
    return apiFetch<Outline>(
      `/api/projects/${encodeURIComponent(projectId)}/outline`,
      { method: "PUT", body: outline, signal },
    );
  },

  confirmOutline(projectId: string, signal?: AbortSignal) {
    return apiFetch<Outline>(
      `/api/projects/${encodeURIComponent(projectId)}/outline/confirm`,
      { method: "POST", body: {}, signal },
    );
  },

  getOutline(projectId: string, signal?: AbortSignal) {
    return apiFetch<Outline>(
      `/api/projects/${encodeURIComponent(projectId)}/outline`,
      { signal },
    );
  },

  // --- Phase 5 slide plans (returns {slidePlans, slidePlansConfirmed}) ---
  generateSlidePlans(projectId: string, signal?: AbortSignal) {
    return apiFetch<SlidePlansPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/slides/plans/generate`,
      { method: "POST", body: {}, signal },
    );
  },

  updateSlidePlan(
    projectId: string,
    slideId: string,
    plan: SlidePlan,
    signal?: AbortSignal,
  ) {
    return apiFetch<SlidePlansPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/slides/${encodeURIComponent(
        slideId,
      )}/plan`,
      { method: "PUT", body: plan, signal },
    );
  },

  confirmSlidePlans(projectId: string, signal?: AbortSignal) {
    return apiFetch<SlidePlansPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/slides/plans/confirm`,
      { method: "POST", body: {}, signal },
    );
  },

  getSlidePlans(projectId: string, signal?: AbortSignal) {
    return apiFetch<SlidePlansPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/slides/plans`,
      { signal },
    );
  },

  // --- Phase 6 presentation (returns bare Presentation) ---
  materialize(projectId: string, signal?: AbortSignal) {
    return apiFetch<Presentation>(
      `/api/projects/${encodeURIComponent(projectId)}/slides/materialize`,
      { method: "POST", body: {}, signal },
    );
  },

  getPresentation(projectId: string, signal?: AbortSignal) {
    return apiFetch<Presentation>(
      `/api/projects/${encodeURIComponent(projectId)}/presentation`,
      { signal },
    );
  },

  // --- Phase 7 export (metadata only; download goes through blobFetch) ---
  exportPptx(projectId: string, signal?: AbortSignal) {
    return apiFetch<ExportArtifactMetadata>(
      `/api/projects/${encodeURIComponent(projectId)}/export`,
      { method: "POST", body: {}, signal },
    );
  },

  listExports(projectId: string, signal?: AbortSignal) {
    return apiFetch<{ exports: ExportArtifactMetadata[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/exports`,
      { signal },
    );
  },

  downloadExport(projectId: string, artifactId: string, signal?: AbortSignal) {
    return blobFetch(
      `/api/projects/${encodeURIComponent(projectId)}/export/${encodeURIComponent(
        artifactId,
      )}`,
      { signal },
    );
  },
};
