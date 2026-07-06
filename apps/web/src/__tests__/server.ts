/**
 * Stateful `fetch` mock for the Phase 4 pages/planners. No real network: every
 * `/api/*` call is routed here. `transition` mutates the in-memory project status
 * (models the forward-drive), so `GET project` after a driven transition returns
 * the new state — exactly the seam the workflow rules key off. Tests assert on
 * `calls` (which endpoints fired, in what order, with what body).
 */
import { vi } from "vitest";

import type {
  ConfirmResponse,
  DiscoverResponse,
  ExportArtifactMetadata,
  ProjectSummary,
  SessionView,
  SlidePlansPayload,
} from "@/lib/api";
import type {
  Outline,
  Presentation,
} from "@ppt-pilot/shared-schema";

export type EndpointKey =
  | "createProject"
  | "getProject"
  | "transition"
  | "discover"
  | "answer"
  | "skip"
  | "confirm"
  | "updateProfile"
  // Phase 5 outline
  | "generateOutline"
  | "updateOutline"
  | "confirmOutline"
  | "getOutline"
  // Phase 5 slide plans
  | "generateSlidePlans"
  | "updateSlidePlan"
  | "confirmSlidePlans"
  | "getSlidePlans"
  // Phase 6 presentation
  | "materialize"
  | "getPresentation"
  // Phase 7 export
  | "exportPptx"
  | "listExports"
  | "downloadExport";

export interface ErrSpec {
  status: number;
  code: string;
  error?: string;
  field?: string;
  message?: string;
}

export interface Recorded {
  key: EndpointKey;
  method: string;
  path: string;
  body: unknown;
}

export interface ServerConfig {
  project: ProjectSummary;
  createProjectId?: string;
  discover?: DiscoverResponse;
  answer?: SessionView;
  skip?: SessionView;
  confirm?: ConfirmResponse;
  // Phase 5–7 mutable state (initial values; handlers mutate in-memory copies)
  outline?: Outline;
  slidePlans?: SlidePlansPayload;
  presentation?: Presentation;
  exports?: ExportArtifactMetadata[];
  /** Raw bytes (string) returned by `downloadExport` via `Blob`. */
  exportBytes?: string;
  errors?: Partial<Record<EndpointKey, ErrSpec>>;
  network?: Partial<Record<EndpointKey, boolean>>;
}

export interface FakeServer {
  calls: Recorded[];
  project: ProjectSummary;
  countOf(key: EndpointKey): number;
  bodyOf(key: EndpointKey): unknown;
}

function classify(method: string, path: string): EndpointKey {
  // Phase 3 requirement endpoints
  if (path.endsWith("/requirements/discover")) return "discover";
  if (path.endsWith("/answer")) return "answer";
  if (path.endsWith("/skip")) return "skip";
  if (path.endsWith("/requirements/confirm")) return "confirm";
  if (path.endsWith("/transitions")) return "transition";
  if (path.endsWith("/profile")) return "updateProfile";
  if (path === "/api/projects" && method === "POST") return "createProject";

  // Phase 5 outline — specific sub-paths before the bare /outline
  if (path.endsWith("/outline/generate")) return "generateOutline";
  if (path.endsWith("/outline/confirm")) return "confirmOutline";
  if (path.endsWith("/outline")) return method === "PUT" ? "updateOutline" : "getOutline";

  // Phase 5 slide plans — specific sub-paths before the bare /slides/plans
  if (path.endsWith("/slides/plans/generate")) return "generateSlidePlans";
  if (path.endsWith("/slides/plans/confirm")) return "confirmSlidePlans";
  if (path.endsWith("/slides/plans")) return "getSlidePlans";
  if (path.endsWith("/slides/materialize")) return "materialize";
  if (/\/slides\/[^/]+\/plan$/.test(path)) return "updateSlidePlan";

  // Phase 6 presentation
  if (path.endsWith("/presentation")) return "getPresentation";

  // Phase 7 export — plural /exports before singular /export/{id}
  if (path.endsWith("/exports")) return "listExports";
  if (path.endsWith("/export") && method === "POST") return "exportPptx";
  if (/\/export\/[^/]+$/.test(path)) return "downloadExport";

  return "getProject";
}

interface FakeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  blob(): Promise<Blob>;
}

function respond(status: number, body: unknown): FakeResponse {
  const text = JSON.stringify(body ?? {});
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => body ?? {},
    blob: async () => new Blob([text]),
  };
}

/** Binary response for `downloadExport` — `blob()` returns raw bytes, not JSON. */
function respondBlob(status: number, bytes: string): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => bytes,
    json: async () => {
      throw new SyntaxError("binary response is not JSON");
    },
    blob: async () => new Blob([bytes]),
  };
}

function errorEnvelope(spec: ErrSpec): FakeResponse {
  return respond(spec.status, {
    error: spec.error ?? "ERROR",
    code: spec.code,
    details: { field: spec.field, message: spec.message },
  });
}

export function defaultView(over: Partial<SessionView> = {}): SessionView {
  return {
    confidence: 0.3,
    threshold: 0.7,
    thresholdReached: false,
    skippedQuestionIds: [],
    nextState: "REQUIREMENT_DISCOVERY",
    ...over,
  };
}

/** Phase 5 default outline (unconfirmed, 3 sections). */
export function defaultOutline(over: Partial<Outline> = {}): Outline {
  return {
    sections: [
      { title: "引言", purpose: "介绍主题背景与目标", estimatedSlides: 1 },
      { title: "核心内容", purpose: "展开主要论点与论据", estimatedSlides: 3 },
      { title: "总结", purpose: "回顾要点并呼吁行动", estimatedSlides: 1 },
    ],
    confirmedByUser: false,
    ...over,
  };
}

/** Phase 5 default slide plans (unconfirmed, single slide). */
export function defaultSlidePlans(over: Partial<SlidePlansPayload> = {}): SlidePlansPayload {
  return {
    slidePlans: [
      {
        slideId: "slide-1",
        title: "引言",
        objective: "介绍主题背景",
        keyMessage: "理解主题的重要性",
        contentIntent: "text",
        visualIntent: "text",
        layoutSuggestion: "title-content",
        requiredAssets: [],
        riskNotes: [],
      },
    ],
    slidePlansConfirmed: false,
    ...over,
  };
}

/** Phase 6 default presentation (materialized, no slides). */
export function defaultPresentation(over: Partial<Presentation> = {}): Presentation {
  return {
    id: "pres-p1",
    projectId: "p1",
    title: "测试演示文稿",
    spec: {
      topic: "测试主题",
      audience: "通用受众",
      purpose: "演示",
      language: "zh",
      scene: "default",
      questionPolicy: { mode: "fast", sceneThreshold: 0.7, maxQuestions: 5 },
      confirmedByUser: true,
    },
    theme: { palette: {}, fonts: {}, spacing: {} },
    scene: "default",
    styleProfileId: "default-standard",
    slides: [],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...over,
  };
}

/** Phase 7 default export metadata (no `bytesBase64`). */
export function defaultExportMetadata(
  over: Partial<ExportArtifactMetadata> = {},
): ExportArtifactMetadata {
  return {
    id: "export-1",
    projectId: "p1",
    format: "pptx",
    byteSize: 1024,
    sourcePresentationId: "pres-p1",
    createdBy: "user",
    createdAt: "2025-01-01T00:00:00Z",
    ...over,
  };
}

export function installServer(config: ServerConfig): FakeServer {
  const server: FakeServer = {
    calls: [],
    project: { ...config.project },
    countOf(key) {
      return this.calls.filter((c) => c.key === key).length;
    },
    bodyOf(key) {
      const hit = [...this.calls].reverse().find((c) => c.key === key);
      return hit?.body;
    },
  };

  // Mutable Phase 5–7 state — initialised from config; handlers mutate these
  // in-memory copies to faithfully model the backend's persist-then-read cycle.
  let outline: Outline | undefined = config.outline;
  let slidePlans: SlidePlansPayload | undefined = config.slidePlans;
  let presentation: Presentation | undefined = config.presentation;
  let exportsList: ExportArtifactMetadata[] = config.exports
    ? config.exports.map((e) => ({ ...e }))
    : [];
  let exportSeq = 0;

  const fetchMock = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (input: any, init?: any): Promise<FakeResponse> => {
      const method: string = init?.method ?? "GET";
      const path = String(input);
      const key = classify(method, path);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = init?.body ? JSON.parse(String(init.body)) : undefined;
      server.calls.push({ key, method, path, body });

      if (config.network?.[key]) {
        throw new TypeError("Failed to fetch");
      }
      const err = config.errors?.[key];
      if (err) return errorEnvelope(err);

      switch (key) {
        case "createProject":
          return respond(200, {
            projectId: config.createProjectId ?? server.project.projectId,
            status: "NEW_PROJECT",
          });
        case "getProject":
          return respond(200, server.project);
        case "transition":
          server.project = { ...server.project, status: body.to };
          return respond(200, {
            projectId: server.project.projectId,
            status: body.to,
          });
        case "discover":
          return respond(200, config.discover ?? { ...defaultView(), questions: [] });
        case "answer":
          return respond(200, config.answer ?? defaultView({ confidence: 0.75, thresholdReached: true }));
        case "skip":
          return respond(200, config.skip ?? defaultView({ confidence: 0.35 }));
        case "confirm":
          return respond(200, config.confirm ?? defaultConfirm(server.project));
        case "updateProfile":
          if (body.scene) server.project = { ...server.project, scene: body.scene };
          if (body.styleProfileId) {
            server.project = { ...server.project, styleProfileId: body.styleProfileId };
          }
          return respond(200, {
            projectId: server.project.projectId,
            scene: server.project.scene,
            styleProfileId: server.project.styleProfileId,
            status: server.project.status,
          });

        // --- Phase 5 outline (returns bare Outline) ---
        case "generateOutline":
          outline = outline ?? defaultOutline();
          outline = { ...outline, confirmedByUser: false };
          return respond(200, outline);
        case "updateOutline":
          // body IS the Outline; backend forces confirmedByUser=false on edit.
          outline = { ...body, confirmedByUser: false };
          return respond(200, outline);
        case "confirmOutline":
          if (!outline) return errorEnvelope({ status: 404, code: "OUTLINE_NOT_FOUND" });
          outline = { ...outline, confirmedByUser: true };
          return respond(200, outline);
        case "getOutline":
          if (outline) return respond(200, outline);
          return errorEnvelope({ status: 404, code: "OUTLINE_NOT_FOUND" });

        // --- Phase 5 slide plans (returns {slidePlans, slidePlansConfirmed}) ---
        case "generateSlidePlans":
          slidePlans = slidePlans ?? defaultSlidePlans();
          slidePlans = { ...slidePlans, slidePlansConfirmed: false };
          return respond(200, slidePlans);
        case "updateSlidePlan": {
          if (!slidePlans) {
            return errorEnvelope({ status: 404, code: "SLIDE_PLAN_NOT_FOUND" });
          }
          const match = path.match(/\/slides\/([^/]+)\/plan$/);
          const slideId = match ? decodeURIComponent(match[1]!) : "";
          const exists = slidePlans.slidePlans.some((p) => p.slideId === slideId);
          if (!exists) {
            return errorEnvelope({ status: 404, code: "SLIDE_PLAN_NOT_FOUND" });
          }
          slidePlans = { ...slidePlans, slidePlansConfirmed: false };
          return respond(200, slidePlans);
        }
        case "confirmSlidePlans":
          if (!slidePlans || slidePlans.slidePlans.length === 0) {
            return errorEnvelope({ status: 404, code: "SLIDE_PLAN_NOT_FOUND" });
          }
          slidePlans = { ...slidePlans, slidePlansConfirmed: true };
          return respond(200, slidePlans);
        case "getSlidePlans":
          if (slidePlans && slidePlans.slidePlans.length > 0) return respond(200, slidePlans);
          return errorEnvelope({ status: 404, code: "SLIDE_PLAN_NOT_FOUND" });

        // --- Phase 6 presentation (returns bare Presentation) ---
        case "materialize":
          presentation = presentation ?? defaultPresentation();
          return respond(200, presentation);
        case "getPresentation":
          if (presentation) return respond(200, presentation);
          return errorEnvelope({ status: 404, code: "PRESENTATION_NOT_FOUND" });

        // --- Phase 7 export (metadata only; download returns Blob) ---
        case "exportPptx": {
          exportSeq++;
          const meta = defaultExportMetadata({
            id: `export-${exportSeq}`,
            projectId: server.project.projectId,
            sourcePresentationId: presentation?.id ?? "pres-p1",
          });
          exportsList = [...exportsList, meta];
          return respond(200, meta);
        }
        case "listExports":
          return respond(200, { exports: exportsList });
        case "downloadExport": {
          const match = path.match(/\/export\/([^/]+)$/);
          const artifactId = match ? decodeURIComponent(match[1]!) : "";
          const exists = exportsList.some((e) => e.id === artifactId);
          if (!exists) {
            return errorEnvelope({ status: 404, code: "EXPORT_ARTIFACT_NOT_FOUND" });
          }
          return respondBlob(200, config.exportBytes ?? "fake-pptx-bytes");
        }
      }
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return server;
}

export function defaultConfirm(project: ProjectSummary): ConfirmResponse {
  return {
    presentationSpecId: "spec-1",
    confirmed: true,
    scene: project.scene,
    styleProfileId: project.styleProfileId,
    questionPolicy: { mode: "fast", sceneThreshold: 0.7, maxQuestions: 5 },
    riskNotes: ["示例风险提示"],
    nextState: "REQUIREMENT_REVIEW",
  };
}

export function project(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    projectId: "p1",
    title: "测试项目",
    scene: "default",
    styleProfileId: "default-standard",
    status: "NEW_PROJECT",
    ...over,
  };
}
