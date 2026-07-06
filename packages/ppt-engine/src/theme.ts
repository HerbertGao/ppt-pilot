import type { JsonObject, ThemeTokens } from "@ppt-pilot/shared-schema";

// CSS trust boundary. We never pass arbitrary CSS through: only allowlisted
// properties survive, and every value is sanitized against injection
// constructs (expression(), url(), </style>, braces, etc.). Object keys are
// iterated in DETERMINISTIC (sorted) order so rendered output is stable and
// golden fixtures do not drift.

/** Properties allowed from `element.style`. Kebab-case, matched after camel→kebab normalization. */
const STYLE_PROPERTY_ALLOWLIST = new Set<string>([
  "color",
  "background-color",
  "background",
  "border",
  "border-color",
  "border-width",
  "border-style",
  "border-radius",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-align",
  "text-decoration",
  "line-height",
  "letter-spacing",
  "padding",
  "margin",
  "opacity",
]);

// Any value containing one of these is rejected outright (dropped, not partially
// stripped) — partial stripping is where bypasses hide.
const DANGEROUS_VALUE =
  /expression|url\s*\(|image-set|cross-fade|image\s*\(|element\s*\(|javascript:|@import|[<>{}\\;]/i;

/** camelCase / PascalCase → kebab-case; leave already-kebab keys untouched. */
function toKebabCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** Returns a safe CSS value string, or null if the value must be dropped. */
export function sanitizeCssValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const text = String(value).trim();
  if (text.length === 0 || DANGEROUS_VALUE.test(text)) {
    return null;
  }
  return text;
}

interface Declaration {
  property: string;
  value: string;
}

/** Sort declarations by property name for deterministic output. */
function serializeDeclarations(declarations: Declaration[]): string {
  return declarations
    .slice()
    .sort((a, b) => (a.property < b.property ? -1 : a.property > b.property ? 1 : 0))
    .map((decl) => `${decl.property}:${decl.value}`)
    .join(";");
}

/**
 * Map an `element.style` object to a CSS declaration string via the property
 * allowlist + value sanitization. Non-allowlisted properties and dangerous
 * values are dropped. Deterministic (sorted) output.
 */
export function styleObjectToCss(style: JsonObject | undefined): string {
  if (style === undefined || style === null) {
    return "";
  }
  const declarations: Declaration[] = [];
  for (const rawKey of Object.keys(style)) {
    const property = toKebabCase(rawKey);
    if (!STYLE_PROPERTY_ALLOWLIST.has(property)) {
      continue;
    }
    const value = sanitizeCssValue(style[rawKey]);
    if (value === null) {
      continue;
    }
    declarations.push({ property, value });
  }
  return serializeDeclarations(declarations);
}

function sanitizedRecord(record: Record<string, unknown> | undefined, prefix: string): Declaration[] {
  if (record === undefined || record === null) {
    return [];
  }
  const declarations: Declaration[] = [];
  for (const key of Object.keys(record)) {
    const value = sanitizeCssValue(record[key]);
    if (value === null) {
      continue;
    }
    // Custom property; the token key is sanitized to a safe identifier charset.
    const safeKey = key.replace(/[^a-zA-Z0-9-]/g, "-");
    declarations.push({ property: `--${prefix}-${safeKey}`, value });
  }
  return declarations;
}

/**
 * Map `ThemeTokens` to a CSS declaration string. Palette/fonts/spacing are
 * emitted as CSS custom properties (deterministically sorted), plus a few
 * concrete properties (background/color/font) so token changes are directly
 * visible in output and fixtures can distinguish themes.
 */
export function themeToCss(theme: ThemeTokens | undefined): string {
  if (theme === undefined || theme === null) {
    return "";
  }
  const declarations: Declaration[] = [
    ...sanitizedRecord(theme.palette, "palette"),
    ...sanitizedRecord(theme.fonts, "font"),
    ...sanitizedRecord(theme.spacing, "spacing"),
  ];

  const background = sanitizeCssValue(theme.palette?.background);
  if (background !== null) {
    declarations.push({ property: "background-color", value: background });
  }
  const text = sanitizeCssValue(theme.palette?.text);
  if (text !== null) {
    declarations.push({ property: "color", value: text });
  }
  const bodyFont = sanitizeCssValue(theme.fonts?.body);
  if (bodyFont !== null) {
    declarations.push({ property: "font-family", value: bodyFont });
  }

  return serializeDeclarations(declarations);
}
