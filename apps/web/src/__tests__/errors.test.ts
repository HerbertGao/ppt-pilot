import { describe, expect, it } from "vitest";

import { ApiError, NETWORK_ERROR_CODE } from "@/lib/api";
import { presentError } from "@/lib/errors";

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

  it("unknown code falls back to details.message", () => {
    const p = presentError(apiError("SOMETHING_NEW", { detailMessage: "后端解释" }));
    expect(p.kind).toBe("fallback");
    expect(p.message).toBe("后端解释");
  });

  it("non-ApiError thrown values still present without crashing", () => {
    const p = presentError(new Error("boom"));
    expect(p.kind).toBe("fallback");
    expect(p.message).toBe("boom");
    expect(presentError("weird").message).toBeTruthy();
  });
});
