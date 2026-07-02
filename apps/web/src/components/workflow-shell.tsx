/**
 * App shell (Phase 4 §2.3): a top bar showing the current `WorkflowState` and
 * the scene/style, wrapping page content. Presentational — pages fetch the
 * project (server-state, §2.5) and pass it in.
 *
 * Stage gating: later stages (outline / slide / export) are not exposed until a
 * spec is confirmed. Those pages do not exist this phase, so the shell renders
 * no post-review navigation at all; the gating point lives here for Phase 5+.
 */
import type { Scene, WorkflowState } from "@ppt-pilot/shared-schema";
import type { ReactNode } from "react";

import { workflowStateLabel } from "@/lib/workflow";

const SCENE_LABELS: Record<Scene, string> = {
  default: "通用",
  education: "教育",
  corporate: "企业",
};

export interface WorkflowShellProps {
  state: WorkflowState;
  scene: Scene;
  styleProfileId: string;
  title?: string;
  /** Optional right-aligned actions (e.g. page-level controls). */
  actions?: ReactNode;
  children: ReactNode;
}

export function WorkflowShell({
  state,
  scene,
  styleProfileId,
  title,
  actions,
  children,
}: WorkflowShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
          <span className="font-semibold">PPTPilot</span>
          {title ? <span className="text-muted-foreground">/ {title}</span> : null}
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <StatusPill label="状态" value={workflowStateLabel(state)} />
            <StatusPill label="场景" value={SCENE_LABELS[scene]} />
            <StatusPill label="风格" value={styleProfileId} />
            {actions}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-6">{children}</main>
    </div>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
