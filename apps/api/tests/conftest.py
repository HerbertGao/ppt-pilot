"""Shared test fixtures for the Phase 2 contract suite.

The backend keeps a process-memory repository singleton (`app.routes._repository`).
Each test gets a *fresh* repository so state never leaks across tests. The shared-
schema constants singleton is left cached on purpose: it is immutable and loading
it spawns a Node subprocess, so resetting it per test would only add cost.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app.routes as routes
from app.main import app
from app.repository import InMemoryRepository


@pytest.fixture(autouse=True)
def _hermetic_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the suite offline no matter what a developer's local `.env` holds:
    force the mock provider and strip any OpenRouter creds from the environment.
    `load_env()` uses `override=False`, so this pre-set `LLM_PROVIDER` always wins."""

    monkeypatch.setenv("LLM_PROVIDER", "mock")
    for var in ("OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_BASE_URL", "OPENROUTER_TIMEOUT"):
        monkeypatch.delenv(var, raising=False)
    routes._llm_provider = None  # drop any cached provider so the mock is rebuilt


@pytest.fixture
def repo() -> InMemoryRepository:
    """Fresh in-memory repository wired into the route singleton for one test."""

    fresh = InMemoryRepository()
    routes._repository = fresh
    return fresh


@pytest.fixture
def client(repo: InMemoryRepository) -> TestClient:
    """TestClient bound to a fresh repository (via the `repo` fixture)."""

    return TestClient(app)
