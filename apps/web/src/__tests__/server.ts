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
  ProjectSummary,
  SessionView,
} from "@/lib/api";

export type EndpointKey =
  | "createProject"
  | "getProject"
  | "transition"
  | "discover"
  | "answer"
  | "skip"
  | "confirm"
  | "updateProfile";

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
  if (path.endsWith("/requirements/discover")) return "discover";
  if (path.endsWith("/answer")) return "answer";
  if (path.endsWith("/skip")) return "skip";
  if (path.endsWith("/requirements/confirm")) return "confirm";
  if (path.endsWith("/transitions")) return "transition";
  if (path.endsWith("/profile")) return "updateProfile";
  if (path === "/api/projects" && method === "POST") return "createProject";
  return "getProject";
}

interface FakeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

function respond(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body ?? {}),
    json: async () => body ?? {},
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
