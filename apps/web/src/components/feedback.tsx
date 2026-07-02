"use client";

/**
 * Global loading + structured error presentation (Phase 4 §2.2). `ErrorNotice`
 * renders any thrown value through `presentError`, so an unmapped code shows the
 * backend `details.message` fallback instead of crashing or white-screening.
 */
import { AlertCircle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { presentError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface LoadingProps {
  label?: string;
  className?: string;
}

/** Global loading indicator for any async call. */
export function Loading({ label = "加载中…", className }: LoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export interface ErrorNoticeProps {
  error: unknown;
  /** Shown as a retry button when the error is retryable. */
  onRetry?: () => void;
  /** Extra affordances (e.g. an explicit "restart clarification" action). */
  children?: ReactNode;
  className?: string;
}

/** Structured, non-crashing error banner keyed off the error `code`. */
export function ErrorNotice({ error, onRetry, children, className }: ErrorNoticeProps) {
  const presented = presentError(error);
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm",
        className,
      )}
      data-error-kind={presented.kind}
    >
      <div className="flex items-center gap-2 font-medium text-destructive">
        <AlertCircle className="size-4" aria-hidden />
        <span>{presented.title}</span>
      </div>
      <p className="text-muted-foreground">{presented.message}</p>
      {(presented.retryable && onRetry) || children ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {presented.retryable && onRetry ? (
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              重试
            </Button>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
