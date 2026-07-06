/**
 * Maps an `ApiError` (`code`) to a human-readable presentation, per Phase 4
 * §2.2. Covers Phase 3 domain codes plus the Phase 2 codes reachable now that
 * the frontend drives `transitions`. Unknown codes fall back to
 * `details.message`. `kind` lets callers pick placement (field vs banner) and
 * follow-up affordances (retry / restart / rollback).
 */
import { ApiError, NETWORK_ERROR_CODE } from "./api";

export type ErrorKind =
  | "field" // attach to a form field (details.field)
  | "session-invalid" // clarification session gone: offer explicit restart, never auto-rediscover
  | "rollback" // must roll back before this action is possible
  | "validation" // spec failed validation; stay unconfirmed
  | "llm-retry" // upstream AI down; retryable
  | "state-desync" // client state stale; refresh
  | "not-found"
  | "network"
  | "fallback";

export interface PresentedError {
  kind: ErrorKind;
  title: string;
  message: string;
  /** Present for field-scoped errors. */
  field?: string | undefined;
  /** Whether a retry of the same action is sensible. */
  retryable: boolean;
}

interface Mapping {
  kind: ErrorKind;
  title: string;
  message: string;
  retryable?: boolean;
  /** Append the backend `details.message` after a 「：」 (validation/materialize codes). */
  appendDetail?: boolean;
}

const MAPPINGS: Record<string, Mapping> = {
  // --- Phase 3 domain codes ---
  INVALID_SCENE: {
    kind: "field",
    title: "场景无效",
    message: "所选场景取值无效，请重新选择。",
  },
  STYLE_PROFILE_MISMATCH: {
    kind: "field",
    title: "风格与场景不匹配",
    message: "所选风格与场景不匹配，请调整风格或场景。",
  },
  QUESTION_NOT_FOUND: {
    kind: "session-invalid",
    title: "澄清会话已失效",
    message: "该澄清会话已失效或被覆盖，请显式「重新开始澄清」。",
  },
  SPEC_NOT_CONFIRMABLE: {
    kind: "rollback",
    title: "当前无法确认",
    message: "当前状态无法确认，请先回退到需求澄清并重新走一遍流程。",
  },
  SPEC_VALIDATION_ERROR: {
    kind: "validation",
    title: "Spec 未通过校验",
    message: "生成的 Spec 未通过校验，已保持未确认状态。",
  },
  LLM_PROVIDER_ERROR: {
    kind: "llm-retry",
    title: "AI 服务暂不可用",
    message: "AI 服务暂时不可用，请稍后重试。",
    retryable: true,
  },
  // --- Phase 2 codes reachable via driven transitions ---
  INVALID_STATE_TRANSITION: {
    kind: "state-desync",
    title: "状态不同步",
    message: "工作流状态与页面不同步，请刷新页面后重试。",
  },
  INVALID_WORKFLOW_STATE: {
    kind: "state-desync",
    title: "状态不同步",
    message: "工作流状态与页面不同步，请刷新页面后重试。",
  },
  PROJECT_NOT_FOUND: {
    kind: "not-found",
    title: "项目不存在",
    message: "找不到该项目，请确认链接是否正确。",
  },
  // --- Phase 5–7 codes ---
  OUTLINE_NOT_CONFIRMABLE: {
    kind: "rollback",
    title: "当前无法生成大纲",
    message: "请先确认 Spec 后再生成大纲。",
  },
  SLIDE_PLAN_NOT_CONFIRMABLE: {
    kind: "rollback",
    title: "当前无法生成规划",
    message: "请先确认大纲后再生成规划。",
  },
  OUTLINE_VALIDATION_ERROR: {
    kind: "validation",
    title: "大纲校验失败",
    message: "大纲内容未通过校验，已保持原状。",
    appendDetail: true,
  },
  OUTLINE_NOT_FOUND: {
    kind: "not-found",
    title: "大纲不存在",
    message: "尚未生成大纲。",
  },
  SLIDE_PLAN_VALIDATION_ERROR: {
    kind: "validation",
    title: "规划校验失败",
    message: "幻灯片规划未通过校验，已保持原状。",
    appendDetail: true,
  },
  SLIDE_PLAN_NOT_FOUND: {
    kind: "not-found",
    title: "规划不存在",
    message: "尚未生成幻灯片规划。",
  },
  SLIDES_NOT_MATERIALIZABLE: {
    kind: "rollback",
    title: "当前无法物化",
    message: "请先确认幻灯片规划后再物化。",
    appendDetail: true,
  },
  SLIDE_VALIDATION_ERROR: {
    kind: "validation",
    title: "内容校验失败",
    message: "幻灯片内容未通过校验。",
    appendDetail: true,
  },
  PRESENTATION_NOT_FOUND: {
    kind: "not-found",
    title: "尚未物化",
    message: "尚未物化幻灯片，请先物化。",
  },
  EXPORT_NOT_READY: {
    kind: "rollback",
    title: "当前无法导出",
    message: "请先物化幻灯片后再导出。",
  },
  EXPORT_VALIDATION_ERROR: {
    kind: "validation",
    title: "导出校验失败",
    message: "导出内容未通过校验。",
    appendDetail: true,
  },
  EXPORT_ARTIFACT_NOT_FOUND: {
    kind: "not-found",
    title: "产物不存在",
    message: "该导出产物不存在。",
  },
  INVALID_REQUEST_BODY: {
    kind: "fallback",
    title: "请求无效",
    message: "请求无效，请检查输入后重试。",
  },
  [NETWORK_ERROR_CODE]: {
    kind: "network",
    title: "后端不可达",
    message: "无法连接到后端服务，请确认服务已启动（BACKEND_URL）。",
    retryable: true,
  },
};

/** Present any thrown value as a structured, non-crashing error. */
export function presentError(err: unknown): PresentedError {
  if (!(err instanceof ApiError)) {
    return {
      kind: "fallback",
      title: "发生错误",
      message: err instanceof Error && err.message ? err.message : "发生未知错误。",
      retryable: false,
    };
  }

  const mapping = MAPPINGS[err.code];
  if (mapping) {
    // Validation/materialize codes append the backend detail (empty -> static, no
    // dangling colon).
    const message =
      mapping.appendDetail && err.detailMessage
        ? `${mapping.message}：${err.detailMessage}`
        : mapping.message;
    return {
      kind: mapping.kind,
      title: mapping.title,
      message,
      field: mapping.kind === "field" ? err.field : undefined,
      retryable: mapping.retryable ?? false,
    };
  }

  // Unknown code -> fall back to backend details.message.
  return {
    kind: "fallback",
    title: "发生错误",
    message: err.detailMessage || err.message || "发生未知错误。",
    field: err.field,
    retryable: false,
  };
}
