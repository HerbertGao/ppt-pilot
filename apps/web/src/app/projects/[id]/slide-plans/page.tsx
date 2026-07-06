"use client";

/**
 * Slide-plan review page (Phase 4b §4, web-slide-plan-review).
 *
 * Mount guard accepts only {SLIDE_PLANNING, SLIDE_PLAN_REVIEW}; any other state
 * redirects to `currentStepPath(state)` (guardSlidePlansMount). Two live states
 * share this page:
 *
 *  - SLIDE_PLANNING: recovery/loading for the chained generate. The chain
 *    (transition -> generate -> transition) runs on the outline page; a partial
 *    failure (② generate failed) leaves the project here. Mount NEVER drives a
 *    transition (web-workflow-shell invariant); it shows loading / an error / an
 *    info card, each with a user-clicked "重试生成" that finishes the remaining
 *    steps (generate + transition to SLIDE_PLAN_REVIEW) only — never the first
 *    transition, we are already in the generation state.
 *  - SLIDE_PLAN_REVIEW: GET /slides/plans, render one editable card per plan.
 *    Single-page save (PUT /slides/{slideId}/plan) sends the full SlidePlan; the
 *    backend flips slidePlansConfirmed back to false on any edit, so the
 *    "materialize" CTA visibility is DERIVED from the latest payload's
 *    slidePlansConfirmed (never a one-shot boolean) — editing after confirming
 *    hides the CTA until re-confirmed. Confirm (POST /slides/plans/confirm) sets
 *    it true; the CTA transitions to SLIDE_GENERATION and navigates to /preview
 *    (materialization itself happens on the preview page).
 *
 * visualIntent is edited through a native <select> constrained to the 6
 * VisualIntent enum values (never free text).
 */
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { VISUAL_INTENTS, type SlidePlan, type VisualIntent } from "@ppt-pilot/shared-schema";

import { api, type SlidePlansPayload } from "@/lib/api";
import { useProject } from "@/lib/use-project";
import { enterPreview, guardSlidePlansMount, previewPath } from "@/lib/workflow";
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

const SLIDE_PLANNING = "SLIDE_PLANNING";
const SLIDE_PLAN_REVIEW = "SLIDE_PLAN_REVIEW";

const VISUAL_INTENT_LABELS: Record<VisualIntent, string> = {
  diagram: "图示",
  image: "图片",
  chart: "图表",
  text: "文本",
  comparison: "对比",
  timeline: "时间线",
};

export default function SlidePlansPage() {
  const projectId = String(useParams().id);
  const router = useRouter();
  const { project, loading, error, refresh } = useProject(projectId);

  const [payload, setPayload] = useState<SlidePlansPayload | null>(null);
  const [plansError, setPlansError] = useState<unknown>(null);
  const [plansNonce, setPlansNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());

  const redirected = useRef(false);

  // Mount guard: redirect out when state is not a slide-plan page state.
  useEffect(() => {
    if (!project || redirected.current) return;
    const redirect = guardSlidePlansMount(projectId, project.status);
    if (redirect) {
      redirected.current = true;
      router.replace(redirect);
    }
  }, [project, projectId, router]);

  const confirmed = payload?.slidePlansConfirmed ?? false;

  // A card with unsaved edits must not confirm/materialize the persisted (stale)
  // payload. Each PlanCard reports its dirty state; block the CTA while any is dirty.
  const hasUnsaved = dirtyIds.size > 0;
  const reportDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((prev) => {
      if (dirty === prev.has(id)) return prev;
      const next = new Set(prev);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Finish the chained generation (② generate + ③ transition). Driven by the
  // user-clicked "重试生成" button (never on mount); never re-issues the first
  // transition — the project is already in SLIDE_PLANNING.
  const finishGeneration = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.generateSlidePlans(projectId);
      await api.transition(projectId, SLIDE_PLAN_REVIEW);
      refresh();
    } catch (err) {
      setActionError(err); // LLM_PROVIDER_ERROR / INVALID_STATE_TRANSITION -> stay
    } finally {
      setBusy(false);
    }
  }, [projectId, refresh]);

  // Load the plans once in review state (and on explicit reload via plansNonce).
  useEffect(() => {
    if (project?.status !== SLIDE_PLAN_REVIEW) return;
    const controller = new AbortController();
    setPlansError(null);
    api
      .getSlidePlans(projectId, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setPayload(res);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setPlansError(err);
      });
    return () => controller.abort();
  }, [project?.status, projectId, plansNonce]);

  async function onConfirm() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.confirmSlidePlans(projectId);
      setPayload(res); // slidePlansConfirmed=true -> materialize CTA appears
    } catch (err) {
      setActionError(err); // INVALID_STATE_TRANSITION / SLIDE_PLAN_NOT_FOUND
    } finally {
      setBusy(false);
    }
  }

  async function onMaterialize() {
    if (!project) return;
    setBusy(true);
    setActionError(null);
    try {
      // enterPreview transitions SLIDE_PLAN_REVIEW -> SLIDE_GENERATION; the
      // preview page triggers materialize (not this page).
      const res = await enterPreview(projectId, project.status);
      if (res.navigate) {
        router.push(previewPath(projectId));
      }
    } catch (err) {
      setActionError(err);
      setBusy(false); // keep the page on navigation failure
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

  const status = project.status;
  // Not a slide-plan state: the mount guard is redirecting.
  if (status !== SLIDE_PLANNING && status !== SLIDE_PLAN_REVIEW) {
    return <Loading label="正在跳转…" className="p-6" />;
  }

  return (
    <WorkflowShell
      state={status}
      scene={project.scene}
      styleProfileId={project.styleProfileId}
      title="规划复核"
    >
      {status === SLIDE_PLANNING ? (
        <div className="flex flex-col gap-4">
          {busy ? (
            <Loading label="正在生成幻灯片规划…" />
          ) : actionError ? (
            <ErrorNotice error={actionError}>
              <Button type="button" size="sm" variant="outline" onClick={finishGeneration} disabled={busy}>
                重试生成
              </Button>
            </ErrorNotice>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>幻灯片规划生成未完成</CardTitle>
                <CardDescription>幻灯片规划生成未完成或已中断，请点击重试。</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button type="button" onClick={finishGeneration} disabled={busy}>
                  重试生成
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>幻灯片规划</CardTitle>
              <CardDescription>
                逐页复核并编辑规划，任一页保存后需重新「确认规划」才能物化。
              </CardDescription>
            </CardHeader>
          </Card>

          {plansError ? (
            <ErrorNotice error={plansError} onRetry={() => setPlansNonce((n) => n + 1)} />
          ) : !payload ? (
            <Loading label="加载规划…" />
          ) : (
            <>
              {payload.slidePlans.map((plan, i) => (
                <PlanCard
                  key={plan.slideId ?? i}
                  projectId={projectId}
                  index={i}
                  plan={plan}
                  onSaved={setPayload}
                  onDirtyChange={reportDirty}
                />
              ))}

              {actionError ? <ErrorNotice error={actionError} /> : null}

              <Card>
                <CardFooter className="flex flex-wrap items-center gap-3 pt-6">
                  {hasUnsaved ? (
                    <span className="w-full text-sm text-amber-600" data-unsaved-hint="true">
                      有未保存的规划改动，请先保存对应卡片再确认或物化。
                    </span>
                  ) : null}
                  {confirmed ? (
                    <>
                      <span className="text-sm text-muted-foreground" data-plans-confirmed="true">
                        规划已确认。
                      </span>
                      <Button type="button" onClick={onMaterialize} disabled={busy || hasUnsaved}>
                        {busy ? "进入中…" : "物化幻灯片"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      onClick={onConfirm}
                      disabled={busy || payload.slidePlans.length === 0 || hasUnsaved}
                    >
                      {busy ? "确认中…" : "确认规划"}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            </>
          )}
        </div>
      )}
    </WorkflowShell>
  );
}

function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function PlanCard({
  projectId,
  index,
  plan,
  onSaved,
  onDirtyChange,
}: {
  projectId: string;
  index: number;
  plan: SlidePlan;
  onSaved: (payload: SlidePlansPayload) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<SlidePlan>(plan);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const uid = `plan-${plan.slideId ?? index}`;

  // Report unsaved-edit state up so the confirm/materialize CTA can block on it.
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan);
  useEffect(() => {
    const id = plan.slideId;
    if (!id) return;
    onDirtyChange(id, dirty);
    return () => onDirtyChange(id, false);
  }, [dirty, plan.slideId, onDirtyChange]);

  function patch(next: Partial<SlidePlan>) {
    setDraft((d) => ({ ...d, ...next }));
    setSaved(false);
  }

  async function onSave() {
    if (!plan.slideId) return;
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await api.updateSlidePlan(projectId, plan.slideId, draft);
      setSaved(true);
      onSaved(res); // slidePlansConfirmed=false -> hides the materialize CTA
    } catch (e) {
      setErr(e); // SLIDE_PLAN_VALIDATION_ERROR / SLIDE_PLAN_NOT_FOUND -> keep edits
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-slide-id={plan.slideId}>
      <CardHeader>
        <CardTitle className="text-base">
          {draft.title || `第 ${index + 1} 页`}
        </CardTitle>
        <CardDescription>slideId: {plan.slideId ?? "—"}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field id={`${uid}-title`} label="标题">
          <Input
            id={`${uid}-title`}
            value={draft.title ?? ""}
            onChange={(e) => patch({ title: e.target.value })}
            disabled={busy}
          />
        </Field>
        <Field id={`${uid}-objective`} label="目标">
          <Textarea
            id={`${uid}-objective`}
            value={draft.objective}
            onChange={(e) => patch({ objective: e.target.value })}
            disabled={busy}
          />
        </Field>
        <Field id={`${uid}-keyMessage`} label="核心信息">
          <Textarea
            id={`${uid}-keyMessage`}
            value={draft.keyMessage}
            onChange={(e) => patch({ keyMessage: e.target.value })}
            disabled={busy}
          />
        </Field>
        <Field id={`${uid}-contentIntent`} label="内容意图">
          <Input
            id={`${uid}-contentIntent`}
            value={draft.contentIntent}
            onChange={(e) => patch({ contentIntent: e.target.value })}
            disabled={busy}
          />
        </Field>
        <Field id={`${uid}-visualIntent`} label="可视化意图">
          {/* Native <select> constrains visualIntent to the enum (no free text). */}
          <select
            id={`${uid}-visualIntent`}
            value={draft.visualIntent}
            onChange={(e) => patch({ visualIntent: e.target.value as VisualIntent })}
            disabled={busy}
            className="border-input h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {VISUAL_INTENTS.map((v) => (
              <option key={v} value={v}>
                {VISUAL_INTENT_LABELS[v]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${uid}-layoutSuggestion`} label="布局建议">
          <Input
            id={`${uid}-layoutSuggestion`}
            value={draft.layoutSuggestion}
            onChange={(e) => patch({ layoutSuggestion: e.target.value })}
            disabled={busy}
          />
        </Field>
        <Field id={`${uid}-requiredAssets`} label="所需素材（每行一项）">
          <Textarea
            id={`${uid}-requiredAssets`}
            value={draft.requiredAssets.join("\n")}
            onChange={(e) => patch({ requiredAssets: linesToArray(e.target.value) })}
            disabled={busy}
          />
        </Field>
        <Field id={`${uid}-riskNotes`} label="风险提示（每行一项）">
          <Textarea
            id={`${uid}-riskNotes`}
            value={draft.riskNotes.join("\n")}
            onChange={(e) => patch({ riskNotes: linesToArray(e.target.value) })}
            disabled={busy}
          />
        </Field>

        {err ? <ErrorNotice error={err} /> : null}
      </CardContent>
      <CardFooter className="flex items-center gap-3">
        <Button type="button" onClick={onSave} disabled={busy || !plan.slideId}>
          {busy ? "保存中…" : "保存"}
        </Button>
        {saved ? (
          <span className="text-sm text-muted-foreground" data-saved="true">
            已保存
          </span>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
