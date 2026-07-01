"""Executable Python-side smoke check for shared-schema consumption."""

from __future__ import annotations

import sys

from .shared_schema_adapter import load_shared_schema_fixture, validate_shared_schema_fixture

VALID_FIXTURE = "fixtures/valid/presentation-spec-minimal.json"
INVALID_FIXTURE = "fixtures/invalid/invalid-scene.presentation-spec.json"


def run_smoke() -> list[str]:
    messages: list[str] = []

    valid_envelope = load_shared_schema_fixture(VALID_FIXTURE)
    valid_result = validate_shared_schema_fixture(valid_envelope)
    if not valid_result.ok:
        raise AssertionError(
            f"{VALID_FIXTURE} should pass shared-schema smoke: {valid_result.errors}"
        )
    messages.append(f"PASS valid fixture: {VALID_FIXTURE}")

    invalid_envelope = load_shared_schema_fixture(INVALID_FIXTURE)
    invalid_result = validate_shared_schema_fixture(invalid_envelope)
    if invalid_result.ok:
        raise AssertionError(f"{INVALID_FIXTURE} should fail shared-schema smoke")
    messages.append(f"PASS invalid fixture rejected: {INVALID_FIXTURE}")

    return messages


def main() -> int:
    try:
        for message in run_smoke():
            print(message)
    except Exception as exc:
        print(f"shared-schema smoke failed: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
