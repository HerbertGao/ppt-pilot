"""Thin Phase 1 bridge for shared-schema smoke checks.

This module is not a backend-owned core entity model. It delegates validation to
the built packages/shared-schema artifact so the API workspace does not copy the
core contract.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import subprocess
from typing import Any

BUILD_HINT = (
    "shared-schema build artifact is missing. Run "
    "`pnpm --filter @ppt-pilot/shared-schema build` or the root validate/typecheck "
    "flow before running the API smoke check."
)

NODE_VALIDATE_SCRIPT = r"""
import { pathToFileURL } from "node:url";

const entrypoint = process.argv[1];

let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  stdin += chunk;
}

const payload = JSON.parse(stdin);
const sharedSchema = await import(pathToFileURL(entrypoint).href);

if (typeof sharedSchema.validateEntity !== "function") {
  throw new Error("shared-schema dist/index.js does not export validateEntity");
}

const result = sharedSchema.validateEntity(payload.entity, payload.data);
process.stdout.write(JSON.stringify(result));
"""


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    errors: tuple[str, ...]
    normalized: dict[str, Any] | None = None


class SharedSchemaBuildMissingError(RuntimeError):
    pass


class SharedSchemaValidationBridgeError(RuntimeError):
    pass


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def shared_schema_root() -> Path:
    return repo_root() / "packages" / "shared-schema"


def shared_schema_entrypoint() -> Path:
    return shared_schema_root() / "dist" / "index.js"


def load_shared_schema_fixture(relative_path: str) -> dict[str, Any]:
    fixture_path = shared_schema_root() / relative_path
    return json.loads(fixture_path.read_text(encoding="utf-8"))


def validate_shared_schema_fixture(envelope: dict[str, Any]) -> ValidationResult:
    entity = envelope.get("entity")
    data = envelope.get("data")

    if not isinstance(entity, str):
        return ValidationResult(
            ok=False,
            errors=("entity: fixture envelope must provide an entity name",),
        )

    return validate_shared_schema_entity(entity, data)


def validate_shared_schema_entity(entity: str, data: Any) -> ValidationResult:
    entrypoint = shared_schema_entrypoint()
    if not entrypoint.exists():
        raise SharedSchemaBuildMissingError(f"{BUILD_HINT} Missing file: {entrypoint}")

    payload = json.dumps({"entity": entity, "data": data}, ensure_ascii=False)
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", NODE_VALIDATE_SCRIPT, str(entrypoint)],
        input=payload,
        text=True,
        capture_output=True,
        cwd=repo_root(),
        check=False,
    )

    if completed.returncode != 0:
        stderr = completed.stderr.strip()
        raise SharedSchemaValidationBridgeError(
            "shared-schema validateEntity bridge failed with exit code "
            f"{completed.returncode}: {stderr}"
        )

    try:
        raw_result = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise SharedSchemaValidationBridgeError(
            f"shared-schema validateEntity bridge returned invalid JSON: {exc}"
        ) from exc

    if raw_result.get("success") is True:
        normalized = raw_result.get("data")
        return ValidationResult(
            ok=True,
            errors=(),
            normalized=normalized if isinstance(normalized, dict) else None,
        )

    raw_errors = raw_result.get("errors", [])
    errors: list[str] = []
    if isinstance(raw_errors, list):
        for item in raw_errors:
            if isinstance(item, dict):
                path = item.get("path", "$")
                message = item.get("message", "validation failed")
                errors.append(f"{path}: {message}")
            else:
                errors.append(str(item))

    if not errors:
        errors.append("shared-schema validateEntity rejected payload")

    return ValidationResult(ok=False, errors=tuple(errors))
