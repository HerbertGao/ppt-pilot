"use client";

/**
 * Deck preview page (Phase 4b §5, web-deck-preview).
 *
 * Mount guard redirects out when state is not in {SLIDE_GENERATION,
 * EXPORT_READY, EXPORTED} (guardPreviewMount). "Not materialized" is detected by
 * catching `ApiError.code === "PRESENTATION_NOT_FOUND"` from GET /presentation
 * (the backend 404s rather than returning null / a {presentation} wrapper) — that
 * is an in-place empty state with a "materialize" button, NOT an error banner.
 *
 * Both `materialize` and `getPresentation` return a BARE `Presentation`; it is
 * rendered by `@ppt-pilot/ppt-engine` (renderPresentation / renderSlide /
 * renderThumbnail) and injected via `dangerouslySetInnerHTML`. Safety is the
 * renderer's contract (context-aware escaping + CSS allowlist, Phase 6) — the
 * page never hand-assembles HTML.
 */
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { renderPresentation, renderSlide, renderThumbnail, slideBaseCss } from "@ppt-pilot/ppt-engine";
import type { Presentation, ThemeTokens } from "@ppt-pilot/shared-schema";

import { ApiError, api } from "@/lib/api";
import { useProject } from "@/lib/use-project";
import { enterExport, exportPath, guardPreviewMount, slidePlansPath } from "@/lib/workflow";
import { ErrorNotice, Loading } from "@/components/feedback";
import { WorkflowShell } from "@/components/workflow-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function PreviewPage() {
  const projectId = String(useParams().id);
  const router = useRouter();
  const { project, loading, error, refresh } = useProject(projectId);

  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [notMaterialized, setNotMaterialized] = useState(false);
  const [loadingPresentation, setLoadingPresentation] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const redirected = useRef(false);

  // Mount guard: never transition; redirect out when state is off-page.
  useEffect(() => {
    if (!project || redirected.current) return;
    const redirect = guardPreviewMount(projectId, project.status);
    if (redirect) {
      redirected.current = true;
      router.replace(redirect);
    }
  }, [project, projectId, router]);

  // Load the presentation once the project is loaded and the guard accepts it.
  // A 404 PRESENTATION_NOT_FOUND is the "not materialized" empty state, not an
  // error. Any other failure is a real load error.
  useEffect(() => {
    if (!project || guardPreviewMount(projectId, project.status)) return;
    const controller = new AbortController();
    setLoadingPresentation(true);
    setLoadError(null);
    setNotMaterialized(false);
    api
      .getPresentation(projectId, controller.signal)
      .then((pres) => {
        setPresentation(pres);
        setSelected(0);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.code === "PRESENTATION_NOT_FOUND") {
          setNotMaterialized(true);
        } else {
          setLoadError(err);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingPresentation(false);
      });
    return () => controller.abort();
  }, [project, projectId]);

  async function onMaterialize() {
    setBusy(true);
    setActionError(null);
    try {
      // materialize returns the BARE Presentation — render it directly, no re-GET.
      const pres = await api.materialize(projectId);
      setPresentation(pres);
      setNotMaterialized(false);
      setSelected(0);
    } catch (err) {
      setActionError(err); // SLIDES_NOT_MATERIALIZABLE / SLIDE_VALIDATION_ERROR
    } finally {
      setBusy(false);
    }
  }

  async function onEnterExport() {
    if (!project) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await enterExport(projectId, project.status);
      if (res.navigate) router.push(exportPath(projectId));
    } catch (err) {
      setActionError(err); // INVALID_STATE_TRANSITION etc. — stay on page
      setBusy(false);
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

  // Off-page state: the mount guard is redirecting; render nothing meaningful.
  if (guardPreviewMount(projectId, project.status)) {
    return <Loading label="正在跳转…" className="p-6" />;
  }

  const isSlideGeneration = project.status === "SLIDE_GENERATION";

  return (
    <WorkflowShell
      state={project.status}
      scene={project.scene}
      styleProfileId={project.styleProfileId}
      title="幻灯片预览"
    >
      <div className="flex flex-col gap-6">
        {loadingPresentation && !presentation && !notMaterialized ? (
          <Loading label="加载预览…" />
        ) : loadError ? (
          <ErrorNotice error={loadError} onRetry={refresh} />
        ) : notMaterialized ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>尚未物化</CardTitle>
                <CardDescription>
                  幻灯片规划已确认，尚未物化为可预览的演示文稿。点击下方按钮物化后即可预览。
                </CardDescription>
              </CardHeader>
              {isSlideGeneration ? (
                <CardFooter className="mt-4">
                  <Button type="button" onClick={onMaterialize} disabled={busy}>
                    {busy ? "物化中…" : "物化幻灯片"}
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
            {actionError ? (
              <ErrorNotice error={actionError} onRetry={onMaterialize}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => router.push(slidePlansPath(projectId))}
                >
                  返回规划页
                </Button>
              </ErrorNotice>
            ) : null}
          </>
        ) : presentation ? (
          <PreviewBody
            presentation={presentation}
            selected={selected}
            onSelect={setSelected}
          >
            <div className="flex flex-col gap-4">
              {actionError ? <ErrorNotice error={actionError} /> : null}
              {isSlideGeneration ? (
                <Button type="button" onClick={onEnterExport} disabled={busy}>
                  {busy ? "处理中…" : "进入导出"}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push(exportPath(projectId))}
                >
                  前往导出页
                </Button>
              )}
            </div>
          </PreviewBody>
        ) : (
          <Loading label="加载预览…" />
        )}
      </div>
    </WorkflowShell>
  );
}

function PreviewBody({
  presentation,
  selected,
  onSelect,
  children,
}: {
  presentation: Presentation;
  selected: number;
  onSelect: (index: number) => void;
  children: React.ReactNode;
}) {
  const slides = presentation.slides;
  // ponytail: theme rides the wire as a JsonObject; renderSlide wants ThemeTokens
  // — pass it straight through, the renderer sanitizes tokens itself (Phase 6 D5).
  const theme = presentation.theme as unknown as ThemeTokens;
  const active = slides.length > 0 ? Math.min(selected, slides.length - 1) : 0;
  // Main preview = the selected slide; fall back to the whole deck when there are
  // no slides. All HTML is renderer output, never hand-assembled.
  const deckHtml =
    slides.length > 0 ? renderSlide(slides[active]!, theme) : renderPresentation(presentation);

  // The renderer's slide is a fixed 1280×720 canvas (the design/PPTX coordinate
  // space); scale it down to the container width so it doesn't overflow the page.
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const host = frameRef.current;
    if (!host) return;
    const update = () => {
      const w = host.clientWidth;
      if (w > 0) setScale(w / 1280);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      {/* Base CSS for the renderer's absolute-positioned HTML — static, from our
          own package. Injected once; establishes the 1280×720 containing block. */}
      <style dangerouslySetInnerHTML={{ __html: slideBaseCss() }} />
      {slides.length > 0 ? (
        <ul className="flex flex-wrap gap-3" data-testid="thumbnails">
          {slides.map((slide, i) => (
            <li key={slide.id}>
              <button
                type="button"
                data-slide-thumb
                data-testid={`slide-thumb-${i}`}
                aria-current={i === active}
                onClick={() => onSelect(i)}
                className="overflow-hidden rounded border aria-[current=true]:ring-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={renderThumbnail(slide)}
                  alt={`幻灯片 ${i + 1}：${slide.title}`}
                  width={160}
                  height={90}
                  className="block h-auto w-40"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        ref={frameRef}
        data-testid="deck-preview"
        className="overflow-hidden rounded border bg-background"
        style={{ height: scale > 0 ? Math.round(720 * scale) : undefined }}
      >
        {/* 1280×720 canvas scaled from the top-left to fit the frame width. The
            frame's height above tracks the scaled height so the button below is
            never overlapped by the scaled slide. */}
        <div
          style={{
            width: 1280,
            height: 720,
            transformOrigin: "top left",
            transform: `scale(${scale})`,
          }}
          dangerouslySetInnerHTML={{ __html: deckHtml }}
        />
      </div>

      {children}
    </>
  );
}
