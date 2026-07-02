"use client";

/**
 * Server-state + URL(`projectId`) driver (Phase 4 §2.5). The backend session is
 * the single source of truth; this hook fetches `GET /api/projects/{id}` and
 * exposes it with loading/error/refresh. No Zustand: workflow state lives on the
 * server and is re-read here, never mirrored into a client store.
 */
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type ProjectSummary } from "./api";

export interface UseProjectResult {
  project: ProjectSummary | null;
  loading: boolean;
  error: ApiError | null;
  /** Re-fetch the project (e.g. after a driven transition). */
  refresh: () => void;
}

export function useProject(projectId: string): UseProjectResult {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .getProject(projectId, controller.signal)
      .then((summary) => setProject(summary))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err : new ApiError({
          code: "UNKNOWN_ERROR",
          errorClass: "UNKNOWN_ERROR",
          status: 0,
          detailMessage: err instanceof Error ? err.message : undefined,
        }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, nonce]);

  return { project, loading, error, refresh };
}
