# UI Design

## 1. Product Shape

PPTPilot should be a desktop-first Web IDE with a mobile companion.

Desktop is for creation and editing.
Mobile is for requirement discussion, preview, comments, and approvals.

## 2. Desktop Layout

```text
+----------------------------------------------------------+
| Top Bar: project title, status, export, share             |
+----------+-------------------------------+---------------+
| Outline  | Canvas                        | Properties /  |
| Slides   |                               | AI Actions    |
|          |                               |               |
+----------+-------------------------------+---------------+
| Version history / generation logs / review issues         |
+----------------------------------------------------------+
```

## 3. Left Panel

Contains:

- Presentation outline
- Project scene / style profile selector
- Slide thumbnails
- Slide status
- Slide lock indicator
- Review score indicator later

Slide statuses:

- Draft
- Planned
- Generated
- Needs Review
- Approved
- Locked

## 4. Center Canvas

The canvas is the main editing surface.

MVP canvas features:

- Render slide elements
- Select element
- Move element
- Resize element
- Edit text
- Replace image
- Keep element geometry for locked elements (position/size/style fixed)
- Show safe margin
- Show grid later
- Show alignment guides later

Use Konva / React-Konva.

## 5. Right Panel

Two modes:

### Properties Mode

For selected element:

- Text content
- Font size
- Weight
- Color
- Position
- Size
- Lock switch

### AI Actions Mode

For current selection:

- Rewrite selected text
- Make more executive-friendly
- Make more technical
- Shorten
- Expand
- Regenerate image
- Generate image alternatives
- Keep content, change layout
- Keep layout, rewrite content
- Explain why this slide looks weak

## 6. Bottom Panel

Contains:

- Generation logs
- Version history
- Review issues
- Accept / reject changes later
- Duplicate-rate warning list (soft warning)

## 7. Requirement Discovery UX

Project creation should allow selecting scene preset and style profile before discovery (or accept defaults).

The initial interface should not be a blank prompt box only.

Two modes:

- 快速模式（fast，少问快产出）
- 标准模式（thorough，更高置信度）

Use a chat-like flow with structured cards.

Example:

```text
AI: I understand the topic, but I need 3 key details before generating.

1. Who is the audience?
- Executives
- Technical team
- Customers
- Investors
- Other

2. How long is the talk?
- 5 minutes
- 15 minutes
- 30 minutes
- 60 minutes

3. What is the goal?
- Explain
- Persuade
- Report
- Train
- Sell
```

If scene is selected as education, add default context prompts for “curious children / museum-style storytelling”.

## 8. Spec Review UX

Before outline generation, show a summary card:

```text
I will create:
- A 12-slide Chinese presentation
- For executives
- 20-minute duration
- Professional business style
- Focused on business value, not code details
```

User actions:

- Confirm
- Edit
- Ask AI to challenge this plan

When a slide has locked elements, image regeneration should be offered as a locked-preserve path (replace image only, keep geometry).
This is a later-phase interaction after slide generation and locking exist.

## 9. Mobile UX

Mobile is not a full editor.

Mobile features:

- Chat with Requirement Agent
- Upload materials
- Review outline
- Preview slide deck
- Comment on a slide
- Ask for regeneration
- Approve export

Do not implement precise drag/resizing on mobile for MVP.

## 10. Interaction Motto

Do not make the user prompt harder.
Make the product ask better questions.

## 11. Image Variant Picker

When regenerating image-type elements, present 2~5 candidate images for explicit user selection.

This belongs to Phase 6 partial regeneration, not Phase 1 requirement discovery.

- Keep original element geometry when only image is regenerated.
- User can request more batches if none are suitable.
- Do not auto-rollback to old image; selection is user-driven.
