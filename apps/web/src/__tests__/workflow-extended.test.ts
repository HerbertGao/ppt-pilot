import { WORKFLOW_STATES, type WorkflowState } from "@ppt-pilot/shared-schema";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import {
  chainGenerateOutline,
  chainGenerateSlidePlans,
  currentStepPath,
  discoveryPath,
  enterExport,
  enterOutline,
  enterPreview,
  enterSlidePlans,
  exportPath,
  guardExportMount,
  guardOutlineMount,
  guardPreviewMount,
  guardSlidePlansMount,
  outlinePath,
  planEnterExport,
  planEnterOutline,
  planEnterPreview,
  planEnterSlidePlans,
  previewPath,
  reviewPath,
  slidePlansPath,
} from "@/lib/workflow";

import { installServer, project } from "./server";

// Expected step-page owner for every WorkflowState (the whole currentStepPath map).
const EXPECTED_PATH: Record<WorkflowState, (id: string) => string> = {
  NEW_PROJECT: discoveryPath,
  REQUIREMENT_DISCOVERY: discoveryPath,
  REQUIREMENT_REVIEW: reviewPath,
  OUTLINE_GENERATION: outlinePath,
  OUTLINE_REVIEW: outlinePath,
  SLIDE_PLANNING: slidePlansPath,
  SLIDE_PLAN_REVIEW: slidePlansPath,
  SLIDE_GENERATION: previewPath,
  EDITING: previewPath,
  REVIEW: previewPath,
  EXPORT_READY: exportPath,
  EXPORTED: exportPath,
};

/** Helper: every state NOT in `accept`. */
function statesOutside(accept: readonly WorkflowState[]): WorkflowState[] {
  return WORKFLOW_STATES.filter((s) => !accept.includes(s));
}

describe("currentStepPath (all 12 states)", () => {
  it("maps every WorkflowState to its unique owner page", () => {
    for (const state of WORKFLOW_STATES) {
      expect(currentStepPath("p1", state)).toBe(EXPECTED_PATH[state]("p1"));
    }
  });

  it("covers the full state enum (no state falls through)", () => {
    // If a state were missing from EXPECTED_PATH the loop above couldn't run;
    // this guards the inverse — EXPECTED_PATH has no extra/stale keys.
    expect(Object.keys(EXPECTED_PATH).sort()).toEqual([...WORKFLOW_STATES].sort());
  });

  it("encodes the projectId in the path", () => {
    expect(currentStepPath("a/b", "OUTLINE_REVIEW")).toBe(outlinePath("a/b"));
    expect(currentStepPath("a/b", "OUTLINE_REVIEW")).toContain("a%2Fb");
  });

  it("is a pure function — no fetch / side effects", () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    for (const state of WORKFLOW_STATES) {
      currentStepPath("p1", state);
      guardOutlineMount("p1", state);
      guardSlidePlansMount("p1", state);
      guardPreviewMount("p1", state);
      guardExportMount("p1", state);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("mount guards (accept-set members stay, others redirect)", () => {
  const cases: Array<{
    name: string;
    guard: (id: string, s: WorkflowState) => string | null;
    accept: readonly WorkflowState[];
  }> = [
    { name: "outline", guard: guardOutlineMount, accept: ["OUTLINE_GENERATION", "OUTLINE_REVIEW"] },
    {
      name: "slide-plans",
      guard: guardSlidePlansMount,
      accept: ["SLIDE_PLANNING", "SLIDE_PLAN_REVIEW"],
    },
    {
      name: "preview",
      guard: guardPreviewMount,
      accept: ["SLIDE_GENERATION", "EXPORT_READY", "EXPORTED"],
    },
    { name: "export", guard: guardExportMount, accept: ["EXPORT_READY", "EXPORTED"] },
  ];

  for (const { name, guard, accept } of cases) {
    it(`${name}: returns null for every accepted state`, () => {
      for (const state of accept) {
        expect(guard("p1", state)).toBeNull();
      }
    });
    it(`${name}: redirects to currentStepPath for every other state`, () => {
      for (const state of statesOutside(accept)) {
        expect(guard("p1", state)).toBe(currentStepPath("p1", state));
      }
    });
  }

  it("preview and export overlap on EXPORT_READY/EXPORTED (both accept)", () => {
    for (const state of ["EXPORT_READY", "EXPORTED"] as WorkflowState[]) {
      expect(guardPreviewMount("p1", state)).toBeNull();
      expect(guardExportMount("p1", state)).toBeNull();
    }
  });
});

describe("pure enter-planners (precondition / target / other branches)", () => {
  const cases: Array<{
    name: string;
    plan: (s: WorkflowState) => { transitionTo: WorkflowState | null; navigate: boolean };
    from: WorkflowState;
    target: WorkflowState;
    alsoNavigateOnly: WorkflowState[];
  }> = [
    {
      name: "planEnterOutline",
      plan: planEnterOutline,
      from: "OUTLINE_GENERATION",
      target: "OUTLINE_REVIEW",
      alsoNavigateOnly: [],
    },
    {
      name: "planEnterSlidePlans",
      plan: planEnterSlidePlans,
      from: "SLIDE_PLANNING",
      target: "SLIDE_PLAN_REVIEW",
      alsoNavigateOnly: [],
    },
    {
      name: "planEnterPreview",
      plan: planEnterPreview,
      from: "SLIDE_PLAN_REVIEW",
      target: "SLIDE_GENERATION",
      // EXPORT_READY/EXPORTED are past the target -> navigate only (no self-loop back).
      alsoNavigateOnly: ["EXPORT_READY", "EXPORTED"],
    },
    {
      name: "planEnterExport",
      plan: planEnterExport,
      from: "SLIDE_GENERATION",
      target: "EXPORT_READY",
      alsoNavigateOnly: ["EXPORTED"],
    },
  ];

  for (const { name, plan, from, target, alsoNavigateOnly } of cases) {
    it(`${name}: precondition state transitions to target`, () => {
      expect(plan(from)).toEqual({ transitionTo: target, navigate: true });
    });
    it(`${name}: target (and later) states navigate only, never self-transition`, () => {
      for (const state of [target, ...alsoNavigateOnly]) {
        expect(plan(state)).toEqual({ transitionTo: null, navigate: true });
      }
    });
    it(`${name}: all other states are ineligible`, () => {
      const handled = new Set<WorkflowState>([from, target, ...alsoNavigateOnly]);
      for (const state of WORKFLOW_STATES) {
        if (handled.has(state)) continue;
        expect(plan(state)).toEqual({ transitionTo: null, navigate: false });
      }
    });
  }
});

describe("enter async helpers (planner + api.transition composition)", () => {
  it("enterOutline transitions OUTLINE_GENERATION -> OUTLINE_REVIEW", async () => {
    const server = installServer({ project: project({ status: "OUTLINE_GENERATION" }) });
    const res = await enterOutline("p1", "OUTLINE_GENERATION");
    expect(res.navigate).toBe(true);
    expect(res.transition?.status).toBe("OUTLINE_REVIEW");
    expect(server.bodyOf("transition")).toEqual({ to: "OUTLINE_REVIEW" });
  });

  it("enterOutline navigates-only when already OUTLINE_REVIEW (no transition)", async () => {
    const server = installServer({ project: project({ status: "OUTLINE_REVIEW" }) });
    const res = await enterOutline("p1", "OUTLINE_REVIEW");
    expect(res).toEqual({ navigate: true, transition: null });
    expect(server.countOf("transition")).toBe(0);
  });

  it("enterPreview transitions SLIDE_PLAN_REVIEW -> SLIDE_GENERATION", async () => {
    const server = installServer({ project: project({ status: "SLIDE_PLAN_REVIEW" }) });
    const res = await enterPreview("p1", "SLIDE_PLAN_REVIEW");
    expect(res.transition?.status).toBe("SLIDE_GENERATION");
    expect(server.bodyOf("transition")).toEqual({ to: "SLIDE_GENERATION" });
  });

  it("enterPreview navigates-only from EXPORT_READY (never self-loops back)", async () => {
    const server = installServer({ project: project({ status: "EXPORT_READY" }) });
    const res = await enterPreview("p1", "EXPORT_READY");
    expect(res).toEqual({ navigate: true, transition: null });
    expect(server.countOf("transition")).toBe(0);
  });

  it("enterExport transitions SLIDE_GENERATION -> EXPORT_READY", async () => {
    const server = installServer({ project: project({ status: "SLIDE_GENERATION" }) });
    await enterExport("p1", "SLIDE_GENERATION");
    expect(server.bodyOf("transition")).toEqual({ to: "EXPORT_READY" });
  });

  it("enterSlidePlans is a no-op action from an ineligible state", async () => {
    const server = installServer({ project: project({ status: "REQUIREMENT_REVIEW" }) });
    const res = await enterSlidePlans("p1", "REQUIREMENT_REVIEW");
    expect(res).toEqual({ navigate: false, transition: null });
    expect(server.countOf("transition")).toBe(0);
  });
});

describe("chained generation helpers (transition -> generate -> transition)", () => {
  it("chainGenerateOutline runs all three steps in order on success", async () => {
    const server = installServer({ project: project({ status: "REQUIREMENT_REVIEW" }) });
    const res = await chainGenerateOutline("p1");
    expect(res.ok).toBe(true);
    const keys = server.calls.map((c) => c.key);
    expect(keys).toEqual(["transition", "generateOutline", "transition"]);
    expect(server.calls[0]?.body).toEqual({ to: "OUTLINE_GENERATION" });
    expect(server.calls[2]?.body).toEqual({ to: "OUTLINE_REVIEW" });
  });

  it("chainGenerateOutline: step ② failure skips step ③ and returns the error", async () => {
    const server = installServer({
      project: project({ status: "REQUIREMENT_REVIEW" }),
      errors: { generateOutline: { status: 502, code: "LLM_PROVIDER_ERROR" } },
    });
    const res = await chainGenerateOutline("p1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBeInstanceOf(ApiError);
      expect((res.error as ApiError).code).toBe("LLM_PROVIDER_ERROR");
    }
    // Only the first transition (to OUTLINE_GENERATION) fired; ③ was skipped.
    expect(server.countOf("transition")).toBe(1);
    expect(server.bodyOf("transition")).toEqual({ to: "OUTLINE_GENERATION" });
  });

  it("chainGenerateOutline: step ① failure short-circuits (no generate, no ③)", async () => {
    const server = installServer({
      project: project({ status: "REQUIREMENT_REVIEW" }),
      errors: { transition: { status: 409, code: "INVALID_STATE_TRANSITION" } },
    });
    const res = await chainGenerateOutline("p1");
    expect(res.ok).toBe(false);
    expect(server.countOf("generateOutline")).toBe(0);
    expect(server.countOf("transition")).toBe(1);
  });

  it("chainGenerateSlidePlans runs all three steps in order on success", async () => {
    const server = installServer({ project: project({ status: "OUTLINE_REVIEW" }) });
    const res = await chainGenerateSlidePlans("p1");
    expect(res.ok).toBe(true);
    const keys = server.calls.map((c) => c.key);
    expect(keys).toEqual(["transition", "generateSlidePlans", "transition"]);
    expect(server.calls[0]?.body).toEqual({ to: "SLIDE_PLANNING" });
    expect(server.calls[2]?.body).toEqual({ to: "SLIDE_PLAN_REVIEW" });
  });

  it("chainGenerateSlidePlans: step ② failure skips step ③", async () => {
    const server = installServer({
      project: project({ status: "OUTLINE_REVIEW" }),
      errors: { generateSlidePlans: { status: 409, code: "SLIDE_PLAN_NOT_CONFIRMABLE" } },
    });
    const res = await chainGenerateSlidePlans("p1");
    expect(res.ok).toBe(false);
    expect(server.countOf("transition")).toBe(1);
    expect(server.bodyOf("transition")).toEqual({ to: "SLIDE_PLANNING" });
  });
});
