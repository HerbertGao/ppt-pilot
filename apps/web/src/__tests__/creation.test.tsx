import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CreateProjectPage from "@/app/page";

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

describe("project creation page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a project then routes into discovery with the returned id", async () => {
    installServer({ project: project(), createProjectId: "proj-42" });
    const user = userEvent.setup();
    render(<CreateProjectPage />);

    await user.type(screen.getByLabelText("初始请求"), "给高管做一个季度回顾");
    await user.click(screen.getByRole("button", { name: "创建并开始澄清" }));

    await waitFor(() =>
      expect(nav.router.push).toHaveBeenCalledWith("/projects/proj-42/discovery"),
    );
  });

  it("locates INVALID_SCENE to the scene field and preserves input", async () => {
    installServer({
      project: project(),
      errors: { createProject: { status: 400, code: "INVALID_SCENE", field: "scene" } },
    });
    const user = userEvent.setup();
    render(<CreateProjectPage />);

    await user.type(screen.getByLabelText("初始请求"), "保留这段文字");
    await user.click(screen.getByRole("button", { name: "创建并开始澄清" }));

    // Field-scoped message appears; the router never navigates on error.
    await waitFor(() => expect(screen.getByText("所选场景无效，请重新选择。")).toBeTruthy());
    expect(nav.router.push).not.toHaveBeenCalled();
    // Input is not cleared.
    expect((screen.getByLabelText("初始请求") as HTMLTextAreaElement).value).toBe("保留这段文字");
  });

  it("shows a non-field error as a banner without crashing (502)", async () => {
    installServer({
      project: project(),
      errors: { createProject: { status: 502, code: "LLM_PROVIDER_ERROR" } },
    });
    const user = userEvent.setup();
    render(<CreateProjectPage />);

    await user.click(screen.getByRole("button", { name: "创建并开始澄清" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(nav.router.push).not.toHaveBeenCalled();
  });
});
