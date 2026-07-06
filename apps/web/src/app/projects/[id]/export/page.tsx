"use client";

/**
 * Export page (Phase 4b §6, web-pptx-export).
 *
 * Mount never drives a transition (D2): if state is not in {EXPORT_READY,
 * EXPORTED} the guard redirects to `currentStepPath(state)`. The metadata list
 * comes from `GET /exports` (no `bytesBase64`); download goes through
 * `fetch` -> `Blob` -> `<a download>` -> `revokeObjectURL` (D6), never
 * `window.location`, so a failed download surfaces in-page instead of leaving
 * the SPA. Errors are presented through the central `presentError` map (D7).
 */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError, type ExportArtifactMetadata } from "@/lib/api";
import { useProject } from "@/lib/use-project";
import { guardExportMount, previewPath } from "@/lib/workflow";
import { ErrorNotice, Loading } from "@/components/feedback";
import { WorkflowShell } from "@/components/workflow-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Human-readable byte size (e.g. 1024 -> "1.0 KB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export default function ExportPage() {
  const projectId = String(useParams().id);
  const router = useRouter();
  const { project, loading, error, refresh } = useProject(projectId);

  const [exports, setExports] = useState<ExportArtifactMetadata[] | null>(null);
  const [listError, setListError] = useState<unknown>(null);
  const [listNonce, setListNonce] = useState(0);
  const reloadList = useCallback(() => setListNonce((n) => n + 1), []);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const [failedDownloadId, setFailedDownloadId] = useState<string | null>(null);

  const redirected = useRef(false);

  // Mount guard: never transition; redirect out when the state isn't an export state.
  useEffect(() => {
    if (!project || redirected.current) return;
    const redirect = guardExportMount(projectId, project.status);
    if (redirect) {
      redirected.current = true;
      router.replace(redirect);
    }
  }, [project, projectId, router]);

  // Load the metadata list once the project is known to be in an accepted state.
  // Re-fetches only when the state first becomes acceptable or `reloadList` fires
  // (after an export) — a plain `refresh()` (mark-exported) keeps the local list.
  const accepted =
    project !== null && guardExportMount(projectId, project.status) === null;
  useEffect(() => {
    if (!accepted) return;
    const controller = new AbortController();
    setListError(null);
    api
      .listExports(projectId, controller.signal)
      .then((res) => setExports(res.exports))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setListError(err);
      });
    return () => controller.abort();
  }, [projectId, accepted, listNonce]);

  async function onExport() {
    setExporting(true);
    setExportError(null);
    try {
      await api.exportPptx(projectId);
      reloadList(); // re-fetch appends the new artifact (backend id increments)
      refresh();
    } catch (err) {
      setExportError(err); // EXPORT_NOT_READY / EXPORT_VALIDATION_ERROR -> stay put
    } finally {
      setExporting(false);
    }
  }

  async function onDownload(artifactId: string) {
    setDownloadError(null);
    setFailedDownloadId(null);
    setDownloading((d) => ({ ...d, [artifactId]: true }));
    try {
      const res = await api.downloadExport(projectId, artifactId);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${artifactId}.pptx`;
      document.body.appendChild(a);
      a.click();
      // Defer cleanup: revoking the object URL synchronously after click() can make
      // some browsers drop the `download` filename and fall back to the blob UUID
      // (a name with NO .pptx extension). Give the download a tick to commit first.
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 0);
    } catch (err) {
      setDownloadError(err); // EXPORT_ARTIFACT_NOT_FOUND / NETWORK_ERROR -> in-page
      setFailedDownloadId(artifactId); // remember which download to retry
    } finally {
      setDownloading((d) => ({ ...d, [artifactId]: false }));
    }
  }

  async function onMarkExported() {
    setMarking(true);
    setMarkError(null);
    try {
      await api.transition(projectId, "EXPORTED");
      refresh();
    } catch (err) {
      setMarkError(err);
    } finally {
      setMarking(false);
    }
  }

  if (loading) {
    return <Loading label="加载项目…" className="p-6" />;
  }
  if (error) {
    return (
      <div className="p-6">
        <ErrorNotice error={error} onRetry={refresh} />
      </div>
    );
  }
  if (!project) return null;

  // Not an export state: the mount guard is redirecting; render nothing meaningful.
  if (!accepted) {
    return <Loading label="正在跳转…" className="p-6" />;
  }

  const isExported = project.status === "EXPORTED";
  const hasArtifacts = (exports?.length ?? 0) > 0;
  const exportNotReady =
    exportError instanceof ApiError && exportError.code === "EXPORT_NOT_READY";

  return (
    <WorkflowShell
      state={project.status}
      scene={project.scene}
      styleProfileId={project.styleProfileId}
      title="导出"
    >
      <div className="flex flex-col gap-6">
        {isExported ? (
          <Card data-exported="true">
            <CardHeader>
              <CardTitle>导出完成</CardTitle>
              <CardDescription>
                演示文稿已标记为「已导出」。已生成的产物仍可在下方下载。
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              如需继续导出，可回退到「待导出」状态；后端回退为非破坏操作，已生成的产物会保留。
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>导出 PPTX</CardTitle>
              <CardDescription>
                从已物化的演示文稿生成可下载的 PPTX。可重复导出，每次生成一个新产物。
              </CardDescription>
            </CardHeader>
            <CardFooter className="mt-4 flex-col items-start gap-3">
              <Button type="button" onClick={onExport} disabled={exporting}>
                {exporting ? "导出中…" : "导出 PPTX"}
              </Button>
              {exportError ? (
                <ErrorNotice error={exportError} onRetry={onExport} className="w-full">
                  {exportNotReady ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={previewPath(projectId)}>返回预览页</Link>
                    </Button>
                  ) : null}
                </ErrorNotice>
              ) : null}
            </CardFooter>
          </Card>
        )}

        {listError ? (
          <ErrorNotice error={listError} onRetry={reloadList} />
        ) : exports === null ? (
          <Loading label="加载导出列表…" />
        ) : exports.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              尚无导出产物，点击「导出 PPTX」生成第一个。
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>导出产物</CardTitle>
              <CardDescription>共 {exports.length} 个产物。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {downloadError ? (
                <ErrorNotice
                  error={downloadError}
                  onRetry={() => {
                    if (failedDownloadId) void onDownload(failedDownloadId);
                  }}
                />
              ) : null}
              {exports.map((meta) => (
                <div
                  key={meta.id}
                  data-artifact-id={meta.id}
                  className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">{meta.id}</span>
                    <span className="text-muted-foreground">
                      {meta.format.toUpperCase()} · {formatBytes(meta.byteSize)} ·{" "}
                      {meta.createdAt}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onDownload(meta.id)}
                    disabled={downloading[meta.id]}
                  >
                    {downloading[meta.id] ? "下载中…" : "下载"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {!isExported && hasArtifacts ? (
          <Card>
            <CardHeader>
              <CardTitle>完成导出</CardTitle>
              <CardDescription>
                导出满意后，标记为「已导出」以完成工作流。
              </CardDescription>
            </CardHeader>
            <CardFooter className="mt-4 flex-col items-start gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={onMarkExported}
                disabled={marking}
              >
                {marking ? "标记中…" : "标记为已导出"}
              </Button>
              {markError ? <ErrorNotice error={markError} className="w-full" /> : null}
            </CardFooter>
          </Card>
        ) : null}
      </div>
    </WorkflowShell>
  );
}
