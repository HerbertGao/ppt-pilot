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
