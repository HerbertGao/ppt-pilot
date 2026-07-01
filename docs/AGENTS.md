# Agent Protocol

## 1. Agent Design Philosophy

PPTPilot should not use one giant prompt to generate a whole deck.

Each agent has a narrow responsibility, explicit input, explicit output, confidence scoring, and a stop condition.

The system should behave like an experienced product manager and presentation consultant before behaving like a designer.

## 2. Agent List

```text
Requirement Discovery Agent
Requirement Gap Agent
Question Agent
Spec Builder Agent
Outline Agent
Slide Planner Agent
Content Agent
Layout Agent
Image Agent
Review Agent
Export Agent
```

## 3. Requirement Discovery Agent

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

## 4. Requirement Gap Agent

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

## 5. Question Agent

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

## 6. Spec Builder Agent

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
  "styleProfileId": "museum-children",
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

## 7. Outline Agent

### Goal

Generate presentation structure.

### Output

```json
{
  "sections": [
    {
      "title": "",
      "purpose": "",
      "estimatedSlides": 3,
      "slides": []
    }
  ]
}
```

## 8. Slide Planner Agent

### Goal

Generate slide-level plans before content generation.

### Output

```json
{
  "slideId": "",
  "title": "",
  "objective": "",
  "keyMessage": "",
  "contentIntent": "",
  "visualIntent": "diagram | image | chart | text | comparison | timeline",
  "layoutSuggestion": "",
  "requiredAssets": []
}
```

## 9. Content Agent

### Goal

Generate text elements.

### Must respect

- Slide plan
- Presentation spec
- Existing locked elements
- Brand terminology later

### Output

Structured text elements only. No layout coordinates.

## 10. Layout Agent

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

## 11. Image Agent

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

## 12. Review Agent

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
