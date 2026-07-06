import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ExportPage from "@/app/projects/[id]/export/page";

import { defaultExportMetadata, installServer, project } from "./server";

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
  // jsdom implements neither of these; the download path (D6) needs both.
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("export page — EXPORT_READY renders the metadata list (no bytesBase64)", () => {
  it("shows id / format / human-readable byteSize and never leaks bytesBase64", async () => {
    installServer({
      project: project({ status: "EXPORT_READY" }),
      exports: [defaultExportMetadata()], // id export-1, byteSize 1024
    });
    render(<ExportPage />);

    await waitFor(() => expect(screen.getByText("export-1")).toBeTruthy());
    // Format + human-readable size live on one metadata line: 1024 -> "1.0 KB".
    expect(screen.getByText(/PPTX · 1\.0 KB/)).toBeTruthy();
    // The metadata list must never surface raw bytes.
    expect(document.body.textContent).not.toMatch(/bytesBase64/);
  });
});

describe("export page — empty list shows an empty state + export button", () => {
  it("renders the empty note and the 导出 PPTX button", async () => {
    installServer({ project: project({ status: "EXPORT_READY" }), exports: [] });
    render(<ExportPage />);

    await waitFor(() => expect(screen.getByText(/尚无导出产物/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "导出 PPTX" })).toBeTruthy();
  });
});

describe("export page — clicking export appends a new artifact", () => {
  it("calls exportPptx and the list grows by one", async () => {
    const server = installServer({
      project: project({ status: "EXPORT_READY" }),
      exports: [],
    });
    render(<ExportPage />);
    await waitFor(() => expect(screen.getByText(/尚无导出产物/)).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "导出 PPTX" }));

    await waitFor(() => expect(screen.getByText("export-1")).toBeTruthy());
    expect(server.countOf("exportPptx")).toBe(1);
  });
});

describe("export page — download goes through fetch -> Blob -> <a download>", () => {
  it("fetches the artifact, creates+revokes an ObjectURL, and clicks the anchor", async () => {
    let capturedDownload = "";
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        capturedDownload = this.download;
      });
    const server = installServer({
      project: project({ status: "EXPORT_READY" }),
      exports: [defaultExportMetadata()],
      exportBytes: "fake",
    });
    render(<ExportPage />);
    await waitFor(() => expect(screen.getByText("export-1")).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "下载" }));

    await waitFor(() => expect(server.countOf("downloadExport")).toBe(1));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // The download filename must carry the .pptx extension.
    expect(capturedDownload).toBe("export-1.pptx");
    // Cleanup (revoke) is deferred a tick so the browser commits the download first.
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock"));
  });
});

describe("export page — download of a missing artifact shows an in-page error", () => {
  it("does not crash or leave the page; shows the not-found banner", async () => {
    installServer({
      project: project({ status: "EXPORT_READY" }),
      exports: [defaultExportMetadata()],
      errors: { downloadExport: { status: 404, code: "EXPORT_ARTIFACT_NOT_FOUND" } },
    });
    render(<ExportPage />);
    await waitFor(() => expect(screen.getByText("export-1")).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "下载" }));

    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="not-found"]')).toBeTruthy(),
    );
    // Still on the page: the list is intact and no redirect happened.
    expect(screen.getByText("export-1")).toBeTruthy();
    expect(nav.router.replace).not.toHaveBeenCalled();
  });
});

describe("export page — mark as exported transitions to EXPORTED", () => {
  it("POSTs {to:EXPORTED} and renders the completed state", async () => {
    const server = installServer({
      project: project({ status: "EXPORT_READY" }),
      exports: [defaultExportMetadata()],
    });
    render(<ExportPage />);
    await waitFor(() => expect(screen.getByText("export-1")).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "标记为已导出" }));

    await waitFor(() => expect(screen.getByText("导出完成")).toBeTruthy());
    expect(server.bodyOf("transition")).toEqual({ to: "EXPORTED" });
    // Download list is preserved in the completed state.
    expect(screen.getByText("export-1")).toBeTruthy();
  });
});

describe("export page — EXPORTED shows the completed state (list kept, no export button)", () => {
  it("renders the completion banner and keeps the download list", async () => {
    installServer({
      project: project({ status: "EXPORTED" }),
      exports: [defaultExportMetadata()],
    });
    render(<ExportPage />);

    await waitFor(() => expect(screen.getByText("导出完成")).toBeTruthy());
    // The completion banner renders synchronously on load, but the download list
    // arrives a tick later via api.listExports — wait for it (mirrors the sibling
    // test above) instead of asserting it synchronously.
    await waitFor(() => expect(screen.getByText("export-1")).toBeTruthy());
    expect(screen.getByRole("button", { name: "下载" })).toBeTruthy();
    // Cannot re-export nor re-mark from the EXPORTED terminal state.
    expect(screen.queryByRole("button", { name: "导出 PPTX" })).toBeNull();
    expect(screen.queryByRole("button", { name: "标记为已导出" })).toBeNull();
  });
});

describe("export page — mount guard redirects a mis-placed state", () => {
  it("redirects SLIDE_GENERATION to the preview page and fetches no list", async () => {
    const server = installServer({ project: project({ status: "SLIDE_GENERATION" }) });
    render(<ExportPage />);

    await waitFor(() =>
      expect(nav.router.replace).toHaveBeenCalledWith("/projects/p1/preview"),
    );
    expect(server.countOf("listExports")).toBe(0);
    expect(screen.queryByRole("button", { name: "导出 PPTX" })).toBeNull();
  });
});

describe("export page — export failure shows the error + retry (EXPORT_NOT_READY)", () => {
  it("shows the rollback banner with a back-to-preview link and keeps the export button", async () => {
    installServer({
      project: project({ status: "EXPORT_READY" }),
      exports: [],
      errors: { exportPptx: { status: 409, code: "EXPORT_NOT_READY" } },
    });
    render(<ExportPage />);
    await waitFor(() => expect(screen.getByText(/尚无导出产物/)).toBeTruthy());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "导出 PPTX" }));

    await waitFor(() =>
      expect(document.querySelector('[data-error-kind="rollback"]')).toBeTruthy(),
    );
    // A way back to materialize, and the export button remains for a retry.
    expect(screen.getByRole("link", { name: "返回预览页" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "导出 PPTX" })).toBeTruthy();
  });
});
