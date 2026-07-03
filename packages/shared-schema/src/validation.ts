import {
  ACTOR_TYPES,
  ELEMENT_TYPES,
  ENTITY_NAMES,
  EVENT_TYPES,
  EXPORT_FORMATS,
  MAX_OUTLINE_SECTIONS,
  QUESTION_MODES,
  SCENES,
  SLIDE_STATUSES,
  VERSION_SCOPES,
  VISUAL_INTENTS,
  WORKFLOW_STATES,
  type ActorType,
  type ElementType,
  type EntityName,
  type EventType,
  type QuestionMode,
  type Scene,
  type SlideStatus,
  type VersionScope,
  type WorkflowState,
} from "./validation-constants.js";
import {
  DEFAULT_MAX_QUESTIONS_BY_MODE,
  THOROUGH_MIN_SCENE_THRESHOLD,
  getDefaultQuestionPolicy,
  getDefaultStyleProfileId,
  getStyleProfileScene,
} from "./profiles.js";
import type {
  Asset,
  AssetLicense,
  Element,
  Event as SchemaEvent,
  ExportArtifact,
  ImageVariantsPolicy,
  JsonObject,
  LockFields,
  NormalizedPresentation,
  NormalizedPresentationSpec,
  Outline,
  OutlineSection,
  PresentationSpec,
  QuestionPolicy,
  Slide,
  SlidePlan,
  ThemeTokens,
  Version,
} from "./types.js";

export type { EntityName } from "./validation-constants.js";
export {
  ENTITY_NAMES,
  isEntityName,
  MAX_OUTLINE_SECTIONS,
  MAX_TOTAL_SLIDE_PLANS,
} from "./validation-constants.js";

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      errors: ValidationError[];
    };

export interface EntityMap {
  PresentationSpec: NormalizedPresentationSpec;
  Presentation: NormalizedPresentation;
  Slide: Slide;
  SlidePlan: SlidePlan;
  Outline: Outline;
  Element: Element;
  Asset: Asset;
  Version: Version;
  Event: SchemaEvent;
  ThemeTokens: ThemeTokens;
  ExportArtifact: ExportArtifact;
}

export const SCHEMA_CONTRACT_VERSION = "phase-1-foundation";

export const runtimeValidationEntrypoints = {
  PresentationSpec: "validatePresentationSpec",
  Presentation: "validatePresentation",
  Slide: "validateSlide",
  SlidePlan: "validateSlidePlan",
  Outline: "validateOutline",
  Element: "validateElement",
  Asset: "validateAsset",
  Version: "validateVersion",
  Event: "validateEvent",
  ThemeTokens: "validateThemeTokens",
  ExportArtifact: "validateExportArtifact",
} as const satisfies Record<EntityName, string>;

interface ValidationDraft<T> {
  data?: T;
  errors: ValidationError[];
}

interface NumberOptions {
  integer?: boolean;
  min?: number;
  max?: number;
}

function ok<T>(data: T): ValidationResult<T> {
  return { success: true, data };
}

function fail<T>(errors: ValidationError[]): ValidationResult<T> {
  return { success: false, errors };
}

function error(errors: ValidationError[], path: string, message: string): void {
  errors.push({ path, message });
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function childPath(path: string, key: string): string {
  return `${path}.${key}`;
}

function arrayPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

function readRootObject(input: unknown, path: string, errors: ValidationError[]): JsonObject | undefined {
  if (!isJsonObject(input)) {
    error(errors, path, "must be an object");
    return undefined;
  }

  return input;
}

function readRequiredString(record: JsonObject, key: string, path: string, errors: ValidationError[]): string | undefined {
  const fieldPath = childPath(path, key);

  if (!hasOwn(record, key)) {
    error(errors, fieldPath, "is required");
    return undefined;
  }

  const value = record[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    error(errors, fieldPath, "must be a non-empty string");
    return undefined;
  }

  return value;
}

function readOptionalString(record: JsonObject, key: string, path: string, errors: ValidationError[]): string | undefined {
  if (!hasOwn(record, key) || record[key] === undefined || record[key] === null) {
    return undefined;
  }

  const fieldPath = childPath(path, key);
  const value = record[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    error(errors, fieldPath, "must be a non-empty string when provided");
    return undefined;
  }

  return value;
}

function readRequiredNullableString(
  record: JsonObject,
  key: string,
  path: string,
  errors: ValidationError[],
): string | null | undefined {
  const fieldPath = childPath(path, key);

  if (!hasOwn(record, key)) {
    error(errors, fieldPath, "is required");
    return undefined;
  }

  const value = record[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    error(errors, fieldPath, "must be null or a non-empty string");
    return undefined;
  }

  return value;
}

function readNumberValue(
  value: unknown,
  path: string,
  errors: ValidationError[],
  options: NumberOptions = {},
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    error(errors, path, "must be a finite number");
    return undefined;
  }

  if (options.integer === true && !Number.isInteger(value)) {
    error(errors, path, "must be an integer");
    return undefined;
  }

  if (options.min !== undefined && value < options.min) {
    error(errors, path, `must be >= ${options.min}`);
    return undefined;
  }

  if (options.max !== undefined && value > options.max) {
    error(errors, path, `must be <= ${options.max}`);
    return undefined;
  }

  return value;
}

function readRequiredNumber(
  record: JsonObject,
  key: string,
  path: string,
  errors: ValidationError[],
  options: NumberOptions = {},
): number | undefined {
  const fieldPath = childPath(path, key);

  if (!hasOwn(record, key)) {
    error(errors, fieldPath, "is required");
    return undefined;
  }

  return readNumberValue(record[key], fieldPath, errors, options);
}

function readOptionalNumber(
  record: JsonObject,
  key: string,
  path: string,
  errors: ValidationError[],
  options: NumberOptions = {},
): number | undefined {
  if (!hasOwn(record, key) || record[key] === undefined || record[key] === null) {
    return undefined;
  }

  return readNumberValue(record[key], childPath(path, key), errors, options);
}

function readRequiredBoolean(record: JsonObject, key: string, path: string, errors: ValidationError[]): boolean | undefined {
  const fieldPath = childPath(path, key);

  if (!hasOwn(record, key)) {
    error(errors, fieldPath, "is required");
    return undefined;
  }

  const value = record[key];

  if (typeof value !== "boolean") {
    error(errors, fieldPath, "must be a boolean");
    return undefined;
  }

  return value;
}

function readRequiredObject(record: JsonObject, key: string, path: string, errors: ValidationError[]): JsonObject | undefined {
  const fieldPath = childPath(path, key);

  if (!hasOwn(record, key)) {
    error(errors, fieldPath, "is required");
    return undefined;
  }

  if (!isJsonObject(record[key])) {
    error(errors, fieldPath, "must be an object");
    return undefined;
  }

  return record[key];
}

function readOptionalObject(record: JsonObject, key: string, path: string, errors: ValidationError[]): JsonObject | undefined {
  if (!hasOwn(record, key) || record[key] === undefined || record[key] === null) {
    return undefined;
  }

  const fieldPath = childPath(path, key);

  if (!isJsonObject(record[key])) {
    error(errors, fieldPath, "must be an object when provided");
    return undefined;
  }

  return record[key];
}

function readRequiredStringArray(
  record: JsonObject,
  key: string,
  path: string,
  errors: ValidationError[],
): string[] | undefined {
  const fieldPath = childPath(path, key);

  if (!hasOwn(record, key)) {
    error(errors, fieldPath, "is required");
    return undefined;
  }

  return readStringArrayValue(record[key], fieldPath, errors);
}

function readOptionalStringArray(
  record: JsonObject,
  key: string,
  path: string,
  errors: ValidationError[],
): string[] | undefined {
  if (!hasOwn(record, key) || record[key] === undefined || record[key] === null) {
    return undefined;
  }

  return readStringArrayValue(record[key], childPath(path, key), errors);
}

function readStringArrayValue(value: unknown, path: string, errors: ValidationError[]): string[] | undefined {
  if (!Array.isArray(value)) {
    error(errors, path, "must be an array");
    return undefined;
  }

  const result: string[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];

    if (typeof item !== "string") {
      error(errors, arrayPath(path, index), "must be a string");
    } else {
      result.push(item);
    }
  }

  return result;
}

function readOptionalArray(record: JsonObject, key: string, path: string, errors: ValidationError[]): unknown[] | undefined {
  if (!hasOwn(record, key) || record[key] === undefined || record[key] === null) {
    return undefined;
  }

  const value = record[key];

  if (!Array.isArray(value)) {
    error(errors, childPath(path, key), "must be an array when provided");
    return undefined;
  }

  return [...value];
}

function readRequiredEnum<TAllowed extends readonly string[]>(
  record: JsonObject,
  key: string,
  path: string,
  errors: ValidationError[],
  allowed: TAllowed,
): TAllowed[number] | undefined {
  const fieldPath = childPath(path, key);

  if (!hasOwn(record, key)) {
    error(errors, fieldPath, "is required");
    return undefined;
  }

  const value = record[key];

  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    error(errors, fieldPath, `must be one of: ${(allowed as readonly string[]).join(", ")}`);
    return undefined;
  }

  return value as TAllowed[number];
}

function readRequiredNullableEnum<TAllowed extends readonly string[]>(
  record: JsonObject,
  key: string,
  path: string,
  errors: ValidationError[],
  allowed: TAllowed,
): TAllowed[number] | null | undefined {
  const fieldPath = childPath(path, key);

  if (!hasOwn(record, key)) {
    error(errors, fieldPath, "is required");
    return undefined;
  }

  const value = record[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    error(errors, fieldPath, `must be null or one of: ${(allowed as readonly string[]).join(", ")}`);
    return undefined;
  }

  return value as TAllowed[number];
}

function normalizeStyleProfileId(
  rawStyleProfileId: unknown,
  scene: Scene,
  path: string,
  errors: ValidationError[],
): string | undefined {
  let styleProfileId: string;

  if (rawStyleProfileId === undefined || rawStyleProfileId === null) {
    styleProfileId = getDefaultStyleProfileId(scene);
  } else if (typeof rawStyleProfileId !== "string" || rawStyleProfileId.trim().length === 0) {
    error(errors, path, "must be a non-empty string or omitted for scene default");
    return undefined;
  } else {
    styleProfileId = rawStyleProfileId;
  }

  const profileScene = getStyleProfileScene(styleProfileId);

  if (profileScene === undefined) {
    error(errors, path, "must reference a known Phase 1 built-in style profile");
    return undefined;
  }

  if (profileScene !== scene) {
    error(errors, path, `must belong to scene "${scene}", but "${styleProfileId}" belongs to "${profileScene}"`);
    return undefined;
  }

  return styleProfileId;
}

function normalizeQuestionPolicy(
  rawQuestionPolicy: unknown,
  scene: Scene,
  path: string,
  errors: ValidationError[],
): QuestionPolicy | undefined {
  if (!isJsonObject(rawQuestionPolicy)) {
    error(errors, path, "must be an object");
    return undefined;
  }

  const mode = readRequiredEnum(rawQuestionPolicy, "mode", path, errors, QUESTION_MODES) ?? "fast";
  const maxQuestions =
    readOptionalNumber(rawQuestionPolicy, "maxQuestions", path, errors, { integer: true, min: 1 }) ??
    DEFAULT_MAX_QUESTIONS_BY_MODE[mode];
  const sceneThreshold =
    readOptionalNumber(rawQuestionPolicy, "sceneThreshold", path, errors, { min: 0, max: 1 }) ??
    getDefaultQuestionPolicy(scene, mode).sceneThreshold;

  if (mode === "thorough" && sceneThreshold < THOROUGH_MIN_SCENE_THRESHOLD) {
    error(errors, childPath(path, "sceneThreshold"), `must be >= ${THOROUGH_MIN_SCENE_THRESHOLD} for thorough mode`);
  }

  return {
    mode,
    sceneThreshold,
    maxQuestions,
  };
}

function readLockFields(record: JsonObject, path: string, errors: ValidationError[]): LockFields | undefined {
  const locked = readRequiredBoolean(record, "locked", path, errors);
  const lockedBy = readOptionalEnum(record, "lockedBy", path, errors, ACTOR_TYPES);
  const lockedAt = readOptionalString(record, "lockedAt", path, errors);
  const lockReason = readOptionalString(record, "lockReason", path, errors);

  if (locked === undefined) {
    return undefined;
  }

  const result: LockFields = { locked };

  if (lockedBy !== undefined) {
    result.lockedBy = lockedBy;
  }

  if (lockedAt !== undefined) {
    result.lockedAt = lockedAt;
  }

  if (lockReason !== undefined) {
    result.lockReason = lockReason;
  }

  return result;
}

function readOptionalEnum<TAllowed extends readonly string[]>(
  record: JsonObject,
  key: string,
  path: string,
  errors: ValidationError[],
  allowed: TAllowed,
): TAllowed[number] | undefined {
  if (!hasOwn(record, key) || record[key] === undefined || record[key] === null) {
    return undefined;
  }

  const fieldPath = childPath(path, key);
  const value = record[key];

  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    error(errors, fieldPath, `must be one of: ${(allowed as readonly string[]).join(", ")}`);
    return undefined;
  }

  return value as TAllowed[number];
}

function validatePresentationSpecAt(input: unknown, path: string): ValidationDraft<NormalizedPresentationSpec> {
  const errors: ValidationError[] = [];
  const record = readRootObject(input, path, errors);

  if (record === undefined) {
    return { errors };
  }

  const id = readOptionalString(record, "id", path, errors);
  const topic = readRequiredString(record, "topic", path, errors);
  const audience = readRequiredString(record, "audience", path, errors);
  const purpose = readRequiredString(record, "purpose", path, errors);
  const durationMinutes = readOptionalNumber(record, "durationMinutes", path, errors, { min: 1 });
  const slideCountTarget = readOptionalNumber(record, "slideCountTarget", path, errors, { integer: true, min: 1 });
  const language = readRequiredString(record, "language", path, errors);
  const tone = readOptionalString(record, "tone", path, errors);
  const scene = readRequiredEnum(record, "scene", path, errors, SCENES) ?? "default";
  const styleProfileId = normalizeStyleProfileId(record.styleProfileId, scene, childPath(path, "styleProfileId"), errors);
  const questionPolicy = normalizeQuestionPolicy(record.questionPolicy, scene, childPath(path, "questionPolicy"), errors);
  const riskNotes = readOptionalStringArray(record, "riskNotes", path, errors);
  const style = readOptionalObject(record, "style", path, errors);
  const constraints = readOptionalStringArray(record, "constraints", path, errors);
  const sourceMaterials = readOptionalArray(record, "sourceMaterials", path, errors);
  const confirmedByUser = readRequiredBoolean(record, "confirmedByUser", path, errors);

  if (
    errors.length > 0 ||
    topic === undefined ||
    audience === undefined ||
    purpose === undefined ||
    language === undefined ||
    styleProfileId === undefined ||
    questionPolicy === undefined ||
    confirmedByUser === undefined
  ) {
    return { errors };
  }

  const spec: NormalizedPresentationSpec = {
    topic,
    audience,
    purpose,
    language,
    scene,
    styleProfileId,
    questionPolicy,
    confirmedByUser,
  };

  if (id !== undefined) {
    spec.id = id;
  }

  if (durationMinutes !== undefined) {
    spec.durationMinutes = durationMinutes;
  }

  if (slideCountTarget !== undefined) {
    spec.slideCountTarget = slideCountTarget;
  }

  if (tone !== undefined) {
    spec.tone = tone;
  }

  if (riskNotes !== undefined) {
    spec.riskNotes = riskNotes;
  }

  if (style !== undefined) {
    spec.style = style;
  }

  if (constraints !== undefined) {
    spec.constraints = constraints;
  }

  if (sourceMaterials !== undefined) {
    spec.sourceMaterials = sourceMaterials;
  }

  return { data: spec, errors };
}

function validateSlidePlanAt(input: unknown, path: string): ValidationDraft<SlidePlan> {
  const errors: ValidationError[] = [];
  const record = readRootObject(input, path, errors);

  if (record === undefined) {
    return { errors };
  }

  const id = readOptionalString(record, "id", path, errors);
  const slideId = readOptionalString(record, "slideId", path, errors);
  const title = readOptionalString(record, "title", path, errors);
  const objective = readRequiredString(record, "objective", path, errors);
  const keyMessage = readRequiredString(record, "keyMessage", path, errors);
  const contentIntent = readRequiredString(record, "contentIntent", path, errors);
  const visualIntent = readRequiredEnum(record, "visualIntent", path, errors, VISUAL_INTENTS);
  const layoutSuggestion = readRequiredString(record, "layoutSuggestion", path, errors);
  const requiredAssets = readRequiredStringArray(record, "requiredAssets", path, errors);
  const riskNotes = readRequiredStringArray(record, "riskNotes", path, errors);

  if (
    errors.length > 0 ||
    objective === undefined ||
    keyMessage === undefined ||
    contentIntent === undefined ||
    visualIntent === undefined ||
    layoutSuggestion === undefined ||
    requiredAssets === undefined ||
    riskNotes === undefined
  ) {
    return { errors };
  }

  const slidePlan: SlidePlan = {
    objective,
    keyMessage,
    contentIntent,
    visualIntent,
    layoutSuggestion,
    requiredAssets,
    riskNotes,
  };

  if (id !== undefined) {
    slidePlan.id = id;
  }

  if (slideId !== undefined) {
    slidePlan.slideId = slideId;
  }

  if (title !== undefined) {
    slidePlan.title = title;
  }

  return { data: slidePlan, errors };
}

function validateOutlineSectionAt(input: unknown, path: string): ValidationDraft<OutlineSection> {
  const errors: ValidationError[] = [];
  const record = readRootObject(input, path, errors);

  if (record === undefined) {
    return { errors };
  }

  const title = readRequiredString(record, "title", path, errors);
  const purpose = readRequiredString(record, "purpose", path, errors);
  const estimatedSlides = readRequiredNumber(record, "estimatedSlides", path, errors, { integer: true, min: 1 });

  if (errors.length > 0 || title === undefined || purpose === undefined || estimatedSlides === undefined) {
    return { errors };
  }

  return { data: { title, purpose, estimatedSlides }, errors };
}

function readOutlineSections(input: unknown, path: string, errors: ValidationError[]): OutlineSection[] | undefined {
  if (!Array.isArray(input)) {
    error(errors, path, "must be an array");
    return undefined;
  }

  if (input.length < 1) {
    error(errors, path, "must contain at least one section");
  }

  if (input.length > MAX_OUTLINE_SECTIONS) {
    error(errors, path, `must contain at most ${MAX_OUTLINE_SECTIONS} sections`);
  }

  const sections: OutlineSection[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const result = validateOutlineSectionAt(input[index], arrayPath(path, index));
    errors.push(...result.errors);

    if (result.data !== undefined) {
      sections.push(result.data);
    }
  }

  return sections;
}

function validateOutlineAt(input: unknown, path: string): ValidationDraft<Outline> {
  const errors: ValidationError[] = [];
  const record = readRootObject(input, path, errors);

  if (record === undefined) {
    return { errors };
  }

  const id = readOptionalString(record, "id", path, errors);
  const sections = readOutlineSections(record.sections, childPath(path, "sections"), errors);
  const confirmedByUser = readRequiredBoolean(record, "confirmedByUser", path, errors);
  const riskNotes = readOptionalStringArray(record, "riskNotes", path, errors);

  if (errors.length > 0 || sections === undefined || confirmedByUser === undefined) {
    return { errors };
  }

  const outline: Outline = { sections, confirmedByUser };

  if (id !== undefined) {
    outline.id = id;
  }

  if (riskNotes !== undefined) {
    outline.riskNotes = riskNotes;
  }

  return { data: outline, errors };
}

function validateAssetAt(input: unknown, path: string): ValidationDraft<Asset> {
  const errors: ValidationError[] = [];
  const record = readRootObject(input, path, errors);

  if (record === undefined) {
    return { errors };
  }

  const id = readRequiredString(record, "id", path, errors);
  const type = readRequiredString(record, "type", path, errors);
  const source = readRequiredString(record, "source", path, errors);
  const url = readOptionalString(record, "url", path, errors);
  const prompt = readOptionalString(record, "prompt", path, errors);
  const metadata = readRequiredObject(record, "metadata", path, errors);
  const license = readAssetLicense(record.license, childPath(path, "license"), errors);

  if (errors.length > 0 || id === undefined || type === undefined || source === undefined || metadata === undefined) {
    return { errors };
  }

  const asset: Asset = {
    id,
    type,
    source,
    metadata,
  };

  if (url !== undefined) {
    asset.url = url;
  }

  if (prompt !== undefined) {
    asset.prompt = prompt;
  }

  if (license !== undefined) {
    asset.license = license;
  }

  return { data: asset, errors };
}

function readAssetLicense(input: unknown, path: string, errors: ValidationError[]): AssetLicense | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  if (!isJsonObject(input)) {
    error(errors, path, "must be an object when provided");
    return undefined;
  }

  const name = readOptionalString(input, "name", path, errors);
  const url = readOptionalString(input, "url", path, errors);
  const attributionRequired = readRequiredBoolean(input, "attributionRequired", path, errors);

  if (attributionRequired === undefined) {
    return undefined;
  }

  const license: AssetLicense = { attributionRequired };

  if (name !== undefined) {
    license.name = name;
  }

  if (url !== undefined) {
    license.url = url;
  }

  return license;
}

function validateElementAt(input: unknown, path: string): ValidationDraft<Element> {
  const errors: ValidationError[] = [];
  const record = readRootObject(input, path, errors);

  if (record === undefined) {
    return { errors };
  }

  const id = readRequiredString(record, "id", path, errors);
  const slideId = readRequiredString(record, "slideId", path, errors);
  const type = readRequiredEnum(record, "type", path, errors, ELEMENT_TYPES);
  const content = readRequiredObject(record, "content", path, errors);
  const imageVariantsPolicy = readImageVariantsPolicy(record.imageVariantsPolicy, childPath(path, "imageVariantsPolicy"), errors);
  const x = readRequiredNumber(record, "x", path, errors);
  const y = readRequiredNumber(record, "y", path, errors);
  const width = readRequiredNumber(record, "width", path, errors, { min: 0 });
  const height = readRequiredNumber(record, "height", path, errors, { min: 0 });
  const rotation = readRequiredNumber(record, "rotation", path, errors);
  const zIndex = readRequiredNumber(record, "zIndex", path, errors, { integer: true });
  const style = readRequiredObject(record, "style", path, errors);
  const metadata = readRequiredObject(record, "metadata", path, errors);
  const lockFields = readLockFields(record, path, errors);

  if (type === "image" && content !== undefined) {
    const assetId = content.assetId;

    if (typeof assetId !== "string" || assetId.trim().length === 0) {
      error(errors, childPath(childPath(path, "content"), "assetId"), "is required for image elements");
    }
  }

  if (
    errors.length > 0 ||
    id === undefined ||
    slideId === undefined ||
    type === undefined ||
    content === undefined ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    rotation === undefined ||
    zIndex === undefined ||
    style === undefined ||
    metadata === undefined ||
    lockFields === undefined
  ) {
    return { errors };
  }

  const element: Element = {
    id,
    slideId,
    type,
    content,
    x,
    y,
    width,
    height,
    rotation,
    zIndex,
    style,
    locked: lockFields.locked,
    metadata,
  };

  if (imageVariantsPolicy !== undefined) {
    element.imageVariantsPolicy = imageVariantsPolicy;
  }

  if (lockFields.lockedBy !== undefined) {
    element.lockedBy = lockFields.lockedBy;
  }

  if (lockFields.lockedAt !== undefined) {
    element.lockedAt = lockFields.lockedAt;
  }

  if (lockFields.lockReason !== undefined) {
    element.lockReason = lockFields.lockReason;
  }

  return { data: element, errors };
}

function readImageVariantsPolicy(
  input: unknown,
  path: string,
  errors: ValidationError[],
): ImageVariantsPolicy | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  if (!isJsonObject(input)) {
    error(errors, path, "must be an object when provided");
    return undefined;
  }

  const count = readRequiredNumber(input, "count", path, errors, { integer: true, min: 1 });
  const selectedAssetId = readOptionalString(input, "selectedAssetId", path, errors);

  if (count === undefined) {
    return undefined;
  }

  const policy: ImageVariantsPolicy = { count };

  if (selectedAssetId !== undefined) {
    policy.selectedAssetId = selectedAssetId;
  }

  return policy;
}

function validateSlideAt(input: unknown, path: string): ValidationDraft<Slide> {
  const errors: ValidationError[] = [];
  const record = readRootObject(input, path, errors);

  if (record === undefined) {
    return { errors };
  }

  const id = readRequiredString(record, "id", path, errors);
  const presentationId = readRequiredString(record, "presentationId", path, errors);
  const index = readRequiredNumber(record, "index", path, errors, { integer: true, min: 1 });
  const title = readRequiredString(record, "title", path, errors);
  const status = readRequiredEnum(record, "status", path, errors, SLIDE_STATUSES);
  const planResult = validateSlidePlanAt(record.plan, childPath(path, "plan"));
  errors.push(...planResult.errors);
  const elements = readElementArray(record.elements, childPath(path, "elements"), errors);
  const notes = readOptionalString(record, "notes", path, errors);
  const createdAt = readRequiredString(record, "createdAt", path, errors);
  const updatedAt = readRequiredString(record, "updatedAt", path, errors);
  const lockFields = readLockFields(record, path, errors);

  if (id !== undefined && planResult.data?.slideId !== undefined && planResult.data.slideId !== id) {
    error(errors, childPath(childPath(path, "plan"), "slideId"), `must reference slide "${id}"`);
  }

  if (id !== undefined && elements !== undefined) {
    for (let indexInArray = 0; indexInArray < elements.length; indexInArray += 1) {
      const element = elements[indexInArray];

      if (element !== undefined && element.slideId !== id) {
        error(errors, childPath(arrayPath(childPath(path, "elements"), indexInArray), "slideId"), `must reference slide "${id}"`);
      }
    }
  }

  if (
    errors.length > 0 ||
    id === undefined ||
    presentationId === undefined ||
    index === undefined ||
    title === undefined ||
    status === undefined ||
    planResult.data === undefined ||
    elements === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    lockFields === undefined
  ) {
    return { errors };
  }

  const slide: Slide = {
    id,
    presentationId,
    index,
    title,
    status,
    locked: lockFields.locked,
    plan: planResult.data,
    elements,
    createdAt,
    updatedAt,
  };

  if (notes !== undefined) {
    slide.notes = notes;
  }

  if (lockFields.lockedBy !== undefined) {
    slide.lockedBy = lockFields.lockedBy;
  }

  if (lockFields.lockedAt !== undefined) {
    slide.lockedAt = lockFields.lockedAt;
  }

  if (lockFields.lockReason !== undefined) {
    slide.lockReason = lockFields.lockReason;
  }

  return { data: slide, errors };
}

function readElementArray(input: unknown, path: string, errors: ValidationError[]): Element[] | undefined {
  if (!Array.isArray(input)) {
    error(errors, path, "must be an array");
    return undefined;
  }

  const elements: Element[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const result = validateElementAt(input[index], arrayPath(path, index));
    errors.push(...result.errors);

    if (result.data !== undefined) {
      elements.push(result.data);
    }
  }

  return elements;
}

function validatePresentationAt(input: unknown, path: string): ValidationDraft<NormalizedPresentation> {
  const errors: ValidationError[] = [];
  const record = readRootObject(input, path, errors);

  if (record === undefined) {
    return { errors };
  }

  const id = readRequiredString(record, "id", path, errors);
  const projectId = readRequiredString(record, "projectId", path, errors);
  const title = readRequiredString(record, "title", path, errors);
  const specResult = validatePresentationSpecAt(record.spec, childPath(path, "spec"));
  errors.push(...specResult.errors);
  const theme = readRequiredObject(record, "theme", path, errors);
  const scene = readRequiredEnum(record, "scene", path, errors, SCENES) ?? specResult.data?.scene ?? "default";
  const styleProfileId = normalizeStyleProfileId(record.styleProfileId, scene, childPath(path, "styleProfileId"), errors);
  const assets = readAssetArray(record.assets, childPath(path, "assets"), errors);
  const slides = readSlideArray(record.slides, childPath(path, "slides"), errors);
  const createdAt = readRequiredString(record, "createdAt", path, errors);
  const updatedAt = readRequiredString(record, "updatedAt", path, errors);

  if (specResult.data !== undefined && scene !== specResult.data.scene) {
    error(errors, childPath(path, "scene"), `must match spec.scene "${specResult.data.scene}"`);
  }

  if (id !== undefined && slides !== undefined) {
    for (let index = 0; index < slides.length; index += 1) {
      const slide = slides[index];

      if (slide !== undefined && slide.presentationId !== id) {
        error(errors, childPath(arrayPath(childPath(path, "slides"), index), "presentationId"), `must reference presentation "${id}"`);
      }
    }
  }

  if (slides !== undefined) {
    const assetIds = new Set((assets ?? []).map((asset) => asset.id));

    for (let slideIndex = 0; slideIndex < slides.length; slideIndex += 1) {
      const slide = slides[slideIndex];

      if (slide === undefined) {
        continue;
      }

      for (const [assetIndex, assetId] of slide.plan.requiredAssets.entries()) {
        if (!assetIds.has(assetId)) {
          error(
            errors,
            arrayPath(childPath(childPath(arrayPath(childPath(path, "slides"), slideIndex), "plan"), "requiredAssets"), assetIndex),
            `must reference an asset in $.assets; missing "${assetId}"`,
          );
        }
      }

      for (let elementIndex = 0; elementIndex < slide.elements.length; elementIndex += 1) {
        const element = slide.elements[elementIndex];

        if (element?.type !== "image") {
          continue;
        }

        const assetId = element.content.assetId;

        if (typeof assetId === "string" && !assetIds.has(assetId)) {
          error(
            errors,
            childPath(
              childPath(arrayPath(childPath(arrayPath(childPath(path, "slides"), slideIndex), "elements"), elementIndex), "content"),
              "assetId",
            ),
            `must reference an asset in $.assets; missing "${assetId}"`,
          );
        }
      }
    }
  }

  if (
    errors.length > 0 ||
    id === undefined ||
    projectId === undefined ||
    title === undefined ||
    specResult.data === undefined ||
    theme === undefined ||
    styleProfileId === undefined ||
    slides === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return { errors };
  }

  const presentation: NormalizedPresentation = {
    id,
    projectId,
    title,
    spec: specResult.data,
    theme,
    scene,
    styleProfileId,
    slides,
    createdAt,
    updatedAt,
  };

  if (assets !== undefined) {
    presentation.assets = assets;
  }

  return { data: presentation, errors };
}

function readAssetArray(input: unknown, path: string, errors: ValidationError[]): Asset[] | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  if (!Array.isArray(input)) {
    error(errors, path, "must be an array when provided");
    return undefined;
  }

  const assets: Asset[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const result = validateAssetAt(input[index], arrayPath(path, index));
    errors.push(...result.errors);

    if (result.data !== undefined) {
      assets.push(result.data);
    }
  }

  return assets;
}

function readSlideArray(input: unknown, path: string, errors: ValidationError[]): Slide[] | undefined {
  if (!Array.isArray(input)) {
    error(errors, path, "must be an array");
    return undefined;
  }

  const slides: Slide[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const result = validateSlideAt(input[index], arrayPath(path, index));
    errors.push(...result.errors);

    if (result.data !== undefined) {
      slides.push(result.data);
    }
  }

  return slides;
}

function validateVersionAt(input: unknown, path: string): ValidationDraft<Version> {
  const errors: ValidationError[] = [];
  const record = readRootObject(input, path, errors);

  if (record === undefined) {
    return { errors };
  }

  const id = readRequiredString(record, "id", path, errors);
  const projectId = readRequiredString(record, "projectId", path, errors);
  const scope = readRequiredEnum(record, "scope", path, errors, VERSION_SCOPES);
  const targetId = readRequiredString(record, "targetId", path, errors);
  const parentVersionId = readRequiredNullableString(record, "parentVersionId", path, errors);
  const snapshot = readRequiredObject(record, "snapshot", path, errors);
  const diff = readRequiredObject(record, "diff", path, errors);
  const createdBy = readRequiredEnum(record, "createdBy", path, errors, ACTOR_TYPES);
  const createdAt = readRequiredString(record, "createdAt", path, errors);

  if (
    errors.length > 0 ||
    id === undefined ||
    projectId === undefined ||
    scope === undefined ||
    targetId === undefined ||
    parentVersionId === undefined ||
    snapshot === undefined ||
    diff === undefined ||
    createdBy === undefined ||
    createdAt === undefined
  ) {
    return { errors };
  }

  return {
    data: {
      id,
      projectId,
      scope,
      targetId,
      parentVersionId,
      snapshot,
      diff,
      createdBy,
      createdAt,
    },
    errors,
  };
}

function readThemeTokenGroup(
  record: JsonObject,
  key: string,
  path: string,
  errors: ValidationError[],
  valueKind: "string" | "spacing",
): Record<string, number | string> | undefined {
  const group = readRequiredObject(record, key, path, errors);

  if (group === undefined) {
    return undefined;
  }

  const groupPath = childPath(path, key);
  const keys = Object.keys(group);

  if (keys.length === 0) {
    error(errors, groupPath, "must contain at least one named token");
    return undefined;
  }

  const result: Record<string, number | string> = {};
  let groupOk = true;

  for (const tokenKey of keys) {
    const value = group[tokenKey];
    const valuePath = childPath(groupPath, tokenKey);

    if (valueKind === "string") {
      if (typeof value !== "string" || value.trim().length === 0) {
        error(errors, valuePath, "must be a non-empty string");
        groupOk = false;
        continue;
      }
      result[tokenKey] = value;
    } else {
      if (typeof value === "string") {
        if (value.trim().length === 0) {
          error(errors, valuePath, "must be a non-empty string or finite number");
          groupOk = false;
          continue;
        }
        result[tokenKey] = value;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        result[tokenKey] = value;
      } else {
        error(errors, valuePath, "must be a non-empty string or finite number");
        groupOk = false;
      }
    }
  }

  return groupOk ? result : undefined;
}

function validateThemeTokensAt(input: unknown, path: string): ValidationDraft<ThemeTokens> {
  const errors: ValidationError[] = [];
  const record = readRootObject(input, path, errors);

  if (record === undefined) {
    return { errors };
  }

  const palette = readThemeTokenGroup(record, "palette", path, errors, "string");
  const fonts = readThemeTokenGroup(record, "fonts", path, errors, "string");
  const spacing = readThemeTokenGroup(record, "spacing", path, errors, "spacing");

  if (errors.length > 0 || palette === undefined || fonts === undefined || spacing === undefined) {
    return { errors };
  }

  return {
    data: {
      palette: palette as Record<string, string>,
      fonts: fonts as Record<string, string>,
      spacing,
    },
    errors,
  };
}

// Structural base64 charset check only — the validator never decodes bytes.
// byteSize == decoded length is a service-side invariant (service sets byteSize
// and bytesBase64 from the same bytes), asserted by export tests, not here.
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function validateExportArtifactAt(input: unknown, path: string): ValidationDraft<ExportArtifact> {
  const errors: ValidationError[] = [];
  const record = readRootObject(input, path, errors);

  if (record === undefined) {
    return { errors };
  }

  const id = readRequiredString(record, "id", path, errors);
  const projectId = readRequiredString(record, "projectId", path, errors);
  const format = readRequiredEnum(record, "format", path, errors, EXPORT_FORMATS);
  const bytesBase64 = readRequiredString(record, "bytesBase64", path, errors);
  const byteSize = readRequiredNumber(record, "byteSize", path, errors, { integer: true, min: 1 });
  const sourcePresentationId = readRequiredString(record, "sourcePresentationId", path, errors);
  const createdBy = readRequiredEnum(record, "createdBy", path, errors, ACTOR_TYPES);
  const createdAt = readRequiredString(record, "createdAt", path, errors);

  if (bytesBase64 !== undefined && !BASE64_PATTERN.test(bytesBase64)) {
    error(errors, childPath(path, "bytesBase64"), "must match the base64 character set");
  }

  if (
    errors.length > 0 ||
    id === undefined ||
    projectId === undefined ||
    format === undefined ||
    bytesBase64 === undefined ||
    byteSize === undefined ||
    sourcePresentationId === undefined ||
    createdBy === undefined ||
    createdAt === undefined
  ) {
    return { errors };
  }

  return {
    data: {
      id,
      projectId,
      format,
      bytesBase64,
      byteSize,
      sourcePresentationId,
      createdBy,
      createdAt,
    },
    errors,
  };
}

function validateEventAt(input: unknown, path: string): ValidationDraft<SchemaEvent> {
  const errors: ValidationError[] = [];
  const record = readRootObject(input, path, errors);

  if (record === undefined) {
    return { errors };
  }

  const id = readRequiredString(record, "id", path, errors);
  const projectId = readRequiredString(record, "projectId", path, errors);
  const type = readRequiredEnum(record, "type", path, errors, EVENT_TYPES);
  const actor = readRequiredEnum(record, "actor", path, errors, ACTOR_TYPES);
  const payload = readRequiredObject(record, "payload", path, errors);
  const createdAt = readRequiredString(record, "createdAt", path, errors);

  if (type !== undefined && payload !== undefined) {
    validateEventPayload(type, payload, childPath(path, "payload"), errors);
  }

  if (
    errors.length > 0 ||
    id === undefined ||
    projectId === undefined ||
    type === undefined ||
    actor === undefined ||
    payload === undefined ||
    createdAt === undefined
  ) {
    return { errors };
  }

  return {
    data: {
      id,
      projectId,
      type,
      actor,
      payload,
      createdAt,
    },
    errors,
  };
}

function validateEventPayload(type: EventType, payload: JsonObject, path: string, errors: ValidationError[]): void {
  switch (type) {
    case "SCENE_STYLE_PROFILE_UPDATED": {
      readRequiredNullableEnum(payload, "previousScene", path, errors, SCENES);
      readRequiredNullableString(payload, "previousStyleProfileId", path, errors);
      const scene = readRequiredEnum(payload, "scene", path, errors, SCENES);
      const styleProfileId = readRequiredString(payload, "styleProfileId", path, errors);

      if (scene !== undefined && styleProfileId !== undefined) {
        normalizeStyleProfileId(styleProfileId, scene, childPath(path, "styleProfileId"), errors);
      }

      break;
    }
    case "QUESTION_POLICY_APPLIED": {
      const mode = readRequiredEnum(payload, "mode", path, errors, QUESTION_MODES);
      const sceneThreshold = readRequiredNumber(payload, "sceneThreshold", path, errors, { min: 0, max: 1 });
      readRequiredNumber(payload, "maxQuestions", path, errors, { integer: true, min: 1 });
      readRequiredNumber(payload, "confidence", path, errors, { min: 0, max: 1 });
      readRequiredBoolean(payload, "thresholdReached", path, errors);
      if (mode === "thorough" && sceneThreshold !== undefined && sceneThreshold < THOROUGH_MIN_SCENE_THRESHOLD) {
        error(errors, childPath(path, "sceneThreshold"), `must be >= ${THOROUGH_MIN_SCENE_THRESHOLD} for thorough mode`);
      }
      break;
    }
    case "REQUIREMENT_QUESTION_ASKED": {
      readRequiredString(payload, "questionId", path, errors);
      readRequiredString(payload, "prompt", path, errors);
      readRequiredString(payload, "kind", path, errors);
      readRequiredStringArray(payload, "options", path, errors);
      readRequiredNumber(payload, "confidenceBefore", path, errors, { min: 0, max: 1 });
      break;
    }
    case "REQUIREMENT_QUESTION_SKIPPED": {
      readRequiredString(payload, "questionId", path, errors);
      readRequiredString(payload, "reason", path, errors);
      readRequiredNumber(payload, "confidenceAfter", path, errors, { min: 0, max: 1 });
      readRequiredString(payload, "riskNote", path, errors);
      break;
    }
    case "PRESENTATION_SPEC_CONFIRMED": {
      readRequiredString(payload, "presentationSpecId", path, errors);
      const scene = readRequiredEnum(payload, "scene", path, errors, SCENES);
      const styleProfileId = readRequiredString(payload, "styleProfileId", path, errors);
      readRequiredStringArray(payload, "riskNotes", path, errors);
      readRequiredEnum(payload, "nextState", path, errors, WORKFLOW_STATES);

      if (scene !== undefined && styleProfileId !== undefined) {
        normalizeStyleProfileId(styleProfileId, scene, childPath(path, "styleProfileId"), errors);
      }

      if (scene !== undefined) {
        normalizeQuestionPolicy(payload.questionPolicy, scene, childPath(path, "questionPolicy"), errors);
      }

      break;
    }
    case "WORKFLOW_STATE_CHANGED": {
      readRequiredEnum(payload, "previousState", path, errors, WORKFLOW_STATES);
      readRequiredEnum(payload, "nextState", path, errors, WORKFLOW_STATES);
      break;
    }
    case "OUTLINE_GENERATED":
    case "OUTLINE_UPDATED":
    case "OUTLINE_CONFIRMED": {
      readRequiredNumber(payload, "sectionCount", path, errors, { integer: true, min: 1 });
      readRequiredEnum(payload, "nextState", path, errors, WORKFLOW_STATES);
      break;
    }
    case "SLIDE_PLAN_GENERATED": {
      const slideCount = readRequiredNumber(payload, "slideCount", path, errors, {
        integer: true,
        min: 1,
      });
      const slideIds = readRequiredStringArray(payload, "slideIds", path, errors);
      if (slideCount !== undefined && slideIds !== undefined && slideCount !== slideIds.length) {
        error(errors, path, `slideCount ${slideCount} must equal slideIds.length ${slideIds.length}`);
      }
      readRequiredEnum(payload, "nextState", path, errors, WORKFLOW_STATES);
      break;
    }
    case "SLIDE_PLAN_UPDATED": {
      readRequiredString(payload, "slideId", path, errors);
      readRequiredEnum(payload, "nextState", path, errors, WORKFLOW_STATES);
      break;
    }
    case "SLIDE_PLAN_CONFIRMED": {
      readRequiredNumber(payload, "slideCount", path, errors, { integer: true, min: 1 });
      readRequiredEnum(payload, "nextState", path, errors, WORKFLOW_STATES);
      break;
    }
    case "SLIDES_MATERIALIZED": {
      readRequiredNumber(payload, "slideCount", path, errors, { integer: true, min: 1 });
      readRequiredEnum(payload, "nextState", path, errors, WORKFLOW_STATES);
      break;
    }
    case "PRESENTATION_EXPORTED": {
      readRequiredString(payload, "artifactId", path, errors);
      readRequiredEnum(payload, "format", path, errors, EXPORT_FORMATS);
      readRequiredNumber(payload, "byteSize", path, errors, { integer: true, min: 1 });
      readRequiredEnum(payload, "nextState", path, errors, WORKFLOW_STATES);
      break;
    }
    default: {
      // fail-closed: any EVENT_TYPE without an explicit payload case must fail,
      // so adding a type to EVENT_TYPES without a case surfaces in tests.
      error(errors, path, `has no payload validation case for event type "${String(type)}"`);
      break;
    }
  }
}

export function validatePresentationSpec(input: unknown): ValidationResult<NormalizedPresentationSpec> {
  const result = validatePresentationSpecAt(input, "$");
  return result.data !== undefined && result.errors.length === 0 ? ok(result.data) : fail(result.errors);
}

export function validatePresentation(input: unknown): ValidationResult<NormalizedPresentation> {
  const result = validatePresentationAt(input, "$");
  return result.data !== undefined && result.errors.length === 0 ? ok(result.data) : fail(result.errors);
}

export function validateSlide(input: unknown): ValidationResult<Slide> {
  const result = validateSlideAt(input, "$");
  return result.data !== undefined && result.errors.length === 0 ? ok(result.data) : fail(result.errors);
}

export function validateSlidePlan(input: unknown): ValidationResult<SlidePlan> {
  const result = validateSlidePlanAt(input, "$");
  return result.data !== undefined && result.errors.length === 0 ? ok(result.data) : fail(result.errors);
}

export function validateOutline(input: unknown): ValidationResult<Outline> {
  const result = validateOutlineAt(input, "$");
  return result.data !== undefined && result.errors.length === 0 ? ok(result.data) : fail(result.errors);
}

export function validateElement(input: unknown): ValidationResult<Element> {
  const result = validateElementAt(input, "$");
  return result.data !== undefined && result.errors.length === 0 ? ok(result.data) : fail(result.errors);
}

export function validateAsset(input: unknown): ValidationResult<Asset> {
  const result = validateAssetAt(input, "$");
  return result.data !== undefined && result.errors.length === 0 ? ok(result.data) : fail(result.errors);
}

export function validateVersion(input: unknown): ValidationResult<Version> {
  const result = validateVersionAt(input, "$");
  return result.data !== undefined && result.errors.length === 0 ? ok(result.data) : fail(result.errors);
}

export function validateEvent(input: unknown): ValidationResult<SchemaEvent> {
  const result = validateEventAt(input, "$");
  return result.data !== undefined && result.errors.length === 0 ? ok(result.data) : fail(result.errors);
}

export function validateThemeTokens(input: unknown): ValidationResult<ThemeTokens> {
  const result = validateThemeTokensAt(input, "$");
  return result.data !== undefined && result.errors.length === 0 ? ok(result.data) : fail(result.errors);
}

export function validateExportArtifact(input: unknown): ValidationResult<ExportArtifact> {
  const result = validateExportArtifactAt(input, "$");
  return result.data !== undefined && result.errors.length === 0 ? ok(result.data) : fail(result.errors);
}

export function validateEntity<K extends EntityName>(entityName: K, input: unknown): ValidationResult<EntityMap[K]>;
export function validateEntity(entityName: string, input: unknown): ValidationResult<unknown>;
export function validateEntity(entityName: string, input: unknown): ValidationResult<unknown> {
  switch (entityName) {
    case "PresentationSpec":
      return validatePresentationSpec(input);
    case "Presentation":
      return validatePresentation(input);
    case "Slide":
      return validateSlide(input);
    case "SlidePlan":
      return validateSlidePlan(input);
    case "Outline":
      return validateOutline(input);
    case "Element":
      return validateElement(input);
    case "Asset":
      return validateAsset(input);
    case "Version":
      return validateVersion(input);
    case "Event":
      return validateEvent(input);
    case "ThemeTokens":
      return validateThemeTokens(input);
    case "ExportArtifact":
      return validateExportArtifact(input);
    default:
      return fail([
        {
          path: "$.entity",
          message: `must be one of: ${ENTITY_NAMES.join(", ")}`,
        },
      ]);
  }
}
