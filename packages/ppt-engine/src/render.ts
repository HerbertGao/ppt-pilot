import type { Element, JsonObject, Presentation, Slide, ThemeTokens } from "@ppt-pilot/shared-schema";
import { escapeAttr, escapeText } from "./escape.js";
import { styleObjectToCss, themeToCss } from "./theme.js";

// Pure functions: no I/O, no DOM runtime, no network. Deterministic output for
// a given input (object keys iterated in fixed/sorted order in theme.ts).

// Visual placeholder element types rendered as type-labeled boxes (no external
// resource requests). `text` is rendered as text; everything else is a box.
const TEXT_TYPES = new Set(["text"]);

function readString(object: JsonObject | undefined, key: string): string | undefined {
  if (object === undefined || object === null) {
    return undefined;
  }
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

/** Finite number or fallback — geometry values come from the model; guard NaN. */
function num(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function geometryCss(element: Element): string {
  const parts = [
    "position:absolute",
    `left:${num(element.x, 0)}px`,
    `top:${num(element.y, 0)}px`,
    `width:${num(element.width, 0)}px`,
    `height:${num(element.height, 0)}px`,
    `z-index:${Math.trunc(num(element.zIndex, 0))}`,
  ];
  const rotation = num(element.rotation, 0);
  if (rotation !== 0) {
    parts.push(`transform:rotate(${rotation}deg)`);
  }
  return parts.join(";");
}

function renderElement(element: Element): string {
  const geometry = geometryCss(element);
  const userStyle = styleObjectToCss(element.style);
  const style = userStyle.length > 0 ? `${geometry};${userStyle}` : geometry;
  const type = escapeAttr(element.type);
  const attrs = `class="ppt-element ppt-element--${type}" data-element-type="${type}" style="${escapeAttr(style)}"`;

  if (TEXT_TYPES.has(element.type)) {
    const text = readString(element.content, "text") ?? "";
    return `<div ${attrs}><span class="ppt-text">${escapeText(text)}</span></div>`;
  }

  // Visual placeholder box: type label + optional caption, no external resource.
  const caption = readString(element.content, "caption");
  const label = `<span class="ppt-placeholder__label">${escapeText(element.type)}</span>`;
  const captionHtml =
    caption !== undefined ? `<span class="ppt-placeholder__caption">${escapeText(caption)}</span>` : "";
  return `<div ${attrs}><div class="ppt-placeholder">${label}${captionHtml}</div></div>`;
}

// Base stylesheet for the renderer's HTML. renderSlide/renderPresentation emit
// `position:absolute` elements but ship NO CSS, so without this the elements have
// no containing block and position against the viewport. This supplies the
// 1280×720 design canvas (same coordinate space the PPTX export maps to EMU),
// the containing block, and placeholder styling — kept separate from the HTML
// output so golden fixtures stay byte-identical.
const SLIDE_BASE_CSS = `.ppt-slide {
  position: relative;
  width: 1280px;
  height: 720px;
  overflow: hidden;
  box-sizing: border-box;
}
.ppt-slide__canvas {
  position: absolute;
  inset: 0;
}
.ppt-element {
  position: absolute;
  box-sizing: border-box;
  overflow: hidden;
}
.ppt-text {
  display: block;
  width: 100%;
  height: 100%;
  color: inherit;
  font: inherit;
  line-height: 1.4;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: break-word;
}
/* Non-text elements (image/chart/diagram/shape/…) render as type-annotated
   placeholder boxes: a dashed frame + the type label the renderer already emits.
   Real media/charts are out of scope this phase. */
.ppt-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  height: 100%;
  border: 1px dashed currentColor;
  border-radius: 4px;
  opacity: 0.55;
  text-align: center;
  overflow: hidden;
}
.ppt-placeholder__label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.ppt-placeholder__caption {
  max-width: 90%;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* The materializer ALSO emits the title as a positioned .ppt-element inside the
   canvas, so this <h2> is a duplicate. Hide it visually but keep it for a11y
   (sr-only). Title duplication is a materializer quirk, out of scope here. */
.ppt-slide__title {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
/* Empty-slides fallback only (renderPresentation). */
.ppt-presentation {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ppt-presentation__title {
  font-size: 20px;
  font-weight: 700;
}
`;

/**
 * Base CSS that makes the renderer's HTML lay out correctly at the 1280×720
 * design canvas: it establishes the containing block for the `position:absolute`
 * elements (otherwise they position against the viewport) and styles the
 * type-annotated placeholder boxes. Static; inject once via a `<style>`.
 */
export function slideBaseCss(): string {
  return SLIDE_BASE_CSS;
}

/**
 * Render a single slide to an HTML fragment. `theme` is applied to the slide
 * root as inline (allowlisted, sanitized) CSS so token changes are visible.
 */
export function renderSlide(slide: Slide, theme?: ThemeTokens): string {
  const themeCss = themeToCss(theme);
  const rootStyle = themeCss.length > 0 ? ` style="${escapeAttr(themeCss)}"` : "";
  const index = Math.trunc(num(slide.index, 0));
  const elements = slide.elements
    .slice()
    .sort((a, b) => num(a.zIndex, 0) - num(b.zIndex, 0))
    .map(renderElement)
    .join("");
  return (
    `<section class="ppt-slide" data-slide-id="${escapeAttr(slide.id)}" data-slide-index="${index}"${rootStyle}>` +
    `<h2 class="ppt-slide__title">${escapeText(slide.title)}</h2>` +
    `<div class="ppt-slide__canvas">${elements}</div>` +
    `</section>`
  );
}

/**
 * Render a whole presentation to an HTML fragment: theme applied at the root,
 * every slide rendered in order.
 */
export function renderPresentation(presentation: Presentation): string {
  const theme = presentation.theme as unknown as ThemeTokens | undefined;
  const themeCss = themeToCss(theme);
  const rootStyle = themeCss.length > 0 ? ` style="${escapeAttr(themeCss)}"` : "";
  const slides = presentation.slides.map((slide) => renderSlide(slide, theme)).join("");
  return (
    `<article class="ppt-presentation" data-presentation-id="${escapeAttr(presentation.id)}"${rootStyle}>` +
    `<h1 class="ppt-presentation__title">${escapeText(presentation.title)}</h1>` +
    slides +
    `</article>`
  );
}
