import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@ppt-pilot/shared-schema";

import PreviewPage from "@/app/projects/[id]/preview/page";

import { defaultPresentation, installServer, project } from "./server";

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

/** Minimal valid Slide (renderSlide/renderThumbnail render an empty-element slide). */
function slide(over: Partial<Slide> = {}): Slide {
  return {
    id: "s1",
    presentationId: "pres-p1",
    index: 0,
    title: "引言",
    status: "draft",
    plan: {
      objective: "介绍主题背景",
      keyMessage: "理解主题",
      contentIntent: "text",
      visualIntent: "text",
      layoutSuggestion: "title-content",
      requiredAssets: [],
      riskNotes: [],
    },
    elements: [],
    locked: false,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...over,
  };
}

describe("preview page — not materialized shows a materialize button, not an error", () => {
  it("catches PRESENTATION_NOT_FOUND as an empty state", async () => {
    // No presentation in config -> GET /presentation 404s PRESENTATION_NOT_FOUND.
    const server = installServer({ project: project({ status: "SLIDE_GENERATION" }) });
    render(<PreviewPage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "物化幻灯片" })).toBeTruthy(),
    );
    // The 404 is an empty state, NOT an error banner.
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(server.countOf("getPresentation")).toBeGreaterThanOrEqual(1);
  });
});

describe("preview page — materialize renders the deck from the renderer output", () => {
  it("calls materialize and injects renderer HTML into the preview container", async () => {
    const server = installServer({ project: project({ status: "SLIDE_GENERATION" }) });
    render(<PreviewPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "物化幻灯片" })).toBeTruthy(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "物化幻灯片" }));

    await waitFor(() => expect(screen.getByTestId("deck-preview")).toBeTruthy());
    expect(server.countOf("materialize")).toBe(1);
    // Injected content comes from the renderer (renderPresentation on empty slides),
    // never hand-assembled — the deck title from defaultPresentation appears.
    expect(screen.getByTestId("deck-preview").textContent).toContain("测试演示文稿");
    // The slide containment CSS (slideBaseCss) is injected alongside the deck.
    expect(document.querySelector("style")?.textContent).toContain(".ppt-slide");
  });
});

describe("preview page — thumbnails list + click switches the main preview", () => {
  it("renders one thumbnail per slide and switches renderSlide output on click", async () => {
    installServer({
      project: project({ status: "SLIDE_GENERATION" }),
      presentation: defaultPresentation({
        slides: [
          slide({ id: "s1", index: 0, title: "引言" }),
          slide({ id: "s2", index: 1, title: "核心内容" }),
        ],
      }),
    });
    render(<PreviewPage />);

    await waitFor(() => expect(screen.getByTestId("thumbnails")).toBeTruthy());
    const thumbs = within(screen.getByTestId("thumbnails")).getAllByRole("button");
    expect(thumbs.length).toBe(2);
    // No materialize button — already materialized.
    expect(screen.queryByRole("button", { name: "物化幻灯片" })).toBeNull();

    // Main preview defaults to the first slide.
    expect(screen.getByTestId("deck-preview").textContent).toContain("引言");
    expect(screen.getByTestId("deck-preview").textContent).not.toContain("核心内容");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("slide-thumb-1"));

    await waitFor(() =>
      expect(screen.getByTestId("deck-preview").textContent).toContain("核心内容"),
    );
  });
});

describe("preview page — read-only when already exportable", () => {
  it("shows the preview + a link to export, no materialize button (EXPORT_READY)", async () => {
    installServer({
      project: project({ status: "EXPORT_READY" }),
      presentation: defaultPresentation({ slides: [slide()] }),
    });
    render(<PreviewPage />);

    await waitFor(() => expect(screen.getByTestId("deck-preview")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "物化幻灯片" })).toBeNull();
    expect(screen.queryByRole("button", { name: "进入导出" })).toBeNull();
    expect(screen.getByRole("button", { name: "前往导出页" })).toBeTruthy();
  });
});

describe("preview page — enter export drives the transition then navigates", () => {
  it("POSTs transition {to: EXPORT_READY} and pushes the export route", async () => {
    const server = installServer({
      project: project({ status: "SLIDE_GENERATION" }),
      presentation: defaultPresentation({ slides: [slide()] }),
    });
    render(<PreviewPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "进入导出" })).toBeTruthy(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "进入导出" }));

    await waitFor(() =>
      expect(nav.router.push).toHaveBeenCalledWith("/projects/p1/export"),
    );
    expect(server.bodyOf("transition")).toEqual({ to: "EXPORT_READY" });
  });
});

describe("preview page — materialize failure shows error + back-to-plans link", () => {
  it("keeps the empty state and offers a route back to the plans page", async () => {
    installServer({
      project: project({ status: "SLIDE_GENERATION" }),
      errors: { materialize: { status: 409, code: "SLIDES_NOT_MATERIALIZABLE" } },
    });
    render(<PreviewPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "物化幻灯片" })).toBeTruthy(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "物化幻灯片" }));

    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="rollback"]')).toBeTruthy(),
    );
    const backButton = screen.getByRole("button", { name: "返回规划页" });
    await user.click(backButton);
    expect(nav.router.push).toHaveBeenCalledWith("/projects/p1/slide-plans");
  });
});

describe("preview page — mount guard redirects off-page state", () => {
  it("replaces to the plans page when state is SLIDE_PLAN_REVIEW", async () => {
    const server = installServer({ project: project({ status: "SLIDE_PLAN_REVIEW" }) });
    render(<PreviewPage />);

    await waitFor(() =>
      expect(nav.router.replace).toHaveBeenCalledWith("/projects/p1/slide-plans"),
    );
    // Guard short-circuits the presentation fetch entirely.
    expect(server.countOf("getPresentation")).toBe(0);
    expect(screen.queryByRole("button", { name: "物化幻灯片" })).toBeNull();
  });
});
