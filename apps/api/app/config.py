"""Runtime env loading.

The repo-root `.env` (gitignored) is the single source of truth for runtime
secrets/config shared across services (OpenRouter key/model, provider select);
`.env.example` documents the keys. Loaded with `override=False` so an explicit
shell/CI env var always wins over the file — this keeps the test suite (which
forces `LLM_PROVIDER=mock`) hermetic regardless of a developer's local `.env`.
"""

from __future__ import annotations

from dotenv import load_dotenv

from .shared_schema_adapter import repo_root

_loaded = False


def load_env() -> None:
    """Load the repo-root `.env` into `os.environ` once (idempotent, no override)."""

    global _loaded
    if _loaded:
        return
    load_dotenv(repo_root() / ".env", override=False)
    _loaded = True
