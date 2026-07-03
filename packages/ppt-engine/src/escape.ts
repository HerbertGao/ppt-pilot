// Context-aware escaping. Text escaping alone is NOT sufficient: values written
// to an HTML attribute or a CSS context need their own handling (see theme.ts
// for the CSS allowlist). These two cover the HTML text and HTML attribute
// contexts.

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function replaceEntities(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);
}

/** Escape a value written into an HTML text node (`< > & " '`). */
export function escapeText(value: unknown): string {
  return replaceEntities(value);
}

/**
 * Escape a value written into a double-quoted HTML attribute. Quotes MUST be
 * escaped here to prevent attribute-escape injection; we escape the same set as
 * text for defense in depth.
 */
export function escapeAttr(value: unknown): string {
  return replaceEntities(value);
}
