import type { Slide } from "@ppt-pilot/shared-schema";
import { escapeText } from "./escape.js";

// Deterministic thumbnail PLACEHOLDER — inline SVG as a data-uri. No headless
// browser, no rasterization, no network. Same slide always yields the same URI.

const WIDTH = 320;
const HEIGHT = 180;

/** XML-escape (same set as HTML text) — SVG is XML. */
function svgText(value: unknown): string {
  return escapeText(value);
}

function truncateTitle(title: string): string {
  return title.length > 40 ? `${title.slice(0, 39)}…` : title;
}

/** Build the raw SVG markup for a slide thumbnail placeholder. */
export function thumbnailSvg(slide: Slide): string {
  const index = Number.isFinite(slide.index) ? Math.trunc(slide.index) : 0;
  const title = truncateTitle(typeof slide.title === "string" ? slide.title : "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#e2e8f0"/>` +
    `<rect x="8" y="8" width="${WIDTH - 16}" height="${HEIGHT - 16}" fill="none" stroke="#94a3b8" stroke-width="2"/>` +
    `<text x="16" y="32" font-family="sans-serif" font-size="14" fill="#334155">Slide ${index}</text>` +
    `<text x="16" y="${HEIGHT - 16}" font-family="sans-serif" font-size="12" fill="#475569">${svgText(title)}</text>` +
    `</svg>`
  );
}

/** Deterministic data-uri thumbnail placeholder for a slide. */
export function renderThumbnail(slide: Slide): string {
  return `data:image/svg+xml,${encodeURIComponent(thumbnailSvg(slide))}`;
}
