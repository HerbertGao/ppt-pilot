# Data Model

## 1. Principle

PPTX is not the source of truth.

The source of truth is a structured Presentation JSON model plus assets and version history.

## 2. Core Entities

```text
Workspace
Project
Presentation
Slide
Element
Asset
Version
Event
ExportArtifact
```

## 3. Presentation

```json
{
  "id": "pres_001",
  "projectId": "proj_001",
  "title": "AI Agent Enterprise Applications",
  "spec": {},
  "theme": {},
  "slides": [],
  "createdAt": "",
  "updatedAt": ""
}
```

## 4. Presentation Spec

```json
{
  "topic": "",
  "audience": "executives",
  "purpose": "internal sharing",
  "durationMinutes": 20,
  "slideCountTarget": 12,
  "language": "zh-CN",
  "tone": "professional",
  "style": {
    "visualStyle": "modern",
    "density": "medium",
    "chineseFriendly": true,
    "chinaStyleFriendly": true
  },
  "constraints": [],
  "sourceMaterials": [],
  "confirmedByUser": false
}
```

## 5. Slide

```json
{
  "id": "slide_001",
  "presentationId": "pres_001",
  "index": 1,
  "title": "",
  "status": "draft",
  "locked": false,
  "plan": {},
  "elements": [],
  "notes": "",
  "createdAt": "",
  "updatedAt": ""
}
```

Slide status:

```text
draft
planned
generated
reviewed
locked
```

## 6. Slide Plan

```json
{
  "objective": "",
  "keyMessage": "",
  "contentIntent": "",
  "visualIntent": "diagram",
  "layoutSuggestion": "two-column",
  "requiredAssets": [],
  "riskNotes": []
}
```

## 7. Element

```json
{
  "id": "el_001",
  "slideId": "slide_001",
  "type": "text",
  "content": {},
  "x": 80,
  "y": 60,
  "width": 960,
  "height": 120,
  "rotation": 0,
  "zIndex": 1,
  "style": {},
  "locked": false,
  "metadata": {}
}
```

Element types:

```text
text
image
shape
icon
chart
table
diagram
group
```

## 8. Text Element Content

```json
{
  "kind": "title | subtitle | bullet | paragraph | caption",
  "text": "",
  "richText": null
}
```

## 9. Image Element Content

```json
{
  "assetId": "asset_001",
  "alt": "",
  "crop": {
    "x": 0,
    "y": 0,
    "width": 1,
    "height": 1
  }
}
```

## 10. Asset

```json
{
  "id": "asset_001",
  "type": "image",
  "source": "ai | stock | upload | generated_diagram",
  "url": "",
  "prompt": "",
  "license": {
    "name": "",
    "url": "",
    "attributionRequired": false
  },
  "metadata": {}
}
```

## 11. Version

```json
{
  "id": "ver_001",
  "projectId": "proj_001",
  "scope": "presentation | slide | element",
  "targetId": "slide_001",
  "parentVersionId": null,
  "snapshot": {},
  "diff": {},
  "createdBy": "user | ai",
  "createdAt": ""
}
```

## 12. Event

```json
{
  "id": "evt_001",
  "projectId": "proj_001",
  "type": "SLIDE_REGENERATED",
  "actor": "user | ai | system",
  "payload": {},
  "createdAt": ""
}
```

## 13. Lock Model

Locks should exist on both slides and elements.

```json
{
  "locked": true,
  "lockedBy": "user",
  "lockedAt": "",
  "lockReason": "approved by user"
}
```

## 14. Schema Strategy

Use shared schemas in `packages/shared-schema`.

Generate:

- TypeScript types
- Python Pydantic models
- JSON Schema for validation

Do not duplicate schema logic manually.
