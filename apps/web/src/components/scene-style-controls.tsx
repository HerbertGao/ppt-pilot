"use client";

/**
 * Scene + style-profile controls (Phase 4 §2.4), reused by project creation and
 * profile updates. Values and the "omit style -> scene default" fallback mirror
 * backend semantics: an omitted `styleProfileId` resolves to the scene's default
 * profile server-side, so the UI never forces a style choice.
 */
import {
  BUILT_IN_STYLE_PROFILES,
  SCENES,
  getDefaultStyleProfileId,
  type Scene,
} from "@ppt-pilot/shared-schema";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Sentinel Select value meaning "omit styleProfileId, use the scene default". */
const SCENE_DEFAULT = "__scene_default__";

const SCENE_LABELS: Record<Scene, string> = {
  default: "通用",
  education: "教育",
  corporate: "企业",
};

export interface SceneStyleValue {
  scene: Scene;
  /** Omitted -> backend uses the scene's default profile. */
  styleProfileId?: string | undefined;
}

export interface SceneStyleControlsProps {
  value: SceneStyleValue;
  onChange: (value: SceneStyleValue) => void;
  disabled?: boolean;
  /** Optional per-field errors (e.g. INVALID_SCENE / STYLE_PROFILE_MISMATCH). */
  sceneError?: string;
  styleError?: string;
  idPrefix?: string;
}

export function SceneStyleControls({
  value,
  onChange,
  disabled,
  sceneError,
  styleError,
  idPrefix = "scene-style",
}: SceneStyleControlsProps) {
  const styleOptions = Object.values(BUILT_IN_STYLE_PROFILES).filter(
    (profile) => profile.scene === value.scene,
  );
  const defaultProfileId = getDefaultStyleProfileId(value.scene);

  function handleScene(scene: Scene) {
    // Changing scene invalidates any scene-specific style choice: fall back to
    // the scene default (omit styleProfileId).
    onChange({ scene, styleProfileId: undefined });
  }

  function handleStyle(selected: string) {
    onChange({
      scene: value.scene,
      styleProfileId: selected === SCENE_DEFAULT ? undefined : selected,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-scene`}>场景</Label>
        <Select
          value={value.scene}
          onValueChange={(v) => handleScene(v as Scene)}
          disabled={disabled ?? false}
        >
          <SelectTrigger id={`${idPrefix}-scene`} aria-invalid={sceneError ? true : undefined}>
            <SelectValue placeholder="选择场景" />
          </SelectTrigger>
          <SelectContent>
            {SCENES.map((scene) => (
              <SelectItem key={scene} value={scene}>
                {SCENE_LABELS[scene]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sceneError ? (
          <p className="text-sm text-destructive" role="alert">
            {sceneError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-style`}>风格</Label>
        <Select
          value={value.styleProfileId ?? SCENE_DEFAULT}
          onValueChange={handleStyle}
          disabled={disabled ?? false}
        >
          <SelectTrigger id={`${idPrefix}-style`} aria-invalid={styleError ? true : undefined}>
            <SelectValue placeholder="选择风格" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SCENE_DEFAULT}>
              场景默认（{defaultProfileId}）
            </SelectItem>
            {styleOptions.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {styleError ? (
          <p className="text-sm text-destructive" role="alert">
            {styleError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
