import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderPresentation,
  renderSlide,
  renderThumbnail,
  sanitizeCssValue,
  slideBaseCss,
  styleObjectToCss,
  themeToCss,
} from "../dist/index.js";

// Zero-dep golden runner (mirrors shared-schema/scripts/validate-fixtures.mjs).
// Set UPDATE_GOLDEN=1 to (re)write the expected/* golden files after an
// intentional renderer change; default run asserts current output === golden.

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const inputDir = join(packageRoot, "fixtures", "input");
const expectedDir = join(packageRoot, "fixtures", "expected");
const update = process.env.UPDATE_GOLDEN === "1";

// The shared cross-language golden: a materialized Presentation produced by the
// Python materializer. Rendering it here catches field/shape drift between the
// two languages.
const sharedGoldenPath = join(
  packageRoot,
  "..",
  "shared-schema",
  "fixtures",
  "valid",
  "presentation-materialized.json",
);

let checked = 0;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Compare `actual` against expected/<name>, or write it under UPDATE_GOLDEN. */
function goldenEquals(name, actual) {
  const path = join(expectedDir, name);
  if (update) {
    mkdirSync(expectedDir, { recursive: true });
    writeFileSync(path, actual);
    return;
  }
  // A missing golden must FAIL (not silently write + pass) so a lost/renamed
  // fixture can't green a CI run; regenerate explicitly with UPDATE_GOLDEN=1.
  assert.ok(existsSync(path), `missing golden fixtures/expected/${name} (set UPDATE_GOLDEN=1 to create)`);
  assert.equal(actual, readFileSync(path, "utf8"), `golden mismatch: fixtures/expected/${name}`);
  checked += 1;
}

// 1. Shared cross-language golden Presentation → deterministic HTML.
{
  const fixture = readJson(sharedGoldenPath);
  const presentation = fixture.data;
  const html = renderPresentation(presentation);

  // Determinism: same model twice → identical output (deterministic key order).
  assert.equal(html, renderPresentation(presentation), "renderPresentation is not deterministic");
  checked += 1;

  // Structural drift guards: every slide id + the image→shape placeholder land.
  for (const slide of presentation.slides) {
    assert.ok(html.includes(`data-slide-id="${slide.id}"`), `missing slide ${slide.id} in output`);
  }
  assert.ok(
    html.includes('data-element-type="shape"'),
    "expected the image-intent shape placeholder in shared golden output",
  );
  assert.ok(!/data-element-type="image"/.test(html), "shared golden must not contain image elements this phase");
  checked += 2;

  goldenEquals("presentation-materialized.html", html);
}

// 2. Special-char escaping + dangerous-CSS sanitization.
{
  const fixture = readJson(join(inputDir, "escape-and-css-slide.json"));
  const html = renderSlide(fixture.slide, fixture.theme);

  assert.equal(html, renderSlide(fixture.slide, fixture.theme), "renderSlide is not deterministic");
  checked += 1;

  // Text context: raw markup must be escaped, never emitted live.
  assert.ok(!html.includes("<script>alert(1)</script>"), "unescaped <script> leaked into output");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "text was not HTML-escaped");
  assert.ok(html.includes("Danger &lt;b&gt;title&lt;/b&gt;"), "title was not HTML-escaped");

  // CSS context: allowlisted safe declarations survive; dangerous ones dropped.
  assert.ok(html.includes("color:red"), "allowlisted color declaration was dropped");
  assert.ok(html.includes("border-radius:8px"), "allowlisted border-radius (camelCase) was dropped");
  assert.ok(!/expression/i.test(html), "expression(...) value leaked through CSS sanitization");
  assert.ok(!/url\(/i.test(html), "url(...) value leaked through CSS sanitization");
  assert.ok(!/position:fixed/i.test(html), "non-allowlisted property leaked through");
  assert.ok(!html.includes("</style>"), "</style> breakout leaked through CSS sanitization");
  assert.ok(!html.includes("evil()"), "injected script fragment leaked through");
  checked += 9;

  goldenEquals("escape-and-css-slide.html", html);
}

// 3. Theme tokens are distinguishable (token → deterministic, distinct style).
{
  const { themeA, themeB } = readJson(join(inputDir, "themes.json"));
  const slide = readJson(sharedGoldenPath).data.slides[0];
  const htmlA = renderSlide(slide, themeA);
  const htmlB = renderSlide(slide, themeB);

  assert.notEqual(htmlA, htmlB, "different ThemeTokens produced identical output");
  assert.ok(htmlA.includes("#0B1F3A") && !htmlA.includes("#2A0B0B"), "themeA palette not applied");
  assert.ok(htmlB.includes("#2A0B0B") && !htmlB.includes("#0B1F3A"), "themeB palette not applied");
  checked += 3;
}

// 4. Thumbnail placeholder — deterministic data-uri, no network/headless.
{
  const slide = readJson(sharedGoldenPath).data.slides[0];
  const uri = renderThumbnail(slide);

  assert.equal(uri, renderThumbnail(slide), "renderThumbnail is not deterministic");
  assert.ok(uri.startsWith("data:image/svg+xml,"), "thumbnail is not an inline SVG data-uri");
  assert.ok(!/https?:/i.test(uri), "thumbnail references an external resource");
  checked += 3;

  goldenEquals("thumbnail-slide-1.txt", uri);
}

// 5. URL-loading CSS functions are neutralized exactly like url(...) already is.
//    image-set/-webkit-image-set/cross-fade/image()/element() all load a URL from
//    a string arg, so the sanitizer must drop them at every entry point.
{
  const urlFns = [
    'image-set("https://evil.example/p.png" 1x)',
    '-webkit-image-set("https://evil.example/p.png" 1x)',
    'cross-fade(url(https://evil.example/a.png), url(https://evil.example/b.png), 50%)',
    'image("https://evil.example/p.png")',
    'element(#evil)',
  ];

  for (const value of urlFns) {
    // sanitizeCssValue drops the whole value (like url(...)), returning null.
    assert.equal(sanitizeCssValue(value), null, `sanitizeCssValue passed URL-loading fn: ${value}`);

    // element.style.background must not survive into the declaration string.
    const styleCss = styleObjectToCss({ background: value });
    assert.equal(styleCss, "", `styleObjectToCss emitted URL-loading background: ${value}`);
    assert.ok(!/evil\.example/.test(styleCss), `styleObjectToCss leaked external URL: ${value}`);

    // themeToCss custom-property values route through the same sanitizer.
    const themeCss = themeToCss({ palette: { brand: value } });
    assert.ok(!themeCss.includes("--palette-brand"), `themeToCss emitted URL-loading custom prop: ${value}`);
    assert.ok(!/evil\.example/.test(themeCss), `themeToCss leaked external URL: ${value}`);
  }
  checked += urlFns.length * 5;
}

// 6. Base CSS supplies the 1280×720 containing block + key selectors so the
//    renderer's position:absolute HTML lays out inside the frame, not the
//    viewport. This is a separate export — it must NOT alter renderSlide/
//    renderPresentation output (golden fixtures above already assert that).
{
  const css = slideBaseCss();
  assert.equal(typeof css, "string", "slideBaseCss did not return a string");
  assert.ok(css.length > 0, "slideBaseCss returned an empty string");
  assert.equal(css, slideBaseCss(), "slideBaseCss is not deterministic");
  for (const selector of [".ppt-slide", ".ppt-slide__canvas", ".ppt-element"]) {
    assert.ok(css.includes(selector), `slideBaseCss missing selector ${selector}`);
  }
  assert.ok(css.includes("1280px"), "slideBaseCss missing the 1280px canvas width");
  assert.ok(css.includes("720px"), "slideBaseCss missing the 720px canvas height");
  assert.ok(css.includes("position: relative"), "slideBaseCss must make .ppt-slide a positioned parent");
  checked += 7;
}

console.log(`ppt-engine fixtures validated: ${checked} renderer expectations passed`);
