/**
 * Client-local clarification-session cache (Phase 4 §2.5 / §4.1 / §5.1).
 *
 * The backend has no "read in-progress session" endpoint, so the rendered
 * question cards + confidence/mode/threshold/counts only exist in the browser.
 * This is a plain in-memory module Map (NOT Zustand, NOT persisted): it survives
 * SPA client navigation (discovery <-> review) so reentry restores the rendered
 * cards, and is intentionally lost on a hard refresh (new JS context) so the
 * discovery page shows an explicit "restart" CTA and the review summary degrades
 * to scene/style-only — never a silent auto re-`discover` that overwrites the
 * backend session.
 */
import type { QuestionCard } from "./api";

export interface DiscoverySession {
  mode: "fast" | "thorough";
  confidence: number;
  threshold: number;
  thresholdReached: boolean;
  questions: QuestionCard[];
  answeredIds: string[];
  skippedIds: string[];
}

const cache = new Map<string, DiscoverySession>();

export function getDiscoverySession(projectId: string): DiscoverySession | undefined {
  return cache.get(projectId);
}

export function setDiscoverySession(projectId: string, session: DiscoverySession): void {
  cache.set(projectId, session);
}

export function clearDiscoverySession(projectId: string): void {
  cache.delete(projectId);
}
