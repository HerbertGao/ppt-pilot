"use client";

/**
 * Outline review page (Phase 4b §3, web-outline-review).
 *
 * Mount guard (D4): stays only in {OUTLINE_GENERATION, OUTLINE_REVIEW}; any other
 * state redirects to `currentStepPath` (guardOutlineMount). Mount NEVER drives a
 * forward transition (web-workflow-shell invariant). OUTLINE_GENERATION is the
 * stranded state — the review page's chain ran and landed here on ② failure; this
 * page shows loading / an error / an info card, each with a user-clicked "重试生成"
 * that re-runs the chain tail (② POST /outline/generate + ③ transition to
 * OUTLINE_REVIEW) only (never the ① transition — already here). OUTLINE_REVIEW
 * fetches the bare Outline (GET /outline), edits sections in local state (no
 * per-keystroke API), and saves the whole Outline (PUT /outline).
 *
 * The "generate slide plans" CTA visibility is DERIVED from `outline.confirmedByUser`
 * (D8), never a one-shot boolean: PUT /outline un-confirms (confirmedByUser=false),
 * so a post-confirm edit+save hides the CTA until re-confirmed — closing the
 * SLIDE_PLAN_NOT_CONFIRMABLE strand trap.
 */
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { Outline, OutlineSection } from "@ppt-pilot/shared-schema";

import { api } from "@/lib/api";
import { useProject } from "@/lib/use-project";
import {
  chainGenerateSlidePlans,
  guardOutlineMount,
  slidePlansPath,
} from "@/lib/workflow";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const OUTLINE_REVIEW = "OUTLINE_REVIEW" as const;

function emptySection(): OutlineSection {
  return { title: "", purpose: "", estimatedSlides: 1 };
}

export default function OutlinePage() {
  const projectId = String(useParams().id);
  const router = useRouter();
  const { project, loading, error, refresh } = useProject(projectId);

  const [outline, setOutline] = useState<Outline | null>(null);
  const [baseline, setBaseline] = useState<Outline | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const redirected = useRef(false);
  const fetched = useRef(false);
  const chainCtrl = useRef<AbortController | null>(null);

  // Abort any in-flight chain on unmount so it never router.push()es a gone page.
  useEffect(() => () => chainCtrl.current?.abort(), []);

  // Dirty = local edits diverge from the last server-synced snapshot. Small
  // objects, so a structural JSON compare is cheap and correct.
  const dirty =
    !!outline && !!baseline && JSON.stringify(outline) !== JSON.stringify(baseline);

  // Mount guard: redirect out when the state isn't served by this page.
  useEffect(() => {
    if (!project || redirected.current) return;
    const redirect = guardOutlineMount(projectId, project.status);
    if (redirect) {
      redirected.current = true;
      router.replace(redirect);
    }
  }, [project, projectId, router]);

  // OUTLINE_REVIEW: fetch the bare Outline once.
  useEffect(() => {
    if (!project || project.status !== "OUTLINE_REVIEW" || fetched.current) return;
    fetched.current = true;
    setBusy(false); // clear any leftover generation-busy on entering review
    const controller = new AbortController();
    loadOutline(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // Warn on tab close with unsaved edits.
  // ponytail: tab-close only — Next App Router has no stable in-app nav-block API,
  // so the inline "未保存更改" notice covers SPA route changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function loadOutline(signal?: AbortSignal) {
    setOutlineLoading(true);
    setOutlineError(null);
    api
      .getOutline(projectId, signal)
      .then((o) => {
        if (signal?.aborted) return;
        setOutline(o);
        setBaseline(o);
      })
      .catch((err: unknown) => {
        if (!signal?.aborted) setOutlineError(err);
      })
      .finally(() => {
        if (!signal?.aborted) setOutlineLoading(false);
      });
  }

  async function onRetryGenerate() {
    setBusy(true);
    setActionError(null);
    try {
      await api.generateOutline(projectId);
      await api.transition(projectId, OUTLINE_REVIEW);
      refresh(); // -> project reloads as OUTLINE_REVIEW -> the fetch effect loads it
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  function patchOutline(next: Outline) {
    setOutline(next);
    setSaved(false);
  }

  function updateSection(index: number, patch: Partial<OutlineSection>) {
    if (!outline) return;
    patchOutline({
      ...outline,
      sections: outline.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  }

  function addSection() {
    if (!outline) return;
    patchOutline({ ...outline, sections: [...outline.sections, emptySection()] });
  }

  function removeSection(index: number) {
    if (!outline) return;
    patchOutline({ ...outline, sections: outline.sections.filter((_, i) => i !== index) });
  }

  function moveSection(index: number, delta: number) {
    if (!outline) return;
    const target = index + delta;
    if (target < 0 || target >= outline.sections.length) return;
    const sections = [...outline.sections];
    const [moved] = sections.splice(index, 1);
    sections.splice(target, 0, moved!);
    patchOutline({ ...outline, sections });
  }

  async function onSave() {
    if (!outline) return;
    setBusy(true);
    setActionError(null);
    setSaved(false);
    try {
      const res = await api.updateOutline(projectId, outline);
      // Backend un-confirms on save (confirmedByUser=false): adopt the response so
      // the CTA (derived from confirmedByUser) collapses until re-confirmed.
      setOutline(res);
      setBaseline(res);
      setSaved(true);
      refresh();
    } catch (err) {
      setActionError(err); // keep local edits; do not clear inputs
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    setBusy(true);
    setActionError(null);
    setSaved(false);
    try {
      const res = await api.confirmOutline(projectId); // bare Outline, confirmedByUser=true
      setOutline(res);
      setBaseline(res);
    } catch (err) {
      setActionError(err); // stays unconfirmed
    } finally {
      setBusy(false);
    }
  }

  async function onGeneratePlans() {
    setBusy(true);
    setActionError(null);
    chainCtrl.current?.abort();
    const controller = new AbortController();
    chainCtrl.current = controller;
    // Chained: transition -> generate -> transition (never throws; returns ok flag).
    const res = await chainGenerateSlidePlans(projectId, controller.signal);
    // Left the page mid-chain: don't navigate from an unmounted component.
    if (controller.signal.aborted) return;
    // Navigate only on success (mirrors the review page's onGenerateOutline, D3).
    // On ① failure the state stays OUTLINE_REVIEW so this page stays and shows the
    // error; on ② failure it advanced to SLIDE_PLANNING, so refresh() lets the
    // mount guard redirect to /slide-plans (which owns its generation error + retry).
    if (res.ok) {
      router.push(slidePlansPath(projectId));
      return;
    }
    setActionError(res.error);
    setBusy(false);
    refresh();
  }

  if (loading) return <Loading label="加载项目…" className="p-6" />;
  if (error) {
    return (
      <div className="p-6">
        <ErrorNotice error={error} onRetry={refresh} />
      </div>
    );
  }
  if (!project) return null;

  // Mount guard is redirecting: render nothing meaningful.
  if (guardOutlineMount(projectId, project.status)) {
    return <Loading label="正在跳转…" className="p-6" />;
  }

  const canGeneratePlans = !!outline?.confirmedByUser && !dirty;

  return (
    <WorkflowShell
      state={project.status}
      scene={project.scene}
      styleProfileId={project.styleProfileId}
      title="大纲复核"
    >
      <div className="flex flex-col gap-6">
        {project.status === "OUTLINE_GENERATION" ? (
          busy ? (
            <Loading label="生成大纲中…" />
          ) : actionError ? (
            <ErrorNotice error={actionError}>
              <Button type="button" size="sm" onClick={onRetryGenerate} disabled={busy}>
                重试生成
              </Button>
            </ErrorNotice>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>大纲生成未完成</CardTitle>
                <CardDescription>大纲生成未完成或已中断，请点击重试。</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button type="button" onClick={onRetryGenerate} disabled={busy}>
                  重试生成
                </Button>
              </CardFooter>
            </Card>
          )
        ) : (
          <>
            {outlineLoading ? <Loading label="加载大纲…" /> : null}
            {outlineError ? <ErrorNotice error={outlineError} onRetry={() => loadOutline()} /> : null}

            {outline ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>大纲</CardTitle>
                    <CardDescription>
                      就地编辑各章节的标题 / 目的 / 预计页数，可增删与调整顺序。改动仅保存在本地，点「保存」后整体提交。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    {outline.sections.map((section, index) => (
                      <SectionCard
                        key={index}
                        index={index}
                        total={outline.sections.length}
                        section={section}
                        disabled={busy}
                        onChange={(patch) => updateSection(index, patch)}
                        onRemove={() => removeSection(index)}
                        onMove={(delta) => moveSection(index, delta)}
                      />
                    ))}
                    {outline.sections.length === 0 ? (
                      <p className="text-sm text-muted-foreground">暂无章节，请添加。</p>
                    ) : null}
                  </CardContent>
                  <CardFooter className="mt-4 flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={addSection} disabled={busy}>
                      添加章节
                    </Button>
                    <Button type="button" onClick={onSave} disabled={busy}>
                      {busy ? "保存中…" : "保存"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={onConfirm}
                      disabled={busy || dirty}
                    >
                      确认大纲
                    </Button>
                  </CardFooter>
                </Card>

                {dirty ? (
                  <p className="text-sm text-amber-600" role="status">
                    有未保存更改。离开页面前请先保存，否则改动将丢失。
                  </p>
                ) : saved ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    已保存。
                  </p>
                ) : null}

                {outline.riskNotes && outline.riskNotes.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">风险提示</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="list-disc pl-5 text-sm text-muted-foreground">
                        {outline.riskNotes.map((note, i) => (
                          <li key={i}>{note}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ) : null}

                {canGeneratePlans ? (
                  <Card data-confirmed="true">
                    <CardHeader>
                      <CardTitle>大纲已确认</CardTitle>
                      <CardDescription>
                        可进入下一步生成幻灯片规划。再次编辑并保存会取消确认，需重新确认。
                      </CardDescription>
                    </CardHeader>
                    <CardFooter>
                      <Button type="button" onClick={onGeneratePlans} disabled={busy}>
                        {busy ? "生成中…" : "生成幻灯片规划"}
                      </Button>
                    </CardFooter>
                  </Card>
                ) : null}

                {actionError ? <ErrorNotice error={actionError} /> : null}
              </>
            ) : (
              actionError ? <ErrorNotice error={actionError} /> : null
            )}
          </>
        )}
      </div>
    </WorkflowShell>
  );
}

function SectionCard({
  index,
  total,
  section,
  disabled,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  total: number;
  section: OutlineSection;
  disabled: boolean;
  onChange: (patch: Partial<OutlineSection>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  return (
    <Card data-section-index={index}>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`section-${index}-title`}>标题</Label>
          <Input
            id={`section-${index}-title`}
            value={section.title}
            onChange={(e) => onChange({ title: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`section-${index}-purpose`}>目的</Label>
          <Textarea
            id={`section-${index}-purpose`}
            value={section.purpose}
            onChange={(e) => onChange({ purpose: e.target.value })}
            rows={2}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`section-${index}-slides`}>预计页数</Label>
          <Input
            id={`section-${index}-slides`}
            type="number"
            min={1}
            value={section.estimatedSlides}
            onChange={(e) => onChange({ estimatedSlides: Number(e.target.value) })}
            disabled={disabled}
            className="w-24"
          />
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onMove(-1)}
          disabled={disabled || index === 0}
        >
          上移
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onMove(1)}
          disabled={disabled || index === total - 1}
        >
          下移
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRemove}
          disabled={disabled}
        >
          删除
        </Button>
      </CardFooter>
    </Card>
  );
}
