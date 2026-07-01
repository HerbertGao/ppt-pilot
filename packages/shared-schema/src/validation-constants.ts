export {
  ACTOR_TYPES,
  ELEMENT_TYPES,
  EVENT_TYPES,
  QUESTION_MODES,
  SCENES,
  SLIDE_STATUSES,
  VERSION_SCOPES,
  WORKFLOW_STATES,
} from "./enums.js";
export type {
  ActorType,
  ElementType,
  EventType,
  QuestionMode,
  Scene,
  SlideStatus,
  VersionScope,
  WorkflowState,
} from "./enums.js";

export const ENTITY_NAMES = [
  "PresentationSpec",
  "Presentation",
  "Slide",
  "SlidePlan",
  "Element",
  "Asset",
  "Version",
  "Event",
] as const;

export type EntityName = (typeof ENTITY_NAMES)[number];

export function isEntityName(value: string): value is EntityName {
  return (ENTITY_NAMES as readonly string[]).includes(value);
}
