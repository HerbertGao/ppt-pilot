# Agent Protocol

## 1. Agent Design Philosophy

PPTPilot should not use one giant prompt to generate a whole deck.

Each agent has a narrow responsibility, explicit input, explicit output, confidence scoring, and a stop condition.

The system should behave like an experienced product manager and presentation consultant before behaving like a designer.

## 2. Agent List

```text
Requirement Discovery Agent   (implemented, Phase 3)
Requirement Gap Agent         (implemented, Phase 3)
Question Agent                (implemented, Phase 3)
Spec Builder Agent            (implemented, Phase 3)
Outline Agent                 (implemented, Phase 5)
Slide Planner Agent           (implemented, Phase 5)
Content Agent                 (planned)
Layout Agent                  (planned)
Image Agent                   (planned, Phase 9)
Review Agent                  (planned, Phase 10)
```

Implemented agents run behind the `LLMProvider` interface (OpenRouter/DeepSeek,
text-only; deterministic mock in CI). The Requirement Discovery / Gap / Question /
Spec Builder set is the Phase 3 requirement-and-spec pipeline; Outline and Slide
Planner are Phase 5.

Two downstream steps are **deterministic non-agent services** — no LLM, no agent:

- **Slide materialization** (Phase 6): turns confirmed slide plans into the slide
  model / HTML preview via pure functions (`apps/api` + `packages/ppt-engine`).
- **PPTX export** (Phase 7): renders the presentation to `.pptx` via python-pptx
  in the backend (`apps/api/app/export.py`).

There is no "Export Agent"; export is a deterministic service. Content / Layout /
Image / Review agents below are forward-looking design and are **not yet built**.

## 3. Requirement Discovery Agent (Phase 3 implemented)

### Goal

Understand the user's real presentation need.

### Must identify

- Topic
- Audience
- Purpose
- Duration
- Language
- Tone
- Target format
- Page count expectation
- Materials provided by user
- Deadline or usage context

### Output

```json
{
  "topic": "",
  "audience": "",
  "purpose": "",
  "durationMinutes": null,
  "language": "zh-CN",
  "tone": "professional",
  "stylePreference": null,
  "targetFormat": ["pptx"],
  "knownFacts": [],
  "unknowns": [],
  "confidence": 0.0
}
```

## 4. Requirement Gap Agent (Phase 3 implemented)

### Goal

Detect missing or risky requirement fields before generation.

### Rule

Do not ask every possible question. Ask only high-value questions.

### Question priority

```text
MUST_ASK: generation quality will be poor without this answer
SHOULD_ASK: useful but skippable
DO_NOT_ASK: can use defaults
```

### Example

Audience is usually MUST_ASK.
Company logo is usually SHOULD_ASK or DO_NOT_ASK.

## 5. Question Agent (Phase 3 implemented)

### Goal

Turn gaps into clear user-facing questions.

### UX rule

Prefer multiple-choice questions with an optional free-text field.

Example:

```text
Who is the audience?
- Executives
- Technical team
- Customers
- Investors
- Students
- Other
```

### Stop condition

Stop asking when:

- Requirement confidence reaches the effective `sceneThreshold`, or
- effective `maxQuestions` has been reached, or
- all MUST_ASK fields are answered, or
- user chooses to skip remaining questions.

Default fast-mode thresholds:

```text
education: 0.82
corporate: 0.75
default: 0.78
```

Thorough mode should use at least `0.85` unless the scene policy explicitly overrides it.

Default question caps:

```text
fast: 3
thorough: 5
```

## 6. Spec Builder Agent (Phase 3 implemented)

### Goal

Produce the canonical Presentation Spec used by all downstream agents.

### Output

```json
{
  "topic": "",
  "audience": "",
  "purpose": "",
  "durationMinutes": 20,
  "slideCountTarget": 12,
  "language": "zh-CN",
  "tone": "professional",
  "scene": "education | corporate | default",
  "styleProfileId": "style_museum_children",
  "questionPolicy": {
    "mode": "fast | thorough",
    "sceneThreshold": 0.82,
    "maxQuestions": 3
  },
  "riskNotes": [],
  "style": {
    "visualStyle": "modern",
    "density": "medium",
    "chineseFriendly": true
  },
  "constraints": [],
  "sourceMaterials": [],
  "confirmedByUser": false
}
```

## 7. Outline Agent (Phase 5 implemented)

### Goal

From a **confirmed** `PresentationSpec`, generate presentation structure. Runs
behind the `LLMProvider` interface (default deterministic mock in CI), with a
`build_spec`-style bounded repair loop and inline `validateOutline` (section
count ≤ cap, ≥ 1 section, each `estimatedSlides ≥ 1`). Repair exhausted →
`OUTLINE_VALIDATION_ERROR` (400); provider transport failure → `LLM_PROVIDER_ERROR` (502).

### Input

The confirmed `PresentationSpec` (scene / style / questionPolicy / riskNotes /
known requirements).

### Output

The model emits only `{ sections: [...] }`; the runtime injects the
runtime-owned `confirmedByUser=false` (and optional `id` / `riskNotes`) to form
the canonical `Outline`. Sections carry **no `slideId` list** — slide identity's
single source of truth is `SlidePlan.slideId` (see §8).

```json
{
  "sections": [
    {
      "title": "",
      "purpose": "",
      "estimatedSlides": 3
    }
  ]
}
```

## 8. Slide Planner Agent (Phase 5 implemented)

### Goal

From a **confirmed** outline (plus its confirmed Spec context), generate
per-slide plans before content generation. Behind `LLMProvider` (default mock),
`build_spec`-style bounded repair with inline `validateSlidePlan` + collection
`slideId` uniqueness + total-slide cap.

### Input

The confirmed `Outline` and its `PresentationSpec` context.

### Output

The model emits section-grouped pages; the runtime flattens them and **assigns
`slideId` itself** (deterministic `slide-0001` in order, unique across the set —
never trusted to the LLM, because `slideId` is the key for the single-page
`PUT /slides/{slideId}/plan` edit). `visualIntent` is constrained to the
`VisualIntent` enum. When a section's page count differs from its
`estimatedSlides`, a soft `riskNote` is appended to that section's first page.

```json
{
  "slideId": "slide-0001",
  "title": "",
  "objective": "",
  "keyMessage": "",
  "contentIntent": "",
  "visualIntent": "diagram | image | chart | text | comparison | timeline",
  "layoutSuggestion": "",
  "requiredAssets": [],
  "riskNotes": []
}
```

## 9. Content Agent (planned — not implemented)

### Goal

Generate text elements.

### Must respect

- Slide plan
- Presentation spec
- Existing locked elements
- Brand terminology later

### Output

Structured text elements only. No layout coordinates.

## 10. Layout Agent (planned — not implemented)

### Goal

Place elements onto a slide.

### Must respect

- Locked element positions
- Theme grid
- Readability
- Chinese typography rules
- Slide density

### Output

Element coordinates and layout metadata.

## 11. Image Agent (planned, Phase 9 — not implemented)

### Goal

Create or retrieve visual assets.

### Supported modes

- AI-generated images
- Open-license stock images
- Icons
- Diagrams

### Must store

- Prompt
- Source URL
- License metadata if downloaded
- Attribution requirements if any

## 12. Review Agent (planned, Phase 10 — not implemented)

### Goal

Act as a critic.

### Checks

- Requirement alignment
- Duplicated slides
- Logical flow
- Missing evidence
- Poor readability
- Excessive text
- Unsupported claims
- Brand inconsistency later
- Copyright risk

### Output

```json
{
  "score": 0.0,
  "issues": [
    {
      "severity": "low | medium | high",
      "slideId": "",
      "message": "",
      "suggestedAction": ""
    }
  ]
}
```

## 13. Core Safety Rule

Agents must never modify locked pages or locked elements.

If a user asks to regenerate a locked item, the system should ask whether to unlock it first.
