/**
 * Frontend-driven forward-transition + redirect model (Phase 4 §2.3a).
 *
 * The backend `discover`/`answer`/`skip`/`confirm` endpoints DO NOT advance the
 * workflow; the only way into `REQUIREMENT_REVIEW` is an explicit
 * `POST /transitions`. Because there is no session-read endpoint, the frontend
 * cannot tell "DISCOVERY with a live session" from "DISCOVERY whose session was
 * cleared". These helpers encode the rules that make a session-less REVIEW (and
 * its doomed confirm button) structurally impossible:
 *
 *  - NEW_PROJECT -> DISCOVERY may auto-drive on discovery mount (idempotent).
 *  - DISCOVERY -> REVIEW ONLY via the explicit "enter review" action, guarded
 *    on state == DISCOVERY; the review page NEVER drives a transition on mount.
 *  - Review mount when state != REVIEW -> redirect to currentStepPath(state).
 *  - Discovery mount when state ∉ {NEW, DISCOVERY} -> redirect to currentStepPath.
 *    (Each guard redirects to the state's home page -> no redirect loop.)
 *  - Profile change is rollback-first: roll REVIEW->DISCOVERY, then PATCH in
 *    DISCOVERY (never PATCH while in REVIEW).
 *
 * Pure planners (`planEnterDiscovery` / `planEnterReview`) hold the branch
 * decisions and stay trivially checkable; the async helpers just compose them
 * with the API client and hand navigation intent back to the caller.
 */
import type { WorkflowState } from "@ppt-pilot/shared-schema";

import { api, type ProfileInput, type ProfileResponse, type TransitionResponse } from "./api";

const NEW_PROJECT: WorkflowState = "NEW_PROJECT";
const REQUIREMENT_DISCOVERY: WorkflowState = "REQUIREMENT_DISCOVERY";
const REQUIREMENT_REVIEW: WorkflowState = "REQUIREMENT_REVIEW";
const OUTLINE_GENERATION: WorkflowState = "OUTLINE_GENERATION";
const OUTLINE_REVIEW: WorkflowState = "OUTLINE_REVIEW";
const SLIDE_PLANNING: WorkflowState = "SLIDE_PLANNING";
const SLIDE_PLAN_REVIEW: WorkflowState = "SLIDE_PLAN_REVIEW";
const SLIDE_GENERATION: WorkflowState = "SLIDE_GENERATION";
const EXPORT_READY: WorkflowState = "EXPORT_READY";
const EXPORTED: WorkflowState = "EXPORTED";

// --------------------------------------------------------------------------- //
// Route helpers
// --------------------------------------------------------------------------- //

export function discoveryPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/discovery`;
}

export function reviewPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/review`;
}

export function outlinePath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/outline`;
}

export function slidePlansPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/slide-plans`;
}

export function previewPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/preview`;
}

export function exportPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/export`;
}

/**
 * `state -> unique step page path` (Phase 4b §web-workflow-shell). The
 * `Record<WorkflowState, …>` keeps the mapping total — a newly added state is a
 * compile error until routed. Pure function of state, no I/O.
 */
const STEP_PATH_BUILDERS: Record<WorkflowState, (projectId: string) => string> = {
  NEW_PROJECT: discoveryPath,
  REQUIREMENT_DISCOVERY: discoveryPath,
  REQUIREMENT_REVIEW: reviewPath,
  OUTLINE_GENERATION: outlinePath,
  OUTLINE_REVIEW: outlinePath,
  SLIDE_PLANNING: slidePlansPath,
  SLIDE_PLAN_REVIEW: slidePlansPath,
  SLIDE_GENERATION: previewPath,
  EXPORT_READY: exportPath,
  EXPORTED: exportPath,
  // ponytail: EDITING/REVIEW 防御性映射；Phase 8 给它们加边使其可达时，须把二态并入 preview 接受集以保持无环不变式
  EDITING: previewPath,
  REVIEW: previewPath,
};

/** Unique step-page path for a state (redirect target for mount guards). */
export function currentStepPath(projectId: string, state: WorkflowState): string {
  return STEP_PATH_BUILDERS[state](projectId);
}

// --------------------------------------------------------------------------- //
// Pure planners (branch decisions — no I/O)
// --------------------------------------------------------------------------- //

/** Target for the NEW->DISCOVERY auto-drive, or null if no transition needed. */
export function planEnterDiscovery(state: WorkflowState): WorkflowState | null {
  return state === NEW_PROJECT ? REQUIREMENT_DISCOVERY : null;
}

export interface EnterReviewPlan {
  /** Transition to issue first, or null to navigate without transitioning. */
  transitionTo: WorkflowState | null;
  /** Whether the caller should navigate to /review. */
  navigate: boolean;
}

/**
 * Explicit "enter review" action, gated on state == DISCOVERY:
 *  - DISCOVERY -> transition to REVIEW, then navigate.
 *  - REVIEW    -> navigate only (avoid illegal REVIEW->REVIEW self-loop).
 *  - otherwise -> not eligible (do nothing).
 */
export function planEnterReview(state: WorkflowState): EnterReviewPlan {
  if (state === REQUIREMENT_DISCOVERY) {
    return { transitionTo: REQUIREMENT_REVIEW, navigate: true };
  }
  if (state === REQUIREMENT_REVIEW) {
    return { transitionTo: null, navigate: true };
  }
  return { transitionTo: null, navigate: false };
}

/** Shared branch-decision shape for the step-page "enter" planners (D2/D4). */
export interface EnterPlan {
  /** Transition to issue first, or null to navigate without transitioning. */
  transitionTo: WorkflowState | null;
  /** Whether the caller should navigate to the target step page. */
  navigate: boolean;
}

/**
 * Enter the outline page. `OUTLINE_GENERATION -> OUTLINE_REVIEW`; already-REVIEW
 * navigates only (no illegal self-loop); otherwise ineligible.
 */
export function planEnterOutline(state: WorkflowState): EnterPlan {
  if (state === OUTLINE_GENERATION) {
    return { transitionTo: OUTLINE_REVIEW, navigate: true };
  }
  if (state === OUTLINE_REVIEW) {
    return { transitionTo: null, navigate: true };
  }
  return { transitionTo: null, navigate: false };
}

/**
 * Enter the slide-plans page. `SLIDE_PLANNING -> SLIDE_PLAN_REVIEW`;
 * already-REVIEW navigates only; otherwise ineligible.
 */
export function planEnterSlidePlans(state: WorkflowState): EnterPlan {
  if (state === SLIDE_PLANNING) {
    return { transitionTo: SLIDE_PLAN_REVIEW, navigate: true };
  }
  if (state === SLIDE_PLAN_REVIEW) {
    return { transitionTo: null, navigate: true };
  }
  return { transitionTo: null, navigate: false };
}

/**
 * Enter the preview page (materialization is carried in SLIDE_GENERATION).
 * `SLIDE_PLAN_REVIEW -> SLIDE_GENERATION`; already in SLIDE_GENERATION /
 * EXPORT_READY / EXPORTED navigates only (never self-loop back to
 * SLIDE_GENERATION — an illegal backward transition); otherwise ineligible.
 */
export function planEnterPreview(state: WorkflowState): EnterPlan {
  if (state === SLIDE_PLAN_REVIEW) {
    return { transitionTo: SLIDE_GENERATION, navigate: true };
  }
  if (state === SLIDE_GENERATION || state === EXPORT_READY || state === EXPORTED) {
    return { transitionTo: null, navigate: true };
  }
  return { transitionTo: null, navigate: false };
}

/**
 * Enter the export page. `SLIDE_GENERATION -> EXPORT_READY`; already
 * EXPORT_READY / EXPORTED navigates only; otherwise ineligible.
 */
export function planEnterExport(state: WorkflowState): EnterPlan {
  if (state === SLIDE_GENERATION) {
    return { transitionTo: EXPORT_READY, navigate: true };
  }
  if (state === EXPORT_READY || state === EXPORTED) {
    return { transitionTo: null, navigate: true };
  }
  return { transitionTo: null, navigate: false };
}

// --------------------------------------------------------------------------- //
// Mount guards — return a redirect path, or null to stay.
// --------------------------------------------------------------------------- //

/** Review page: stays only in REVIEW; else redirect to the state's home page. */
export function guardReviewMount(projectId: string, state: WorkflowState): string | null {
  return state === REQUIREMENT_REVIEW ? null : currentStepPath(projectId, state);
}

/** Discovery page: stays in NEW/DISCOVERY (its accept-set); else home page. */
export function guardDiscoveryMount(projectId: string, state: WorkflowState): string | null {
  return state === NEW_PROJECT || state === REQUIREMENT_DISCOVERY
    ? null
    : currentStepPath(projectId, state);
}

/** Confirm button availability is decided purely by the current state. */
export function isConfirmable(state: WorkflowState): boolean {
  return state === REQUIREMENT_REVIEW;
}

// Per-page mount accept sets. If `state` is in the set the page stays (null);
// otherwise the guard redirects to `currentStepPath(state)`. preview/export
// intentionally overlap on EXPORT_READY/EXPORTED — both pages accept those.
const OUTLINE_MOUNT_STATES: readonly WorkflowState[] = [OUTLINE_GENERATION, OUTLINE_REVIEW];
const SLIDE_PLANS_MOUNT_STATES: readonly WorkflowState[] = [SLIDE_PLANNING, SLIDE_PLAN_REVIEW];
const PREVIEW_MOUNT_STATES: readonly WorkflowState[] = [
  SLIDE_GENERATION,
  EXPORT_READY,
  EXPORTED,
];
const EXPORT_MOUNT_STATES: readonly WorkflowState[] = [EXPORT_READY, EXPORTED];

export function guardOutlineMount(projectId: string, state: WorkflowState): string | null {
  return OUTLINE_MOUNT_STATES.includes(state) ? null : currentStepPath(projectId, state);
}

export function guardSlidePlansMount(projectId: string, state: WorkflowState): string | null {
  return SLIDE_PLANS_MOUNT_STATES.includes(state) ? null : currentStepPath(projectId, state);
}

export function guardPreviewMount(projectId: string, state: WorkflowState): string | null {
  return PREVIEW_MOUNT_STATES.includes(state) ? null : currentStepPath(projectId, state);
}

export function guardExportMount(projectId: string, state: WorkflowState): string | null {
  return EXPORT_MOUNT_STATES.includes(state) ? null : currentStepPath(projectId, state);
}

// --------------------------------------------------------------------------- //
// Async helpers (compose planners + API; caller performs navigation)
// --------------------------------------------------------------------------- //

/**
 * Ensure the project is in DISCOVERY. Auto-drives NEW->DISCOVERY (idempotent:
 * a no-op if already in DISCOVERY). Returns the effective current state.
 */
export async function enterDiscovery(
  projectId: string,
  state: WorkflowState,
  signal?: AbortSignal,
): Promise<WorkflowState> {
  const target = planEnterDiscovery(state);
  if (target === null) {
    return state;
  }
  const res = await api.transition(projectId, target, signal);
  return res.status;
}

export interface EnterReviewResult {
  /** True when the caller should navigate to the review page. */
  navigate: boolean;
  /** Transition response when a transition was issued, else null. */
  transition: TransitionResponse | null;
}

/**
 * Drive the explicit "enter review" action. Transitions DISCOVERY->REVIEW only
 * when in DISCOVERY; navigates-only when already REVIEW; refuses otherwise.
 * The caller navigates to `reviewPath(projectId)` when `navigate` is true.
 */
export async function enterReview(
  projectId: string,
  state: WorkflowState,
  signal?: AbortSignal,
): Promise<EnterReviewResult> {
  const plan = planEnterReview(state);
  if (plan.transitionTo === null) {
    return { navigate: plan.navigate, transition: null };
  }
  const transition = await api.transition(projectId, plan.transitionTo, signal);
  return { navigate: true, transition };
}

/** Navigation intent for a step-page "enter" action. */
export interface EnterResult {
  /** True when the caller should navigate to the target step page. */
  navigate: boolean;
  /** Transition response when a transition was issued, else null. */
  transition: TransitionResponse | null;
}

/** Run an `EnterPlan`: issue its transition (if any), report navigation intent. */
async function runEnter(
  projectId: string,
  plan: EnterPlan,
  signal?: AbortSignal,
): Promise<EnterResult> {
  if (plan.transitionTo === null) {
    return { navigate: plan.navigate, transition: null };
  }
  const transition = await api.transition(projectId, plan.transitionTo, signal);
  return { navigate: true, transition };
}

export function enterOutline(projectId: string, state: WorkflowState, signal?: AbortSignal) {
  return runEnter(projectId, planEnterOutline(state), signal);
}

export function enterSlidePlans(projectId: string, state: WorkflowState, signal?: AbortSignal) {
  return runEnter(projectId, planEnterSlidePlans(state), signal);
}

export function enterPreview(projectId: string, state: WorkflowState, signal?: AbortSignal) {
  return runEnter(projectId, planEnterPreview(state), signal);
}

export function enterExport(projectId: string, state: WorkflowState, signal?: AbortSignal) {
  return runEnter(projectId, planEnterExport(state), signal);
}

// --------------------------------------------------------------------------- //
// Chained generation helpers (D3): transition -> generate -> transition.
// --------------------------------------------------------------------------- //

/**
 * Result of a chained generation. On failure the project is left in the
 * generation state (step ③ was skipped); the caller stays put / navigates to
 * the target page and shows the error, and may retry generate + the second
 * transition (never the first — already in the generation state).
 */
export type ChainResult = { ok: true } | { ok: false; error: unknown };

/**
 * REQUIREMENT_REVIEW confirmed -> chain into OUTLINE_REVIEW:
 *  ① POST /transitions {to: OUTLINE_GENERATION}
 *  ② POST /outline/generate
 *  ③ POST /transitions {to: OUTLINE_REVIEW}
 * Any step throwing short-circuits the rest (② failing never runs ③) and
 * returns the error. All API calls receive the same AbortSignal.
 */
export async function chainGenerateOutline(
  projectId: string,
  signal?: AbortSignal,
): Promise<ChainResult> {
  try {
    await api.transition(projectId, OUTLINE_GENERATION, signal);
    await api.generateOutline(projectId, signal);
    await api.transition(projectId, OUTLINE_REVIEW, signal);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * OUTLINE_REVIEW confirmed -> chain into SLIDE_PLAN_REVIEW:
 *  ① POST /transitions {to: SLIDE_PLANNING}
 *  ② POST /slides/plans/generate
 *  ③ POST /transitions {to: SLIDE_PLAN_REVIEW}
 * Same short-circuit + AbortSignal semantics as `chainGenerateOutline`.
 */
export async function chainGenerateSlidePlans(
  projectId: string,
  signal?: AbortSignal,
): Promise<ChainResult> {
  try {
    await api.transition(projectId, SLIDE_PLANNING, signal);
    await api.generateSlidePlans(projectId, signal);
    await api.transition(projectId, SLIDE_PLAN_REVIEW, signal);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Rollback-first profile change (Phase 4 §5.3 / web-spec-review):
 *  1. if in REVIEW, roll back REVIEW->DISCOVERY;
 *  2. PATCH profile — ONLY ever issued while in DISCOVERY;
 * The caller then re-discovers and lets the user explicitly re-enter review.
 * The review page's "redirect when != REVIEW" guard takes the user back to
 * discovery during the cleared-session window.
 */
export async function changeProfileRollbackFirst(
  projectId: string,
  state: WorkflowState,
  input: ProfileInput,
  signal?: AbortSignal,
): Promise<ProfileResponse> {
  if (state !== REQUIREMENT_REVIEW && state !== REQUIREMENT_DISCOVERY) {
    // Profile edits are only meaningful from the review/discovery flow; refusing
    // here prevents a PATCH from an unexpected state.
    throw new Error(
      `changeProfileRollbackFirst requires REVIEW or DISCOVERY, got ${state}`,
    );
  }
  if (state === REQUIREMENT_REVIEW) {
    await api.transition(projectId, REQUIREMENT_DISCOVERY, signal);
  }
  // Now guaranteed to be in DISCOVERY: PATCH is never issued while in REVIEW.
  return api.updateProfile(projectId, input, signal);
}

// --------------------------------------------------------------------------- //
// Display
// --------------------------------------------------------------------------- //

/** Human-readable label for each WorkflowState (shell status display). */
export const WORKFLOW_STATE_LABELS: Record<WorkflowState, string> = {
  NEW_PROJECT: "新建项目",
  REQUIREMENT_DISCOVERY: "需求澄清",
  REQUIREMENT_REVIEW: "需求复核",
  OUTLINE_GENERATION: "大纲生成",
  OUTLINE_REVIEW: "大纲复核",
  SLIDE_PLANNING: "幻灯片规划",
  SLIDE_PLAN_REVIEW: "规划复核",
  SLIDE_GENERATION: "幻灯片生成",
  EDITING: "编辑中",
  REVIEW: "复核",
  EXPORT_READY: "待导出",
  EXPORTED: "已导出",
};

export function workflowStateLabel(state: WorkflowState): string {
  return WORKFLOW_STATE_LABELS[state] ?? state;
}
