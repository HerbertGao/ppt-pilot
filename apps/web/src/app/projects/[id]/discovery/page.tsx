"use client";

/**
 * Requirement discovery page (Phase 4 §4, web-requirement-discovery).
 *
 * Mount rules (§2.3a / §4.1):
 *  - state == REVIEW  -> redirect to /review (guardDiscoveryMount).
 *  - state == NEW     -> first entry: enterDiscovery (NEW->DISCOVERY) then discover.
 *  - state == DISCOVERY + cached session -> SPA reentry: restore from cache.
 *  - state == DISCOVERY + no cache       -> hard refresh: show explicit
 *    "restart clarification" CTA; NEVER auto re-discover (would overwrite the
 *    backend session — there is no session-read endpoint).
 *
 * answer/skip only return the confidence view; the rendered cards stay put and
 * progress updates from confidence/threshold/thresholdReached. QUESTION_NOT_FOUND
 * is treated as an invalidated session: explicit restart, never auto-discover.
 */
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  api,
  ApiError,
  type AnswerInput,
  type QuestionCard as QuestionCardData,
} from "@/lib/api";
import {
  clearDiscoverySession,
  getDiscoverySession,
  setDiscoverySession,
  type DiscoverySession,
} from "@/lib/discovery-session";
import { useProject } from "@/lib/use-project";
import {
  enterDiscovery,
  enterReview,
  guardDiscoveryMount,
  reviewPath,
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

type Mode = "fast" | "thorough";

export default function DiscoveryPage() {
  const projectId = String(useParams().id);
  const router = useRouter();
  const { project, loading, error, refresh } = useProject(projectId);

  const [mode, setMode] = useState<Mode>("fast");
  const [session, setSessionState] = useState<DiscoverySession | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const mountHandled = useRef(false);

  function persist(next: DiscoverySession) {
    setDiscoverySession(projectId, next);
    setSessionState(next);
  }

  async function runDiscover(withMode: Mode) {
    setBusy(true);
    setActionError(null);
    setNeedsRestart(false);
    setSessionInvalid(false);
    try {
      // Ensure DISCOVERY first (auto-drives NEW->DISCOVERY; no-op otherwise).
      await enterDiscovery(projectId, project?.status ?? "NEW_PROJECT");
      const res = await api.discover(projectId, { mode: withMode });
      persist({
        mode: withMode,
        confidence: res.confidence,
        threshold: res.threshold,
        thresholdReached: res.thresholdReached,
        questions: res.questions,
        answeredIds: [],
        skippedIds: [],
      });
      refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  // Mount: run guard / first-entry / restore exactly once, after the project loads.
  useEffect(() => {
    if (!project || mountHandled.current) return;
    mountHandled.current = true;

    const redirect = guardDiscoveryMount(projectId, project.status);
    if (redirect) {
      router.replace(redirect);
      return;
    }
    const cached = getDiscoverySession(projectId);
    if (cached) {
      setSessionState(cached);
      setMode(cached.mode);
      return;
    }
    if (project.status === "NEW_PROJECT") {
      void runDiscover(mode); // first entry
    } else {
      // DISCOVERY with no client state == hard refresh: never auto-discover.
      setNeedsRestart(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  async function onAnswer(q: QuestionCardData, selectedOptions: string[], freeText: string) {
    if (!session) return;
    setBusy(true);
    setActionError(null);
    try {
      const answerInput: AnswerInput = {};
      if (selectedOptions.length) answerInput.selectedOptions = selectedOptions;
      if (freeText.trim()) answerInput.answer = freeText.trim();
      const view = await api.answerQuestion(projectId, q.questionId, answerInput);
      persist({
        ...session,
        confidence: view.confidence,
        threshold: view.threshold,
        thresholdReached: view.thresholdReached,
        answeredIds: session.answeredIds.includes(q.questionId)
          ? session.answeredIds
          : [...session.answeredIds, q.questionId],
      });
    } catch (err) {
      handleSessionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function onSkip(q: QuestionCardData) {
    if (!session) return;
    setBusy(true);
    setActionError(null);
    try {
      const view = await api.skipQuestion(projectId, q.questionId, {});
      persist({
        ...session,
        confidence: view.confidence,
        threshold: view.threshold,
        thresholdReached: view.thresholdReached,
        skippedIds: session.skippedIds.includes(q.questionId)
          ? session.skippedIds
          : [...session.skippedIds, q.questionId],
      });
    } catch (err) {
      handleSessionError(err);
    } finally {
      setBusy(false);
    }
  }

  function handleSessionError(err: unknown) {
    if (err instanceof ApiError && err.code === "QUESTION_NOT_FOUND") {
      // Session invalidated/overwritten: explicit restart only, never auto-discover.
      setSessionInvalid(true);
      clearDiscoverySession(projectId);
      setSessionState(null);
      setActionError(err);
      return;
    }
    setActionError(err);
  }

  async function onEnterReview() {
    if (!project) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await enterReview(projectId, project.status);
      if (res.navigate) {
        router.push(reviewPath(projectId));
      }
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    clearDiscoverySession(projectId);
    setSessionState(null);
    void runDiscover(mode);
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

  const ready = session && (session.thresholdReached || session.questions.length === 0);

  return (
    <WorkflowShell
      state={project.status}
      scene={project.scene}
      styleProfileId={project.styleProfileId}
      title="需求澄清"
    >
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>澄清模式</CardTitle>
            <CardDescription>
              fast 更快达阈、问题更少；thorough 阈值更高、追问更多（上限由后端裁定）。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              disabled={busy}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="fast" id="mode-fast" />
                <Label htmlFor="mode-fast">fast</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="thorough" id="mode-thorough" />
                <Label htmlFor="mode-thorough">thorough</Label>
              </div>
            </RadioGroup>
          </CardContent>
          <CardFooter className="mt-4">
            <Button type="button" onClick={restart} disabled={busy}>
              {session ? "以该模式重新开始澄清" : "开始澄清"}
            </Button>
          </CardFooter>
        </Card>

        {actionError ? (
          <ErrorNotice error={actionError}>
            {sessionInvalid ? (
              <Button type="button" size="sm" onClick={restart} disabled={busy}>
                重新开始澄清
              </Button>
            ) : null}
          </ErrorNotice>
        ) : null}

        {needsRestart && !session ? (
          <Card>
            <CardHeader>
              <CardTitle>澄清进度已丢失</CardTitle>
              <CardDescription>
                页面已刷新，进行中的问答无法从后端恢复（无会话读取端点）。可以显式重新开始澄清（会覆盖后端已答/已跳过）。
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button type="button" onClick={restart} disabled={busy}>
                重新开始澄清
              </Button>
            </CardFooter>
          </Card>
        ) : null}

        {busy && !session ? <Loading label="生成澄清问题…" /> : null}

        {session ? (
          <>
            <ProgressBar session={session} />

            {ready ? (
              <Card>
                <CardHeader>
                  <CardTitle>信息已足够，可进入复核</CardTitle>
                  <CardDescription>
                    后端判定置信度已达阈或无需追问，可进入 Spec 复核。
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button type="button" onClick={onEnterReview} disabled={busy}>
                    进入复核
                  </Button>
                </CardFooter>
              </Card>
            ) : null}

            <div className="flex flex-col gap-4">
              {session.questions.map((q) => (
                <QuestionCardView
                  key={q.questionId}
                  question={q}
                  answered={session.answeredIds.includes(q.questionId)}
                  skipped={session.skippedIds.includes(q.questionId)}
                  disabled={busy}
                  onAnswer={onAnswer}
                  onSkip={onSkip}
                />
              ))}
            </div>

            {!ready && session.questions.length > 0 ? (
              <div>
                <Button type="button" variant="outline" onClick={onEnterReview} disabled={busy}>
                  进入复核
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </WorkflowShell>
  );
}

function ProgressBar({ session }: { session: DiscoverySession }) {
  const pct = Math.min(100, Math.round((session.confidence / (session.threshold || 1)) * 100));
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex justify-between text-muted-foreground">
        <span>
          置信度 {session.confidence.toFixed(2)} / 阈值 {session.threshold.toFixed(2)}
        </span>
        <span>
          已答 {session.answeredIds.length} · 已跳过 {session.skippedIds.length}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={session.confidence}
          aria-valuemin={0}
          aria-valuemax={session.threshold}
        />
      </div>
    </div>
  );
}

function QuestionCardView({
  question,
  answered,
  skipped,
  disabled,
  onAnswer,
  onSkip,
}: {
  question: QuestionCardData;
  answered: boolean;
  skipped: boolean;
  disabled: boolean;
  onAnswer: (q: QuestionCardData, selected: string[], freeText: string) => void;
  onSkip: (q: QuestionCardData) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");

  function toggle(option: string) {
    setSelected((prev) =>
      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option],
    );
  }

  const status = answered ? "已回答" : skipped ? "已跳过" : null;

  return (
    <Card data-question-id={question.questionId} data-answered={answered} data-skipped={skipped}>
      <CardHeader>
        <CardTitle className="text-base">{question.prompt}</CardTitle>
        {status ? <CardDescription>{status}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {question.options.length > 0 ? (
          <div className="flex flex-col gap-2">
            {question.options.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggle(option)}
                  disabled={disabled}
                  className="size-4"
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        ) : null}
        {question.freeTextAllowed ? (
          <Textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="补充说明（可选）"
            rows={2}
            disabled={disabled}
          />
        ) : null}
      </CardContent>
      <CardFooter className="mt-4 gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => onAnswer(question, selected, freeText)}
          disabled={disabled || (selected.length === 0 && !freeText.trim())}
        >
          提交回答
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onSkip(question)}
          disabled={disabled}
        >
          跳过
        </Button>
      </CardFooter>
    </Card>
  );
}
