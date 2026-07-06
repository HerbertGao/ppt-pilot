import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SlidePlansPage from "@/app/projects/[id]/slide-plans/page";
import { VISUAL_INTENTS } from "@ppt-pilot/shared-schema";

import { defaultSlidePlans, installServer, project } from "./server";

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

describe("slide-plans page — SLIDE_PLAN_REVIEW renders one editable card per plan", () => {
  it("shows the plan fields (slideId/title/objective/keyMessage/…)", async () => {
    installServer({
      project: project({ status: "SLIDE_PLAN_REVIEW" }),
      slidePlans: defaultSlidePlans(),
    });
    render(<SlidePlansPage />);

    await waitFor(() => expect(screen.getByText(/slideId: slide-1/)).toBeTruthy());
    // Field inputs carry the seeded plan values.
    expect((screen.getByLabelText("目标") as HTMLTextAreaElement).value).toBe("介绍主题背景");
    expect((screen.getByLabelText("核心信息") as HTMLTextAreaElement).value).toBe(
      "理解主题的重要性",
    );
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
  });
});

describe("slide-plans page — visualIntent is a select constrained to the enum", () => {
  it("renders a combobox with exactly the 6 VisualIntent options, not a free-text box", async () => {
    installServer({
      project: project({ status: "SLIDE_PLAN_REVIEW" }),
      slidePlans: defaultSlidePlans(),
    });
    render(<SlidePlansPage />);

    await waitFor(() => expect(screen.getByText(/slideId: slide-1/)).toBeTruthy());

    const select = screen.getByRole("combobox", { name: "可视化意图" }) as HTMLSelectElement;
    // Not a free-text input.
    expect(screen.queryByRole("textbox", { name: "可视化意图" })).toBeNull();
    const options = within(select).getAllByRole("option") as HTMLOptionElement[];
    expect(options).toHaveLength(6);
    expect(options.map((o) => o.value)).toEqual([...VISUAL_INTENTS]);
  });
});

describe("slide-plans page — edit a single plan and save it", () => {
  it("PUTs /slides/slide-1/plan with the full plan; materialize CTA stays hidden (confirmed=false)", async () => {
    const server = installServer({
      project: project({ status: "SLIDE_PLAN_REVIEW" }),
      slidePlans: defaultSlidePlans({ slidePlansConfirmed: false }),
    });
    render(<SlidePlansPage />);
    await waitFor(() => expect(screen.getByText(/slideId: slide-1/)).toBeTruthy());
    const user = userEvent.setup();

    const objective = screen.getByLabelText("目标");
    await user.clear(objective);
    await user.type(objective, "修改后的目标");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("已保存")).toBeTruthy());
    expect(server.countOf("updateSlidePlan")).toBe(1);
    const call = server.calls.find((c) => c.key === "updateSlidePlan");
    expect(call?.path).toMatch(/\/slides\/slide-1\/plan$/);
    expect((call?.body as { objective: string }).objective).toBe("修改后的目标");
    // Save un-confirms -> no materialize CTA.
    expect(screen.queryByRole("button", { name: "物化幻灯片" })).toBeNull();
  });
});

describe("slide-plans page — save validation error keeps edits", () => {
  it("shows a validation banner and does not clear the edited field", async () => {
    installServer({
      project: project({ status: "SLIDE_PLAN_REVIEW" }),
      slidePlans: defaultSlidePlans(),
      errors: { updateSlidePlan: { status: 422, code: "SLIDE_PLAN_VALIDATION_ERROR" } },
    });
    render(<SlidePlansPage />);
    await waitFor(() => expect(screen.getByText(/slideId: slide-1/)).toBeTruthy());
    const user = userEvent.setup();

    const objective = screen.getByLabelText("目标");
    await user.clear(objective);
    await user.type(objective, "无效目标");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="validation"]')).toBeTruthy(),
    );
    // Edit is preserved.
    expect((screen.getByLabelText("目标") as HTMLTextAreaElement).value).toBe("无效目标");
  });
});

describe("slide-plans page — confirm then materialize", () => {
  it("confirm reveals the materialize CTA; clicking it transitions to SLIDE_GENERATION and navigates", async () => {
    const server = installServer({
      project: project({ status: "SLIDE_PLAN_REVIEW" }),
      slidePlans: defaultSlidePlans({ slidePlansConfirmed: false }),
    });
    render(<SlidePlansPage />);
    await waitFor(() => expect(screen.getByText(/slideId: slide-1/)).toBeTruthy());
    const user = userEvent.setup();

    // Before confirm: no materialize CTA.
    expect(screen.queryByRole("button", { name: "物化幻灯片" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "确认规划" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "物化幻灯片" })).toBeTruthy(),
    );
    expect(server.countOf("confirmSlidePlans")).toBe(1);

    await user.click(screen.getByRole("button", { name: "物化幻灯片" }));
    await waitFor(() =>
      expect(nav.router.push).toHaveBeenCalledWith("/projects/p1/preview"),
    );
    expect(server.bodyOf("transition")).toEqual({ to: "SLIDE_GENERATION" });
  });

  it("post-confirm edit+save hides the materialize CTA (derived, not one-shot)", async () => {
    const server = installServer({
      project: project({ status: "SLIDE_PLAN_REVIEW" }),
      slidePlans: defaultSlidePlans({ slidePlansConfirmed: false }),
    });
    render(<SlidePlansPage />);
    await waitFor(() => expect(screen.getByText(/slideId: slide-1/)).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "确认规划" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "物化幻灯片" })).toBeTruthy(),
    );

    // Edit a plan field then save its card — updateSlidePlan returns
    // slidePlansConfirmed=false, so the materialize CTA (derived) collapses. Fails
    // if it were a one-shot boolean latched on the first confirm.
    const objective = screen.getByLabelText("目标");
    await user.clear(objective);
    await user.type(objective, "修改后的目标");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(server.countOf("updateSlidePlan")).toBe(1));
    expect(screen.queryByRole("button", { name: "物化幻灯片" })).toBeNull();
  });
});

describe("slide-plans page — SLIDE_PLANNING never auto-transitions on mount", () => {
  it("does not generate on mount; a clicked 重试生成 runs generate + transition", async () => {
    const server = installServer({
      project: project({ status: "SLIDE_PLANNING" }),
      slidePlans: defaultSlidePlans(),
    });
    render(<SlidePlansPage />);

    // Mount NEVER drives a forward transition (web-workflow-shell invariant).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试生成" })).toBeTruthy(),
    );
    expect(server.countOf("generateSlidePlans")).toBe(0);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "重试生成" }));

    await waitFor(() => expect(server.countOf("generateSlidePlans")).toBe(1));
    const targets = server.calls
      .filter((c) => c.key === "transition")
      .map((c) => (c.body as { to: string }).to);
    expect(targets).toEqual(["SLIDE_PLAN_REVIEW"]);
    // Never re-runs the ① transition into SLIDE_PLANNING (already there).
    expect(targets).not.toContain("SLIDE_PLANNING");
  });

  it("shows an llm-retry banner + retry when a clicked generate fails", async () => {
    const server = installServer({
      project: project({ status: "SLIDE_PLANNING" }),
      slidePlans: defaultSlidePlans(),
      errors: { generateSlidePlans: { status: 502, code: "LLM_PROVIDER_ERROR" } },
    });
    render(<SlidePlansPage />);

    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试生成" })).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: "重试生成" }));

    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="llm-retry"]')).toBeTruthy(),
    );
    expect(server.countOf("generateSlidePlans")).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /重试/ })).toBeTruthy();
  });
});

describe("slide-plans page — mount guard redirects misplaced state", () => {
  it("replaces to the export page when state is EXPORT_READY", async () => {
    installServer({ project: project({ status: "EXPORT_READY" }) });
    render(<SlidePlansPage />);

    await waitFor(() =>
      expect(nav.router.replace).toHaveBeenCalledWith("/projects/p1/export"),
    );
    expect(screen.queryByRole("button", { name: "确认规划" })).toBeNull();
  });
});
