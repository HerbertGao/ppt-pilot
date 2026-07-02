"""Real end-to-end smoke for the Phase 3 LLM chain (Discovery -> Spec Builder).

Drives the in-memory app via TestClient (no server needed) using the provider
selected by the repo-root `.env` (`LLM_PROVIDER`). With `LLM_PROVIDER=openrouter`
this makes REAL OpenRouter API calls and prints the model-driven questions and
the schema-validated PresentationSpec (or the LLM_PROVIDER_ERROR if the model /
key / slug is wrong).

Run (from apps/api/):  .venv/bin/python -m scripts.llm_smoke
Dry-run without spending the key:  LLM_PROVIDER=mock .venv/bin/python -m scripts.llm_smoke
  (mock returns unparseable text -> discover returns 502, which still proves the
   whole chain up to the real-LLM boundary is wired.)
"""

from __future__ import annotations

import json
import os

from fastapi.testclient import TestClient

from app.config import load_env
from app.main import app

SAMPLE_REQUEST = (
    "给小学三年级学生做一个关于蝴蝶生命周期的科普演示，10 分钟左右，风格活泼有趣"
)


def _show(label: str, resp) -> None:
    print(f"\n== {label}  [HTTP {resp.status_code}] ==")
    try:
        print(json.dumps(resp.json(), ensure_ascii=False, indent=2))
    except Exception:
        print(resp.text)


def main() -> None:
    load_env()
    print(
        f"provider = {os.environ.get('LLM_PROVIDER', 'mock')} | "
        f"model = {os.environ.get('OPENROUTER_MODEL') or 'auto'}"
    )
    client = TestClient(app)

    r = client.post(
        "/api/projects", json={"initialRequest": SAMPLE_REQUEST, "scene": "education"}
    )
    _show("create project", r)
    if r.status_code != 200:
        return
    pid = r.json()["projectId"]

    _show(
        "-> REQUIREMENT_DISCOVERY",
        client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_DISCOVERY"}),
    )
    _show(
        "discover (Requirement Discovery + Question agents)",
        client.post(f"/api/projects/{pid}/requirements/discover", json={"mode": "fast"}),
    )
    _show(
        "-> REQUIREMENT_REVIEW",
        client.post(f"/api/projects/{pid}/transitions", json={"to": "REQUIREMENT_REVIEW"}),
    )
    _show(
        "confirm (Spec Builder -> schema-validated PresentationSpec)",
        client.post(f"/api/projects/{pid}/requirements/confirm", json={}),
    )


if __name__ == "__main__":
    main()
