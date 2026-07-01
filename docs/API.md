# API Draft

## 1. API Style

Use REST for MVP.

Future options:

- WebSocket for long-running generation progress
- Server-Sent Events for streaming agent logs
- GraphQL is not necessary for MVP

## 2. Project APIs

### Create Project

```http
POST /api/projects
```

Request:

```json
{
  "title": "AI Agent Enterprise Applications",
  "initialRequest": "做一个面向管理层的 AI Agent 企业应用 PPT"
}
```

Response:

```json
{
  "projectId": "proj_001",
  "status": "REQUIREMENT_DISCOVERY"
}
```

### Get Project

```http
GET /api/projects/{projectId}
```

## 3. Requirement APIs

### Start Requirement Discovery

```http
POST /api/projects/{projectId}/requirements/discover
```

### Answer Question

```http
POST /api/projects/{projectId}/requirements/questions/{questionId}/answer
```

Request:

```json
{
  "answer": "面向公司高管，20分钟，偏商业价值"
}
```

### Confirm Spec

```http
POST /api/projects/{projectId}/requirements/confirm
```

## 4. Outline APIs

### Generate Outline

```http
POST /api/projects/{projectId}/outline/generate
```

### Update Outline

```http
PUT /api/projects/{projectId}/outline
```

### Confirm Outline

```http
POST /api/projects/{projectId}/outline/confirm
```

## 5. Slide Plan APIs

### Generate Slide Plans

```http
POST /api/projects/{projectId}/slides/plans/generate
```

### Update Slide Plan

```http
PUT /api/projects/{projectId}/slides/{slideId}/plan
```

## 6. Slide Generation APIs

### Generate Slide

```http
POST /api/projects/{projectId}/slides/{slideId}/generate
```

### Regenerate Slide

```http
POST /api/projects/{projectId}/slides/{slideId}/regenerate
```

Request:

```json
{
  "scope": "text_only | image_only | layout_only | full_slide",
  "instruction": "保持结构不变，让表达更适合高管"
}
```

### Regenerate Element

```http
POST /api/projects/{projectId}/slides/{slideId}/elements/{elementId}/regenerate
```

## 7. Editing APIs

### Update Element

```http
PATCH /api/projects/{projectId}/slides/{slideId}/elements/{elementId}
```

### Lock Element

```http
POST /api/projects/{projectId}/slides/{slideId}/elements/{elementId}/lock
```

### Unlock Element

```http
POST /api/projects/{projectId}/slides/{slideId}/elements/{elementId}/unlock
```

### Lock Slide

```http
POST /api/projects/{projectId}/slides/{slideId}/lock
```

## 8. Review APIs

### Run Review

```http
POST /api/projects/{projectId}/review
```

Response:

```json
{
  "score": 0.82,
  "issues": []
}
```

## 9. Export APIs

### Export

```http
POST /api/projects/{projectId}/export
```

Request:

```json
{
  "format": "pptx | pdf | html"
}
```

Response:

```json
{
  "artifactId": "export_001",
  "status": "processing"
}
```

### Download Export

```http
GET /api/exports/{artifactId}/download
```

## 10. Async Job Model

Generation and export should return job IDs.

```json
{
  "jobId": "job_001",
  "status": "queued"
}
```

Job statuses:

```text
queued
running
succeeded
failed
cancelled
```

## 11. Streaming Logs Later

Use SSE:

```http
GET /api/jobs/{jobId}/events
```

Event examples:

```text
agent.started
agent.question.generated
agent.output.validated
asset.generated
slide.rendered
export.completed
```
