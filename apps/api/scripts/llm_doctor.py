"""Report the effective LLM config from the repo-root .env — never prints the key.

Run:  apps/api/.venv/bin/python -m scripts.llm_doctor    (from apps/api/)
"""

from __future__ import annotations

import os

from app.config import load_env


def main() -> None:
    load_env()
    provider = os.environ.get("LLM_PROVIDER", "mock").lower()
    print(f"LLM_PROVIDER      = {provider}")
    if provider == "openrouter":
        key = os.environ.get("OPENROUTER_API_KEY") or ""
        print(f"OPENROUTER_API_KEY= {'set (' + str(len(key)) + ' chars)' if key else 'MISSING — 填入 .env'}")
        print(f"OPENROUTER_MODEL  = {os.environ.get('OPENROUTER_MODEL') or 'auto'}")
        print(f"OPENROUTER_BASE_URL={os.environ.get('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1')}")
        print("ready" if key else "NOT ready: 缺 OPENROUTER_API_KEY")
    else:
        print("mock provider — 离线，无需 key")


if __name__ == "__main__":
    main()
