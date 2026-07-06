import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OutlinePage from "@/app/projects/[id]/outline/page";

import { defaultOutline, installServer, project } from "./server";

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

function transitionTargets(server: ReturnType<typeof installServer>): string[] {
  return server.calls
    .filter((c) => c.key === "transition")
    .map((c) => (c.body as { to: string }).to);
}

describe("outline page — OUTLINE_REVIEW renders an editable section list", () => {
  it("fetches the bare outline and renders each section's fields", async () => {
    installServer({ project: project({ status: "OUTLINE_REVIEW" }), outline: defaultOutline() });
    render(<OutlinePage />);

    await waitFor(() => expect(screen.getByText("大纲")).toBeTruthy());
    expect(screen.getByDisplayValue("引言")).toBeTruthy();
    expect(screen.getByDisplayValue("核心内容")).toBeTruthy();
    expect(screen.getByDisplayValue("总结")).toBeTruthy();
    // Unconfirmed outline -> no "generate slide plans" CTA.
    expect(screen.queryByRole("button", { name: /生成幻灯片规划/ })).toBeNull();
  });
});

describe("outline page — edit + whole-outline save", () => {
  it("PUTs the full outline with the edit and keeps the CTA hidden (save un-confirms)", async () => {
    const server = installServer({
      project: project({ status: "OUTLINE_REVIEW" }),
      outline: defaultOutline({ confirmedByUser: false }),
    });
    render(<OutlinePage />);
    await waitFor(() => expect(screen.getByDisplayValue("引言")).toBeTruthy());
    const user = userEvent.setup();

    const titleInput = screen.getByDisplayValue("引言");
    await user.clear(titleInput);
    await user.type(titleInput, "开场");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(server.countOf("updateOutline")).toBe(1));
    const body = server.bodyOf("updateOutline") as { sections: { title: string }[] };
    expect(body.sections[0]?.title).toBe("开场");
    expect(screen.queryByRole("button", { name: /生成幻灯片规划/ })).toBeNull();
  });

  it("keeps local edits and shows a validation banner when PUT /outline fails", async () => {
    installServer({
      project: project({ status: "OUTLINE_REVIEW" }),
      outline: defaultOutline(),
      errors: { updateOutline: { status: 422, code: "OUTLINE_VALIDATION_ERROR" } },
    });
    render(<OutlinePage />);
    await waitFor(() => expect(screen.getByDisplayValue("引言")).toBeTruthy());
    const user = userEvent.setup();

    const titleInput = screen.getByDisplayValue("引言");
    await user.clear(titleInput);
    await user.type(titleInput, "开场");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="validation"]')).toBeTruthy(),
    );
    // Edit preserved, not wiped.
    expect(screen.getByDisplayValue("开场")).toBeTruthy();
  });
});

describe("outline page — confirm reveals the next-step CTA (derived from confirmedByUser)", () => {
  it("shows the generate-slide-plans CTA only after a successful confirm", async () => {
    installServer({
      project: project({ status: "OUTLINE_REVIEW" }),
      outline: defaultOutline({ confirmedByUser: false }),
    });
    render(<OutlinePage />);
    await waitFor(() => expect(screen.getByDisplayValue("引言")).toBeTruthy());
    const user = userEvent.setup();

    expect(screen.queryByRole("button", { name: /生成幻灯片规划/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "确认大纲" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /生成幻灯片规划/ })).toBeTruthy(),
    );
  });

  it("confirm failure (INVALID_STATE_TRANSITION) shows an error and no CTA", async () => {
    installServer({
      project: project({ status: "OUTLINE_REVIEW" }),
      outline: defaultOutline(),
      errors: { confirmOutline: { status: 409, code: "INVALID_STATE_TRANSITION" } },
    });
    render(<OutlinePage />);
    await waitFor(() => expect(screen.getByDisplayValue("引言")).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "确认大纲" }));
    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="state-desync"]')).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: /生成幻灯片规划/ })).toBeNull();
  });
});

describe("outline page — confirm then chained slide-plan generation", () => {
  it("runs transition->generate->transition and navigates to /slide-plans", async () => {
    const server = installServer({
      project: project({ status: "OUTLINE_REVIEW" }),
      outline: defaultOutline(),
    });
    render(<OutlinePage />);
    await waitFor(() => expect(screen.getByDisplayValue("引言")).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "确认大纲" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /生成幻灯片规划/ })).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: /生成幻灯片规划/ }));

    await waitFor(() =>
      expect(nav.router.push).toHaveBeenCalledWith("/projects/p1/slide-plans"),
    );
    expect(server.countOf("generateSlidePlans")).toBe(1);
    expect(transitionTargets(server)).toEqual(["SLIDE_PLANNING", "SLIDE_PLAN_REVIEW"]);
    const chainOrder = server.calls
      .map((c) => c.key)
      .filter((k) => k === "transition" || k === "generateSlidePlans");
    expect(chainOrder).toEqual(["transition", "generateSlidePlans", "transition"]);
  });

  it("reaches /slide-plans via the mount guard when step ② fails (no push)", async () => {
    const server = installServer({
      project: project({ status: "OUTLINE_REVIEW" }),
      outline: defaultOutline(),
      errors: { generateSlidePlans: { status: 502, code: "LLM_PROVIDER_ERROR" } },
    });
    render(<OutlinePage />);
    await waitFor(() => expect(screen.getByDisplayValue("引言")).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "确认大纲" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /生成幻灯片规划/ })).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: /生成幻灯片规划/ }));

    // Step ② failed; ③ short-circuited. The handler no longer push()es — refresh()
    // re-reads state as SLIDE_PLANNING and the mount guard replaces to /slide-plans.
    await waitFor(() =>
      expect(nav.router.replace).toHaveBeenCalledWith("/projects/p1/slide-plans"),
    );
    expect(nav.router.push).not.toHaveBeenCalled();
    expect(server.countOf("generateSlidePlans")).toBe(1);
    expect(transitionTargets(server)).toEqual(["SLIDE_PLANNING"]); // only ① ran
  });

  it("stays on outline with an error when step ① (transition) fails (no navigation)", async () => {
    const server = installServer({
      project: project({ status: "OUTLINE_REVIEW" }),
      outline: defaultOutline(),
      errors: { transition: { status: 409, code: "INVALID_STATE_TRANSITION" } },
    });
    render(<OutlinePage />);
    await waitFor(() => expect(screen.getByDisplayValue("引言")).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "确认大纲" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /生成幻灯片规划/ })).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: /生成幻灯片规划/ }));

    // ① (transition to SLIDE_PLANNING) failed: state is unchanged so the mount
    // guard keeps us on outline and the source-page banner surfaces the mapped
    // error (D3) — never a silent bounce.
    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="state-desync"]')).toBeTruthy(),
    );
    expect(nav.router.push).not.toHaveBeenCalled();
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect(server.countOf("generateSlidePlans")).toBe(0); // ② short-circuited
    expect(server.countOf("transition")).toBe(1); // only ① attempted
    // Still on the outline editor in OUTLINE_REVIEW.
    expect(screen.getByDisplayValue("引言")).toBeTruthy();
  });

  it("threads an AbortSignal into the chained slide-plan generation (unmount-safe)", async () => {
    installServer({ project: project({ status: "OUTLINE_REVIEW" }), outline: defaultOutline() });
    render(<OutlinePage />);
    await waitFor(() => expect(screen.getByDisplayValue("引言")).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "确认大纲" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /生成幻灯片规划/ })).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: /生成幻灯片规划/ }));
    await waitFor(() =>
      expect(nav.router.push).toHaveBeenCalledWith("/projects/p1/slide-plans"),
    );

    // Both chain transitions carry the component's AbortSignal, so leaving the page
    // mid-chain aborts them (and the guarded router.push never fires unmounted).
    const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
      .mock.calls;
    const chainTransitions = calls.filter(([p]) => String(p).endsWith("/transitions"));
    expect(chainTransitions.length).toBe(2);
    expect(chainTransitions.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
  });
});

describe("outline page — post-confirm edit hides the CTA (derived, not one-shot)", () => {
  it("confirm reveals the CTA; a later edit+save removes it (save un-confirms)", async () => {
    const server = installServer({
      project: project({ status: "OUTLINE_REVIEW" }),
      outline: defaultOutline({ confirmedByUser: false }),
    });
    render(<OutlinePage />);
    await waitFor(() => expect(screen.getByDisplayValue("引言")).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "确认大纲" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /生成幻灯片规划/ })).toBeTruthy(),
    );

    // Edit a section field then save — updateOutline returns confirmedByUser=false,
    // so the CTA (derived from confirmedByUser) collapses. Fails if it were a
    // one-shot boolean latched on the first confirm.
    const titleInput = screen.getByDisplayValue("引言");
    await user.clear(titleInput);
    await user.type(titleInput, "开场");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(server.countOf("updateOutline")).toBe(1));
    expect(screen.queryByRole("button", { name: /生成幻灯片规划/ })).toBeNull();
  });
});

describe("outline page — OUTLINE_GENERATION never auto-transitions on mount", () => {
  it("does not generate on mount; a clicked 重试生成 runs generate + transition into the editor", async () => {
    const server = installServer({
      project: project({ status: "OUTLINE_GENERATION" }),
      outline: defaultOutline(),
    });
    render(<OutlinePage />);

    // Mount NEVER drives a forward transition (web-workflow-shell invariant).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试生成" })).toBeTruthy(),
    );
    expect(server.countOf("generateOutline")).toBe(0);
    expect(transitionTargets(server)).toEqual([]);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "重试生成" }));

    await waitFor(() => expect(screen.getByDisplayValue("引言")).toBeTruthy());
    expect(server.countOf("generateOutline")).toBe(1);
    expect(transitionTargets(server)).toContain("OUTLINE_REVIEW");
    // Never re-runs the ① transition into OUTLINE_GENERATION (already there).
    expect(transitionTargets(server)).not.toContain("OUTLINE_GENERATION");
  });

  it("shows an llm-retry banner + retry when a clicked generate fails", async () => {
    const server = installServer({
      project: project({ status: "OUTLINE_GENERATION" }),
      errors: { generateOutline: { status: 502, code: "LLM_PROVIDER_ERROR" } },
    });
    render(<OutlinePage />);

    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试生成" })).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: "重试生成" }));

    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="llm-retry"]')).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "重试生成" })).toBeTruthy();
    expect(server.countOf("generateOutline")).toBeGreaterThanOrEqual(1);
    // Never re-runs the ① transition into OUTLINE_GENERATION (already there).
    expect(transitionTargets(server)).not.toContain("OUTLINE_GENERATION");
  });
});

describe("outline page — mount guard redirects a mismatched state", () => {
  it("redirects past-OUTLINE_REVIEW states to the current step page", async () => {
    installServer({ project: project({ status: "SLIDE_PLAN_REVIEW" }) });
    render(<OutlinePage />);

    await waitFor(() =>
      expect(nav.router.replace).toHaveBeenCalledWith("/projects/p1/slide-plans"),
    );
    expect(screen.queryByText("大纲")).toBeNull();
  });
});
