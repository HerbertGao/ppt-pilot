export const SCENES = ["default", "education", "corporate"] as const;
export type Scene = (typeof SCENES)[number];

export const QUESTION_MODES = ["fast", "thorough"] as const;
export type QuestionMode = (typeof QUESTION_MODES)[number];

export const WORKFLOW_STATES = [
  "NEW_PROJECT",
  "REQUIREMENT_DISCOVERY",
  "REQUIREMENT_REVIEW",
  "OUTLINE_GENERATION",
  "OUTLINE_REVIEW",
  "SLIDE_PLANNING",
  "SLIDE_PLAN_REVIEW",
  "SLIDE_GENERATION",
  "EDITING",
  "REVIEW",
  "EXPORT_READY",
  "EXPORTED",
] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const SLIDE_STATUSES = ["draft", "planned", "generated", "reviewed", "locked"] as const;
export type SlideStatus = (typeof SLIDE_STATUSES)[number];

export const ELEMENT_TYPES = [
  "text",
  "image",
  "shape",
  "icon",
  "chart",
  "table",
  "diagram",
  "group",
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const ACTOR_TYPES = ["user", "ai", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const REGENERATE_SCOPES = [
  "text_only",
  "image_only",
  "layout_only",
  "full_slide",
  "element",
  "slide",
] as const;
export type RegenerateScope = (typeof REGENERATE_SCOPES)[number];

export const VERSION_SCOPES = ["presentation", "slide", "element"] as const;
export type VersionScope = (typeof VERSION_SCOPES)[number];

export const EVENT_TYPES = [
  "SCENE_STYLE_PROFILE_UPDATED",
  "QUESTION_POLICY_APPLIED",
  "REQUIREMENT_QUESTION_ASKED",
  "REQUIREMENT_QUESTION_SKIPPED",
  "PRESENTATION_SPEC_CONFIRMED",
  "WORKFLOW_STATE_CHANGED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
