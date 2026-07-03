export {
  ACTOR_TYPES,
  ELEMENT_TYPES,
  EVENT_TYPES,
  EXPORT_FORMATS,
  QUESTION_MODES,
  SCENES,
  SLIDE_STATUSES,
  VERSION_SCOPES,
  VISUAL_INTENTS,
  WORKFLOW_STATES,
} from "./enums.js";
export type {
  ActorType,
  ElementType,
  EventType,
  ExportFormat,
  QuestionMode,
  Scene,
  SlideStatus,
  VersionScope,
  VisualIntent,
  WorkflowState,
} from "./enums.js";

// Upper bounds for outline/slide-plan sizing, exposed for backend consumption
// via the Node constants bridge (do not hand-copy in Python).
export const MAX_OUTLINE_SECTIONS = 20;
export const MAX_TOTAL_SLIDE_PLANS = 60;

export const ENTITY_NAMES = [
  "PresentationSpec",
  "Presentation",
  "Slide",
  "SlidePlan",
  "Outline",
  "Element",
  "Asset",
  "Version",
  "Event",
  "ThemeTokens",
  "ExportArtifact",
] as const;

export type EntityName = (typeof ENTITY_NAMES)[number];

export function isEntityName(value: string): value is EntityName {
  return (ENTITY_NAMES as readonly string[]).includes(value);
}
