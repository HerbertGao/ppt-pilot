import type {
  ActorType,
  ElementType,
  EventType,
  QuestionMode,
  Scene,
  SlideStatus,
  VersionScope,
  VisualIntent,
} from "./enums.js";

export type JsonObject = Record<string, unknown>;

export interface ThemeTokens {
  palette: Record<string, string>;
  fonts: Record<string, string>;
  spacing: Record<string, number | string>;
}

export interface QuestionPolicy {
  mode: QuestionMode;
  sceneThreshold: number;
  maxQuestions: number;
}

export interface LockFields {
  locked: boolean;
  lockedBy?: ActorType;
  lockedAt?: string;
  lockReason?: string;
}

export interface PresentationSpec {
  id?: string;
  topic: string;
  audience: string;
  purpose: string;
  durationMinutes?: number;
  slideCountTarget?: number;
  language: string;
  tone?: string;
  scene: Scene;
  styleProfileId?: string;
  questionPolicy: QuestionPolicy;
  riskNotes?: string[];
  style?: JsonObject;
  constraints?: string[];
  sourceMaterials?: unknown[];
  confirmedByUser: boolean;
}

export interface NormalizedPresentationSpec extends PresentationSpec {
  styleProfileId: string;
}

export interface OutlineSection {
  title: string;
  purpose: string;
  estimatedSlides: number;
}

export interface Outline {
  id?: string;
  sections: OutlineSection[];
  confirmedByUser: boolean;
  riskNotes?: string[];
}

export interface SlidePlan {
  id?: string;
  slideId?: string;
  title?: string;
  objective: string;
  keyMessage: string;
  contentIntent: string;
  visualIntent: VisualIntent;
  layoutSuggestion: string;
  requiredAssets: string[];
  riskNotes: string[];
}

export interface AssetLicense {
  name?: string;
  url?: string;
  attributionRequired: boolean;
}

export interface Asset {
  id: string;
  type: string;
  source: string;
  url?: string;
  prompt?: string;
  license?: AssetLicense;
  metadata: JsonObject;
}

export interface ImageVariantsPolicy {
  count: number;
  selectedAssetId?: string;
}

export interface Element extends LockFields {
  id: string;
  slideId: string;
  type: ElementType;
  content: JsonObject;
  imageVariantsPolicy?: ImageVariantsPolicy;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  style: JsonObject;
  metadata: JsonObject;
}

export interface Slide extends LockFields {
  id: string;
  presentationId: string;
  index: number;
  title: string;
  status: SlideStatus;
  plan: SlidePlan;
  elements: Element[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Presentation {
  id: string;
  projectId: string;
  title: string;
  spec: PresentationSpec;
  theme: JsonObject;
  scene: Scene;
  styleProfileId?: string;
  slides: Slide[];
  assets?: Asset[];
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedPresentation extends Omit<Presentation, "spec" | "styleProfileId" | "assets"> {
  spec: NormalizedPresentationSpec;
  styleProfileId: string;
  assets?: Asset[];
}

export interface Version {
  id: string;
  projectId: string;
  scope: VersionScope;
  targetId: string;
  parentVersionId: string | null;
  snapshot: JsonObject;
  diff: JsonObject;
  createdBy: ActorType;
  createdAt: string;
}

export interface Event {
  id: string;
  projectId: string;
  type: EventType;
  actor: ActorType;
  payload: JsonObject;
  createdAt: string;
}
