import { WORKFLOW_STATES, type WorkflowState } from "@ppt-pilot/shared-schema";
import { describe, expect, it } from "vitest";

import {
  changeProfileRollbackFirst,
  discoveryPath,
  enterDiscovery,
  enterReview,
  guardDiscoveryMount,
  guardReviewMount,
  isConfirmable,
  planEnterDiscovery,
  planEnterReview,
  reviewPath,
} from "@/lib/workflow";

import { installServer, project } from "./server";

const OTHERS = WORKFLOW_STATES.filter(
  (s) => s !== "NEW_PROJECT" && s !== "REQUIREMENT_DISCOVERY" && s !== "REQUIREMENT_REVIEW",
);

describe("planEnterDiscovery", () => {
  it("drives NEW_PROJECT -> REQUIREMENT_DISCOVERY", () => {
    expect(planEnterDiscovery("NEW_PROJECT")).toBe("REQUIREMENT_DISCOVERY");
  });
  it("is a no-op for every non-NEW state", () => {
    for (const state of WORKFLOW_STATES) {
      if (state === "NEW_PROJECT") continue;
      expect(planEnterDiscovery(state)).toBeNull();
    }
  });
});

describe("planEnterReview", () => {
  it("DISCOVERY -> transition to REVIEW then navigate", () => {
    expect(planEnterReview("REQUIREMENT_DISCOVERY")).toEqual({
      transitionTo: "REQUIREMENT_REVIEW",
      navigate: true,
    });
  });
  it("REVIEW -> navigate only, never self-transition", () => {
    expect(planEnterReview("REQUIREMENT_REVIEW")).toEqual({
      transitionTo: null,
      navigate: true,
    });
  });
  it("any other state -> ineligible (no transition, no navigate)", () => {
    for (const state of [...OTHERS, "NEW_PROJECT" as WorkflowState]) {
      expect(planEnterReview(state)).toEqual({ transitionTo: null, navigate: false });
    }
  });
});

describe("mount guards", () => {
  it("review page redirects to discovery unless state == REVIEW", () => {
    expect(guardReviewMount("p1", "REQUIREMENT_REVIEW")).toBeNull();
    for (const state of WORKFLOW_STATES) {
      if (state === "REQUIREMENT_REVIEW") continue;
      expect(guardReviewMount("p1", state)).toBe(discoveryPath("p1"));
    }
  });

  it("discovery page redirects to review only when state == REVIEW", () => {
    expect(guardDiscoveryMount("p1", "REQUIREMENT_REVIEW")).toBe(reviewPath("p1"));
    for (const state of WORKFLOW_STATES) {
      if (state === "REQUIREMENT_REVIEW") continue;
      expect(guardDiscoveryMount("p1", state)).toBeNull();
    }
  });

  it("guards are mutually exclusive -> no redirect loop for any state", () => {
    for (const state of WORKFLOW_STATES) {
      const reviewRedirect = guardReviewMount("p1", state);
      const discoveryRedirect = guardDiscoveryMount("p1", state);
      // At most one page redirects; whichever redirects lands on a page that stays.
      expect(reviewRedirect !== null && discoveryRedirect !== null).toBe(false);
    }
  });
});

describe("isConfirmable", () => {
  it("is true only in REQUIREMENT_REVIEW", () => {
    for (const state of WORKFLOW_STATES) {
      expect(isConfirmable(state)).toBe(state === "REQUIREMENT_REVIEW");
    }
  });
});

describe("enterDiscovery (async)", () => {
  it("transitions NEW -> DISCOVERY and returns the new state", async () => {
    const server = installServer({ project: project({ status: "NEW_PROJECT" }) });
    const next = await enterDiscovery("p1", "NEW_PROJECT");
    expect(next).toBe("REQUIREMENT_DISCOVERY");
    expect(server.countOf("transition")).toBe(1);
    expect(server.bodyOf("transition")).toEqual({ to: "REQUIREMENT_DISCOVERY" });
  });

  it("is a no-op when already in DISCOVERY", async () => {
    const server = installServer({ project: project({ status: "REQUIREMENT_DISCOVERY" }) });
    const next = await enterDiscovery("p1", "REQUIREMENT_DISCOVERY");
    expect(next).toBe("REQUIREMENT_DISCOVERY");
    expect(server.countOf("transition")).toBe(0);
  });
});

describe("enterReview (async)", () => {
  it("DISCOVERY transitions to REVIEW and signals navigate", async () => {
    const server = installServer({ project: project({ status: "REQUIREMENT_DISCOVERY" }) });
    const res = await enterReview("p1", "REQUIREMENT_DISCOVERY");
    expect(res.navigate).toBe(true);
    expect(res.transition?.status).toBe("REQUIREMENT_REVIEW");
    expect(server.bodyOf("transition")).toEqual({ to: "REQUIREMENT_REVIEW" });
  });

  it("already-REVIEW navigates without transitioning", async () => {
    const server = installServer({ project: project({ status: "REQUIREMENT_REVIEW" }) });
    const res = await enterReview("p1", "REQUIREMENT_REVIEW");
    expect(res.navigate).toBe(true);
    expect(res.transition).toBeNull();
    expect(server.countOf("transition")).toBe(0);
  });

  it("other states neither transition nor navigate", async () => {
    const server = installServer({ project: project({ status: "NEW_PROJECT" }) });
    const res = await enterReview("p1", "NEW_PROJECT");
    expect(res.navigate).toBe(false);
    expect(server.countOf("transition")).toBe(0);
  });
});

describe("changeProfileRollbackFirst (rollback-first, PATCH only in DISCOVERY)", () => {
  it("rolls REVIEW -> DISCOVERY before PATCHing profile", async () => {
    const server = installServer({ project: project({ status: "REQUIREMENT_REVIEW" }) });
    await changeProfileRollbackFirst("p1", "REQUIREMENT_REVIEW", { scene: "education" });

    const keys = server.calls.map((c) => c.key);
    const transitionIdx = keys.indexOf("transition");
    const patchIdx = keys.indexOf("updateProfile");
    expect(transitionIdx).toBeGreaterThanOrEqual(0);
    expect(patchIdx).toBeGreaterThan(transitionIdx); // PATCH strictly after rollback
    expect(server.bodyOf("transition")).toEqual({ to: "REQUIREMENT_DISCOVERY" });
    // The project was already rolled to DISCOVERY when the PATCH landed.
    expect(server.calls[patchIdx]?.key).toBe("updateProfile");
    expect(server.project.status).toBe("REQUIREMENT_DISCOVERY");
  });

  it("PATCHes directly when already in DISCOVERY (no rollback transition)", async () => {
    const server = installServer({ project: project({ status: "REQUIREMENT_DISCOVERY" }) });
    await changeProfileRollbackFirst("p1", "REQUIREMENT_DISCOVERY", { scene: "corporate" });
    expect(server.countOf("transition")).toBe(0);
    expect(server.countOf("updateProfile")).toBe(1);
  });

  it("refuses (throws, no network) from an unexpected state", async () => {
    const server = installServer({ project: project({ status: "NEW_PROJECT" }) });
    await expect(
      changeProfileRollbackFirst("p1", "NEW_PROJECT", { scene: "default" }),
    ).rejects.toThrow();
    expect(server.calls).toHaveLength(0);
  });
});
