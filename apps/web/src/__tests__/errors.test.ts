import { describe, expect, it } from "vitest";

import { ApiError, NETWORK_ERROR_CODE } from "@/lib/api";
import { presentError, type ErrorKind } from "@/lib/errors";

function apiError(code: string, over: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) {
  return new ApiError({ code, errorClass: "ERR", status: 400, ...over });
}

describe("presentError code mapping", () => {
  it("field codes carry the offending field", () => {
    const scene = presentError(apiError("INVALID_SCENE", { field: "scene" }));
    expect(scene.kind).toBe("field");
    expect(scene.field).toBe("scene");
    const style = presentError(apiError("STYLE_PROFILE_MISMATCH", { field: "styleProfileId" }));
    expect(style.kind).toBe("field");
    expect(style.field).toBe("styleProfileId");
  });

  it("QUESTION_NOT_FOUND is a session-invalid (explicit restart) kind", () => {
    expect(presentError(apiError("QUESTION_NOT_FOUND", { status: 404 })).kind).toBe(
      "session-invalid",
    );
  });

  it("state-transition/workflow codes map to state-desync (refresh)", () => {
    expect(presentError(apiError("INVALID_STATE_TRANSITION", { status: 409 })).kind).toBe(
      "state-desync",
    );
    expect(presentError(apiError("INVALID_WORKFLOW_STATE", { status: 409 })).kind).toBe(
      "state-desync",
    );
  });

  it("LLM provider + network errors are retryable", () => {
    expect(presentError(apiError("LLM_PROVIDER_ERROR", { status: 502 })).retryable).toBe(true);
    const net = presentError(apiError(NETWORK_ERROR_CODE, { status: 0 }));
    expect(net.kind).toBe("network");
    expect(net.retryable).toBe(true);
  });

  it("spec codes map to their own follow-up affordances", () => {
    expect(presentError(apiError("SPEC_NOT_CONFIRMABLE")).kind).toBe("rollback");
    expect(presentError(apiError("SPEC_VALIDATION_ERROR")).kind).toBe("validation");
  });

  it("not-found + bad-request codes do not crash and are non-retryable", () => {
    expect(presentError(apiError("PROJECT_NOT_FOUND", { status: 404 })).kind).toBe("not-found");
    expect(presentError(apiError("INVALID_REQUEST_BODY")).kind).toBe("fallback");
  });

  it("validation/materialize codes append the backend detail message", () => {
    const outline = presentError(
      apiError("OUTLINE_VALIDATION_ERROR", { detailMessage: "第 2 节缺少标题" }),
    );
    expect(outline.message).toBe("大纲内容未通过校验，已保持原状。：第 2 节缺少标题");
    const exportErr = presentError(
      apiError("EXPORT_VALIDATION_ERROR", { detailMessage: "缺少母版" }),
    );
    expect(exportErr.message).toBe("导出内容未通过校验。：缺少母版");
  });

  it("does not append (no dangling colon) when detail is absent", () => {
    const p = presentError(apiError("OUTLINE_VALIDATION_ERROR"));
    expect(p.message).toBe("大纲内容未通过校验，已保持原状。");
    expect(p.message).not.toContain("：");
  });

  it("unknown code falls back to details.message", () => {
    const p = presentError(apiError("SOMETHING_NEW", { detailMessage: "后端解释" }));
    expect(p.kind).toBe("fallback");
    expect(p.message).toBe("后端解释");
  });

  it("pins every Phase 5–7 error code to its mapped kind + a non-fallback title", () => {
    const cases: [string, ErrorKind][] = [
      ["INVALID_STATE_TRANSITION", "state-desync"],
      ["LLM_PROVIDER_ERROR", "llm-retry"],
      [NETWORK_ERROR_CODE, "network"],
      ["OUTLINE_NOT_CONFIRMABLE", "rollback"],
      ["OUTLINE_NOT_FOUND", "not-found"],
      ["OUTLINE_VALIDATION_ERROR", "validation"],
      ["SLIDE_PLAN_NOT_CONFIRMABLE", "rollback"],
      ["SLIDE_PLAN_NOT_FOUND", "not-found"],
      ["SLIDE_PLAN_VALIDATION_ERROR", "validation"],
      ["PRESENTATION_NOT_FOUND", "not-found"],
      ["SLIDES_NOT_MATERIALIZABLE", "rollback"],
      ["SLIDE_VALIDATION_ERROR", "validation"],
      ["EXPORT_NOT_READY", "rollback"],
      ["EXPORT_VALIDATION_ERROR", "validation"],
      ["EXPORT_ARTIFACT_NOT_FOUND", "not-found"],
    ];
    for (const [code, kind] of cases) {
      const p = presentError(apiError(code));
      expect(p.kind, code).toBe(kind);
      // A mapped code must carry its own title, never the generic fallback.
      expect(p.title, code).not.toBe("发生错误");
    }
  });

  it("non-ApiError thrown values still present without crashing", () => {
    const p = presentError(new Error("boom"));
    expect(p.kind).toBe("fallback");
    expect(p.message).toBe("boom");
    expect(presentError("weird").message).toBeTruthy();
  });
});
