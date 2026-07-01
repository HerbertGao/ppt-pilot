import type { QuestionMode, Scene } from "./enums.js";
import type { QuestionPolicy } from "./types.js";

export interface StyleProfile {
  id: string;
  name: string;
  scene: Scene;
}

export const DEFAULT_STYLE_PROFILE_ID_BY_SCENE = {
  default: "style_default",
  education: "style_education_default",
  corporate: "style_corporate_default",
} as const satisfies Record<Scene, string>;

export type BuiltInStyleProfileId =
  (typeof DEFAULT_STYLE_PROFILE_ID_BY_SCENE)[keyof typeof DEFAULT_STYLE_PROFILE_ID_BY_SCENE];

export const BUILT_IN_STYLE_PROFILES: Record<BuiltInStyleProfileId, StyleProfile> = {
  style_default: {
    id: "style_default",
    name: "Default",
    scene: "default",
  },
  style_education_default: {
    id: "style_education_default",
    name: "Education default",
    scene: "education",
  },
  style_corporate_default: {
    id: "style_corporate_default",
    name: "Corporate default",
    scene: "corporate",
  },
};

export const DEFAULT_MAX_QUESTIONS_BY_MODE = {
  fast: 3,
  thorough: 5,
} as const satisfies Record<QuestionMode, number>;

export const DEFAULT_FAST_SCENE_THRESHOLD_BY_SCENE = {
  default: 0.78,
  education: 0.82,
  corporate: 0.75,
} as const satisfies Record<Scene, number>;

export const THOROUGH_MIN_SCENE_THRESHOLD = 0.85;

export function getDefaultStyleProfileId(scene: Scene): BuiltInStyleProfileId {
  return DEFAULT_STYLE_PROFILE_ID_BY_SCENE[scene];
}

export function getStyleProfileScene(styleProfileId: string): Scene | undefined {
  const profile = (BUILT_IN_STYLE_PROFILES as Record<string, StyleProfile | undefined>)[styleProfileId];
  return profile?.scene;
}

export function getDefaultSceneThreshold(scene: Scene, mode: QuestionMode): number {
  if (mode === "thorough") {
    return THOROUGH_MIN_SCENE_THRESHOLD;
  }

  return DEFAULT_FAST_SCENE_THRESHOLD_BY_SCENE[scene];
}

export function getDefaultQuestionPolicy(scene: Scene, mode: QuestionMode = "fast"): QuestionPolicy {
  return {
    mode,
    sceneThreshold: getDefaultSceneThreshold(scene, mode),
    maxQuestions: DEFAULT_MAX_QUESTIONS_BY_MODE[mode],
  };
}
