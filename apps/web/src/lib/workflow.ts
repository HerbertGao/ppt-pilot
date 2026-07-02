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
 *  - Review mount when state != REVIEW  -> redirect to /discovery.
 *  - Discovery mount when state == REVIEW -> redirect to /review.
 *    (Predicates are mutually exclusive -> no redirect loop.)
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

// --------------------------------------------------------------------------- //
// Route helpers
// --------------------------------------------------------------------------- //

export function discoveryPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/discovery`;
}

export function reviewPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/review`;
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

// --------------------------------------------------------------------------- //
// Mount guards — return a redirect path, or null to stay.
// --------------------------------------------------------------------------- //

/** Review page: if state != REVIEW, redirect back to discovery (no transition). */
export function guardReviewMount(projectId: string, state: WorkflowState): string | null {
  return state === REQUIREMENT_REVIEW ? null : discoveryPath(projectId);
}

/** Discovery page: if state == REVIEW (back / manual URL), redirect to review. */
export function guardDiscoveryMount(projectId: string, state: WorkflowState): string | null {
  return state === REQUIREMENT_REVIEW ? reviewPath(projectId) : null;
}

/** Confirm button availability is decided purely by the current state. */
export function isConfirmable(state: WorkflowState): boolean {
  return state === REQUIREMENT_REVIEW;
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
