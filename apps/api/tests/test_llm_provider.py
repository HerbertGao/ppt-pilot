"""LLM provider tests (group C, task 2.5).

Covers: mock reproducibility/programmability, provider selection defaulting to
mock, and OpenRouter missing-credentials / timeout / upstream failures all
mapping to `LLMProviderError`. The network is monkeypatched — no real calls.
"""

from __future__ import annotations

import http.client
import json
import socket
import urllib.error

import pytest

from app.errors import LLMProviderError
from app.llm import (
    LLMProvider,
    MockLLMProvider,
    OpenRouterProvider,
    _extract_text,
    build_llm_provider,
)

MESSAGES = [{"role": "user", "content": "hi"}]


# --------------------------------------------------------------------------- #
# Mock: deterministic + programmable
# --------------------------------------------------------------------------- #


def test_mock_fixed_string_is_reproducible():
    provider = MockLLMProvider("SPEC_JSON")
    out1 = provider.generate(MESSAGES, model="m")
    out2 = provider.generate(MESSAGES, model="m")
    assert out1 == out2 == "SPEC_JSON"


def test_mock_sequence_consumed_in_order():
    provider = MockLLMProvider(["a", "b"])
    assert provider.generate(MESSAGES, model="m") == "a"
    assert provider.generate(MESSAGES, model="m") == "b"
    with pytest.raises(IndexError):
        provider.generate(MESSAGES, model="m")


def test_mock_callable_gets_the_call():
    def script(messages, *, model, response_format):
        return f"{model}:{messages[0]['content']}"

    provider = MockLLMProvider(script)
    assert provider.generate(MESSAGES, model="gpt") == "gpt:hi"
    assert provider.calls[0]["model"] == "gpt"


def test_mock_satisfies_protocol():
    assert isinstance(MockLLMProvider(), LLMProvider)


# --------------------------------------------------------------------------- #
# Provider selection: default mock, CI never builds OpenRouter
# --------------------------------------------------------------------------- #


def test_build_defaults_to_mock():
    assert isinstance(build_llm_provider({}), MockLLMProvider)


def test_build_openrouter_without_key_raises():
    with pytest.raises(LLMProviderError):
        build_llm_provider({"LLM_PROVIDER": "openrouter"})


def test_build_unknown_provider_raises():
    with pytest.raises(LLMProviderError):
        build_llm_provider({"LLM_PROVIDER": "bogus"})


# --------------------------------------------------------------------------- #
# OpenRouter: failure paths -> LLMProviderError (network mocked)
# --------------------------------------------------------------------------- #


def test_openrouter_missing_credentials_raises():
    with pytest.raises(LLMProviderError):
        OpenRouterProvider(api_key=None, default_model="m")


def test_openrouter_missing_model_raises():
    provider = OpenRouterProvider(api_key="k")
    with pytest.raises(LLMProviderError):
        provider.generate(MESSAGES, model=None)


def test_openrouter_timeout_maps_to_error(monkeypatch):
    def fake_urlopen(*args, **kwargs):
        raise urllib.error.URLError(socket.timeout("timed out"))

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    provider = OpenRouterProvider(api_key="k", default_model="m", timeout=0.01)
    with pytest.raises(LLMProviderError):
        provider.generate(MESSAGES)


def test_openrouter_http_error_maps_to_error(monkeypatch):
    def fake_urlopen(*args, **kwargs):
        raise urllib.error.HTTPError(
            url="x", code=500, msg="boom", hdrs=None, fp=None
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    provider = OpenRouterProvider(api_key="k", default_model="m")
    with pytest.raises(LLMProviderError):
        provider.generate(MESSAGES)


def test_openrouter_malformed_response_maps_to_error(monkeypatch):
    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"{}"

    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: FakeResp())
    provider = OpenRouterProvider(api_key="k", default_model="m")
    with pytest.raises(LLMProviderError):
        provider.generate(MESSAGES)


def test_openrouter_incomplete_read_maps_to_error(monkeypatch):
    # A truncated response body raises http.client.IncompleteRead (a subclass of
    # http.client.HTTPException, NOT OSError/URLError). It must still map to
    # LLMProviderError (->502) rather than escape as a raw 500.
    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            raise http.client.IncompleteRead(b"partial")

    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: FakeResp())
    provider = OpenRouterProvider(api_key="k", default_model="m")
    with pytest.raises(LLMProviderError):
        provider.generate(MESSAGES)


def test_from_env_model_wins_over_agent_default(monkeypatch):
    captured = {}

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"choices":[{"message":{"content":"ok"}}]}'

    def fake_urlopen(request, timeout=None):
        captured["body"] = json.loads(request.data)
        return FakeResp()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    provider = OpenRouterProvider.from_env(
        {"OPENROUTER_API_KEY": "k", "OPENROUTER_MODEL": "x/y"}
    )
    # Agents pass model=None -> the env-configured model must be used, not "auto".
    provider.generate(MESSAGES, model=None)
    assert captured["body"]["model"] == "x/y"


def test_from_env_defaults_model_to_auto_when_unset(monkeypatch):
    captured = {}

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"choices":[{"message":{"content":"ok"}}]}'

    def fake_urlopen(request, timeout=None):
        captured["body"] = json.loads(request.data)
        return FakeResp()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    provider = OpenRouterProvider.from_env({"OPENROUTER_API_KEY": "k"})
    provider.generate(MESSAGES, model=None)
    assert captured["body"]["model"] == "auto"


def test_from_env_malformed_timeout_raises():
    with pytest.raises(LLMProviderError):
        OpenRouterProvider.from_env(
            {"OPENROUTER_API_KEY": "k", "OPENROUTER_TIMEOUT": "abc"}
        )


def test_openrouter_non_string_content_maps_to_error(monkeypatch):
    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"choices":[{"message":{"content":null}}]}'

    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: FakeResp())
    provider = OpenRouterProvider(api_key="k", default_model="m")
    with pytest.raises(LLMProviderError):
        provider.generate(MESSAGES)


def test_openrouter_non_json_body_maps_to_error(monkeypatch):
    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"not json at all"

    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: FakeResp())
    provider = OpenRouterProvider(api_key="k", default_model="m")
    with pytest.raises(LLMProviderError):
        provider.generate(MESSAGES)


def test_openrouter_malformed_base_url_maps_to_error():
    # A malformed base_url makes urlopen raise ValueError ("unknown url type"),
    # which must map to LLMProviderError rather than escaping as a 500.
    provider = OpenRouterProvider(api_key="k", default_model="m", base_url="not a url")
    with pytest.raises(LLMProviderError):
        provider.generate(MESSAGES)


def test_extract_text_invalid_utf8_body_maps_to_error():
    # An undecodable body makes json.loads raise UnicodeDecodeError, which must
    # map to LLMProviderError (->502) rather than escape as a raw 500. (The bytes
    # b"\xff\xfe\x00garbage" instead decode-then-fail as JSONDecodeError, already
    # covered; b"\xff" exercises the genuine UnicodeDecodeError path this guards.)
    with pytest.raises(LLMProviderError):
        _extract_text(b"\xff")


def test_openrouter_happy_path(monkeypatch):
    captured = {}

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"choices":[{"message":{"content":"hello"}}]}'

    def fake_urlopen(request, timeout=None):
        captured["timeout"] = timeout
        captured["auth"] = request.headers.get("Authorization")
        return FakeResp()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    provider = OpenRouterProvider(api_key="secret", default_model="m", timeout=5)
    assert provider.generate(MESSAGES) == "hello"
    assert captured["timeout"] == 5
    assert captured["auth"] == "Bearer secret"
