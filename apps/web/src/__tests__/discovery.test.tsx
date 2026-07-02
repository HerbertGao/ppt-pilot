import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DiscoveryPage from "@/app/projects/[id]/discovery/page";
import { clearDiscoverySession } from "@/lib/discovery-session";
import type { DiscoverResponse, QuestionCard } from "@/lib/api";

import { installServer, project, defaultView, type FakeServer } from "./server";

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

function question(over: Partial<QuestionCard> = {}): QuestionCard {
  return {
    questionId: "q1",
    kind: "single",
    prompt: "受众是谁？",
    options: ["高管", "技术团队"],
    freeTextAllowed: true,
    ...over,
  };
}

function discover(over: Partial<DiscoverResponse> = {}): DiscoverResponse {
  return { ...defaultView(), questions: [question()], ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  clearDiscoverySession("p1");
});

describe("discovery page — first entry + question cards", () => {
  it("auto-drives NEW->DISCOVERY, discovers, and renders question cards", async () => {
    const server = installServer({
      project: project({ status: "NEW_PROJECT" }),
      discover: discover(),
    });
    render(<DiscoveryPage />);

    await waitFor(() => expect(screen.getByText("受众是谁？")).toBeTruthy());
    expect(screen.getByText("高管")).toBeTruthy();
    expect(screen.getByText("技术团队")).toBeTruthy();
    // Mount drove exactly one NEW->DISCOVERY transition and one discover.
    expect(server.bodyOf("transition")).toEqual({ to: "REQUIREMENT_DISCOVERY" });
    expect(server.countOf("discover")).toBe(1);
  });
});

describe("discovery page — answer / skip only update confidence", () => {
  async function mountWithTwoQuestions(): Promise<{ server: FakeServer; container: HTMLElement }> {
    const server = installServer({
      project: project({ status: "NEW_PROJECT" }),
      discover: discover({ questions: [question(), question({ questionId: "q2", prompt: "时长？" })] }),
      answer: defaultView({ confidence: 0.75 }),
      skip: defaultView({ confidence: 0.35 }),
    });
    const { container } = render(<DiscoveryPage />);
    await waitFor(() => expect(screen.getByText("受众是谁？")).toBeTruthy());
    return { server, container };
  }

  it("answer updates confidence, keeps the same cards, never re-discovers", async () => {
    const { server, container } = await mountWithTwoQuestions();
    const user = userEvent.setup();

    const q1 = container.querySelector('[data-question-id="q1"]') as HTMLElement;
    await user.click(within(q1).getAllByRole("checkbox")[0]!);
    await user.click(within(q1).getByRole("button", { name: "提交回答" }));

    await waitFor(() =>
      expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0.75"),
    );
    // Still two question cards; no re-discover; answer sent selectedOptions.
    expect(container.querySelectorAll("[data-question-id]")).toHaveLength(2);
    expect(server.countOf("discover")).toBe(1);
    expect(server.countOf("answer")).toBe(1);
    expect((server.bodyOf("answer") as { selectedOptions?: string[] }).selectedOptions).toEqual([
      "高管",
    ]);
    expect(q1.getAttribute("data-answered")).toBe("true");
  });

  it("skip marks the card skipped, updates confidence, never re-discovers", async () => {
    const { server, container } = await mountWithTwoQuestions();
    const user = userEvent.setup();

    const q1 = container.querySelector('[data-question-id="q1"]') as HTMLElement;
    await user.click(within(q1).getByRole("button", { name: "跳过" }));

    await waitFor(() =>
      expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0.35"),
    );
    expect(server.countOf("discover")).toBe(1);
    expect(server.countOf("skip")).toBe(1);
    expect(q1.getAttribute("data-skipped")).toBe("true");
  });
});

describe("discovery page — threshold reached / empty questions -> enter review", () => {
  it("shows the 'ready to review' card and drives DISCOVERY->REVIEW on explicit action", async () => {
    const server = installServer({
      project: project({ status: "NEW_PROJECT" }),
      discover: discover({ questions: [], thresholdReached: true, confidence: 0.9 }),
    });
    render(<DiscoveryPage />);

    // Ready card appears even with zero questions.
    await waitFor(() => expect(screen.getByText("信息已足够，可进入复核")).toBeTruthy());
    // The project has been driven to DISCOVERY (status pill reflects it).
    await waitFor(() => expect(screen.getByText("需求澄清")).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "进入复核" }));

    await waitFor(() =>
      expect(nav.router.push).toHaveBeenCalledWith("/projects/p1/review"),
    );
    // Exactly one extra transition (DISCOVERY->REVIEW) beyond the mount drive.
    expect(server.calls.filter((c) => c.key === "transition").map((c) => c.body)).toEqual([
      { to: "REQUIREMENT_DISCOVERY" },
      { to: "REQUIREMENT_REVIEW" },
    ]);
  });
});

describe("discovery page — QUESTION_NOT_FOUND is an explicit restart, not auto-discover", () => {
  it("invalidates the session and surfaces a restart CTA without re-discovering", async () => {
    const server = installServer({
      project: project({ status: "NEW_PROJECT" }),
      discover: discover(),
      errors: { answer: { status: 404, code: "QUESTION_NOT_FOUND" } },
    });
    const { container } = render(<DiscoveryPage />);
    await waitFor(() => expect(screen.getByText("受众是谁？")).toBeTruthy());
    const user = userEvent.setup();

    const q1 = container.querySelector('[data-question-id="q1"]') as HTMLElement;
    await user.click(within(q1).getAllByRole("checkbox")[0]!);
    await user.click(within(q1).getByRole("button", { name: "提交回答" }));

    // Session-invalid banner + explicit restart button, and NO automatic re-discover.
    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="session-invalid"]')).toBeTruthy(),
    );
    expect(screen.getAllByRole("button", { name: "重新开始澄清" }).length).toBeGreaterThan(0);
    expect(server.countOf("discover")).toBe(1); // not re-run automatically
  });
});

describe("discovery page — driven-transition failure does not crash", () => {
  it("surfaces INVALID_STATE_TRANSITION as a state-desync banner", async () => {
    const server = installServer({
      project: project({ status: "NEW_PROJECT" }),
      errors: { transition: { status: 409, code: "INVALID_STATE_TRANSITION" } },
    });
    render(<DiscoveryPage />);

    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="state-desync"]')).toBeTruthy(),
    );
    // Page still renders its mode controls; discover never ran (transition failed first).
    expect(screen.getByText("澄清模式")).toBeTruthy();
    expect(server.countOf("discover")).toBe(0);
  });
});
