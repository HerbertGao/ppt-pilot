import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ReviewPage from "@/app/projects/[id]/review/page";
import { clearDiscoverySession } from "@/lib/discovery-session";

import { installServer, project } from "./server";

const nav = vi.hoisted(() => ({
  router: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useParams: () => ({ id: "p1" }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  clearDiscoverySession("p1");
});

describe("review page — REVIEW mount shows only obtainable summary fields", () => {
  it("does not transition or confirm on mount; degrades to scene/style when no session", async () => {
    const server = installServer({ project: project({ status: "REQUIREMENT_REVIEW" }) });
    render(<ReviewPage />);

    await waitFor(() => expect(screen.getByText("确认前摘要")).toBeTruthy());
    // No cached session (hard-refresh degrade): only scene/style, explicit degrade note.
    expect(screen.getByText(/仅展示场景与风格/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "确认 Spec" })).toBeTruthy();
    // Mount never drove a transition and never auto-confirmed.
    expect(server.countOf("transition")).toBe(0);
    expect(server.countOf("confirm")).toBe(0);
    expect(nav.router.replace).not.toHaveBeenCalled();
  });
});

describe("review page — confirm renders the full spec from the confirm response", () => {
  it("shows questionPolicy + riskNotes only after a successful confirm", async () => {
    installServer({ project: project({ status: "REQUIREMENT_REVIEW" }) });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText("确认前摘要")).toBeTruthy());
    // Pre-confirm: no questionPolicy/riskNotes are invented.
    expect(screen.queryByText("已确认的 Spec")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "确认 Spec" }));

    await waitFor(() => expect(screen.getByText("已确认的 Spec")).toBeTruthy());
    expect(screen.getByText("示例风险提示")).toBeTruthy(); // riskNotes from confirm response
    expect(screen.getByText("提问策略")).toBeTruthy(); // questionPolicy block
  });
});

describe("review page — non-REVIEW mount redirects back to discovery (reset window)", () => {
  it("redirects and shows no confirm button, no transition", async () => {
    const server = installServer({ project: project({ status: "REQUIREMENT_DISCOVERY" }) });
    render(<ReviewPage />);

    await waitFor(() =>
      expect(nav.router.replace).toHaveBeenCalledWith("/projects/p1/discovery"),
    );
    expect(screen.queryByRole("button", { name: "确认 Spec" })).toBeNull();
    expect(server.countOf("transition")).toBe(0);
  });
});

describe("review page — profile change is rollback-first (PATCH only in DISCOVERY)", () => {
  it("rolls REVIEW->DISCOVERY, then PATCHes, then routes to discovery", async () => {
    const server = installServer({ project: project({ status: "REQUIREMENT_REVIEW" }) });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText("确认前摘要")).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "修改 profile" }));
    await user.click(screen.getByRole("button", { name: "回退并重新澄清" }));

    await waitFor(() =>
      expect(nav.router.push).toHaveBeenCalledWith("/projects/p1/discovery"),
    );
    const keys = server.calls.map((c) => c.key);
    const transitionIdx = keys.indexOf("transition");
    const patchIdx = keys.indexOf("updateProfile");
    expect(transitionIdx).toBeGreaterThanOrEqual(0);
    expect(patchIdx).toBeGreaterThan(transitionIdx); // PATCH strictly after rollback
    expect(server.bodyOf("transition")).toEqual({ to: "REQUIREMENT_DISCOVERY" });
  });
});

describe("review page — rollback commits but PATCH fails (partial failure)", () => {
  it("re-fetches and redirects out of the now-stale REVIEW instead of stranding a doomed confirm button", async () => {
    // transition (REVIEW->DISCOVERY) succeeds and mutates backend status; the
    // following PATCH fails on the network. The page must not keep rendering
    // REVIEW: it re-fetches, sees DISCOVERY, and the mount guard redirects.
    const server = installServer({
      project: project({ status: "REQUIREMENT_REVIEW" }),
      network: { updateProfile: true },
    });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText("确认前摘要")).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "修改 profile" }));
    await user.click(screen.getByRole("button", { name: "回退并重新澄清" }));

    // Rollback committed (backend now DISCOVERY), PATCH was attempted and failed.
    expect(server.countOf("transition")).toBe(1);
    expect(server.countOf("updateProfile")).toBe(1);
    // Guard redirects to discovery rather than leaving a stale confirmable REVIEW.
    await waitFor(() =>
      expect(nav.router.replace).toHaveBeenCalledWith("/projects/p1/discovery"),
    );
  });
});

describe("review page — confirm validation error stays unconfirmed", () => {
  it("shows a validation banner and does not render the confirmed spec", async () => {
    installServer({
      project: project({ status: "REQUIREMENT_REVIEW" }),
      errors: { confirm: { status: 422, code: "SPEC_VALIDATION_ERROR" } },
    });
    render(<ReviewPage />);
    await waitFor(() => expect(screen.getByText("确认前摘要")).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "确认 Spec" }));

    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="validation"]')).toBeTruthy(),
    );
    expect(screen.queryByText("已确认的 Spec")).toBeNull();
  });
});
