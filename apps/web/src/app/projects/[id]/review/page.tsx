"use client";

/**
 * Spec review page (Phase 4 §5, web-spec-review).
 *
 * Mount NEVER drives a transition (§2.3a): if state != REVIEW, redirect back to
 * discovery (guardReviewMount). Pre-confirm summary shows only obtainable fields
 * — scene/styleProfileId (GET project) plus mode/threshold/answered-skipped
 * counts from the client-local session; on hard refresh (no session) it degrades
 * to scene/style only and NEVER re-`discover`s. Confirm renders the full spec
 * (questionPolicy/riskNotes) from the confirm RESPONSE. Profile edits are
 * rollback-first (REVIEW->DISCOVERY, then PATCH in DISCOVERY, then re-discover).
 */
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api, type ConfirmResponse, type ProfileInput } from "@/lib/api";
import { clearDiscoverySession, getDiscoverySession } from "@/lib/discovery-session";
import { useProject } from "@/lib/use-project";
import {
  changeProfileRollbackFirst,
  discoveryPath,
  guardReviewMount,
  isConfirmable,
} from "@/lib/workflow";
import type { SceneStyleValue } from "@/components/scene-style-controls";
import { SceneStyleControls } from "@/components/scene-style-controls";
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

export default function ReviewPage() {
  const projectId = String(useParams().id);
  const router = useRouter();
  const { project, loading, error, refresh } = useProject(projectId);

  const [confirmed, setConfirmed] = useState<ConfirmResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [editingProfile, setEditingProfile] = useState<SceneStyleValue | null>(null);
  const redirected = useRef(false);

  // Mount guard: never transition; redirect out when not in REVIEW.
  useEffect(() => {
    if (!project || redirected.current) return;
    const redirect = guardReviewMount(projectId, project.status);
    if (redirect) {
      redirected.current = true;
      router.replace(redirect);
    }
  }, [project, projectId, router]);

  async function onConfirm() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.confirm(projectId);
      setConfirmed(res);
    } catch (err) {
      setActionError(err); // SPEC_VALIDATION_ERROR etc. -> stay unconfirmed
    } finally {
      setBusy(false);
    }
  }

  async function onSaveProfile() {
    if (!project || !editingProfile) return;
    setBusy(true);
    setActionError(null);
    try {
      // rollback-first: REVIEW->DISCOVERY, then PATCH in DISCOVERY (never in REVIEW).
      const profileInput: ProfileInput = { scene: editingProfile.scene };
      if (editingProfile.styleProfileId) {
        profileInput.styleProfileId = editingProfile.styleProfileId;
      }
      await changeProfileRollbackFirst(projectId, project.status, profileInput);
      // Session + confirmation are now invalid; force explicit re-discover.
      clearDiscoverySession(projectId);
      router.push(discoveryPath(projectId));
    } catch (err) {
      setActionError(err);
      setBusy(false);
      // The rollback transition may have already committed (REVIEW->DISCOVERY)
      // before a later PATCH/network failure. Re-fetch so the mount guard sees
      // the real backend state and redirects out of REVIEW instead of driving
      // future actions from a stale REVIEW.
      refresh();
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

  // Not in REVIEW: the mount guard is redirecting; render nothing meaningful.
  if (!isConfirmable(project.status)) {
    return <Loading label="正在跳转…" className="p-6" />;
  }

  const cached = getDiscoverySession(projectId);

  return (
    <WorkflowShell
      state={project.status}
      scene={project.scene}
      styleProfileId={project.styleProfileId}
      title="需求复核"
    >
      <div className="flex flex-col gap-6">
        {confirmed ? (
          <ConfirmedSpec spec={confirmed} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>确认前摘要</CardTitle>
              <CardDescription>
                完整的 questionPolicy / riskNotes 在确认后由后端生成，此处仅展示已可获取的字段。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <SummaryRow label="场景" value={project.scene} />
              <SummaryRow label="风格" value={project.styleProfileId} />
              {cached ? (
                <>
                  <SummaryRow label="澄清模式" value={cached.mode} />
                  <SummaryRow label="置信度阈值" value={cached.threshold.toFixed(2)} />
                  <SummaryRow label="已答问题" value={String(cached.answeredIds.length)} />
                  <SummaryRow label="已跳过问题" value={String(cached.skippedIds.length)} />
                </>
              ) : (
                <p className="text-muted-foreground">
                  会话本地字段（模式/阈值/计数）在刷新后已丢失，仅展示场景与风格。
                </p>
              )}
            </CardContent>
            <CardFooter className="mt-4">
              <Button type="button" onClick={onConfirm} disabled={busy}>
                {busy ? "确认中…" : "确认 Spec"}
              </Button>
            </CardFooter>
          </Card>
        )}

        {actionError ? <ErrorNotice error={actionError} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>修改场景 / 风格</CardTitle>
            <CardDescription>
              修改将先回退到需求澄清（清空会话与已确认 Spec），需重新走一遍澄清 → 复核流程。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {editingProfile ? (
              <SceneStyleControls
                value={editingProfile}
                onChange={setEditingProfile}
                disabled={busy}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                当前：{project.scene} / {project.styleProfileId}
              </p>
            )}
          </CardContent>
          <CardFooter className="mt-4 gap-2">
            {editingProfile ? (
              <>
                <Button type="button" onClick={onSaveProfile} disabled={busy}>
                  回退并重新澄清
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingProfile(null)}
                  disabled={busy}
                >
                  取消
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setEditingProfile({
                    scene: project.scene,
                    styleProfileId: project.styleProfileId,
                  })
                }
                disabled={busy}
              >
                修改 profile
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </WorkflowShell>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ConfirmedSpec({ spec }: { spec: ConfirmResponse }) {
  return (
    <Card data-confirmed="true">
      <CardHeader>
        <CardTitle>已确认的 Spec</CardTitle>
        <CardDescription>项目停留在需求复核（本期不进入后续阶段）。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-2">
          <SummaryRow label="Spec ID" value={spec.presentationSpecId} />
          <SummaryRow label="场景" value={spec.scene} />
          <SummaryRow label="风格" value={spec.styleProfileId} />
          <SummaryRow label="状态" value="已确认" />
        </div>
        <div className="flex flex-col gap-2">
          <p className="font-medium">提问策略</p>
          <SummaryRow label="模式" value={spec.questionPolicy.mode} />
          <SummaryRow label="场景阈值" value={spec.questionPolicy.sceneThreshold.toFixed(2)} />
          <SummaryRow label="最大提问数" value={String(spec.questionPolicy.maxQuestions)} />
        </div>
        <div className="flex flex-col gap-2">
          <p className="font-medium">风险提示</p>
          {spec.riskNotes.length > 0 ? (
            <ul className="list-disc pl-5 text-muted-foreground">
              {spec.riskNotes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">无</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
