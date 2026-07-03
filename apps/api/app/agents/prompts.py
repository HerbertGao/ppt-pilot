"""Load versioned prompt templates from `packages/ai-workflow/prompts/<version>`.

Prompts are the language-neutral "definition" layer (design D1): the runtime
here loads them, the templates themselves live in `packages/ai-workflow`.
Versioning is by directory (`prompts/v1`, `prompts/v2`, ...), so a prompt change
is a new directory rather than a silent edit.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from ..shared_schema_adapter import repo_root

DEFAULT_PROMPT_VERSION = "v1"

PROMPT_FILES = {
    "requirement_discovery": "requirement_discovery.txt",
    "requirement_gap": "requirement_gap.txt",
    "question": "question.txt",
    "spec_builder": "spec_builder.txt",
    "outline": "outline.txt",
    "slide_planner": "slide_planner.txt",
}


def prompts_dir(version: str = DEFAULT_PROMPT_VERSION) -> Path:
    return repo_root() / "packages" / "ai-workflow" / "prompts" / version


@lru_cache(maxsize=None)
def load_prompt(name: str, version: str = DEFAULT_PROMPT_VERSION) -> str:
    try:
        filename = PROMPT_FILES[name]
    except KeyError as exc:
        raise KeyError(f"unknown prompt template: {name!r}") from exc
    return (prompts_dir(version) / filename).read_text(encoding="utf-8")
