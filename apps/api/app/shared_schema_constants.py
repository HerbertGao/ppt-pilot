"""Constants bridge to shared-schema `dist/index.js`.

Mirrors `shared_schema_adapter`'s subprocess + build-missing pattern to read
runtime constants (instead of running `validateEntity`). Reuses that module's
`repo_root()` / `shared_schema_entrypoint()` / `SharedSchemaBuildMissingError`
/ `BUILD_HINT` so the backend never hand-copies enum values.

`getStyleProfileScene` is a function and cannot be serialized by a
constants bridge, so we serialize `BUILT_IN_STYLE_PROFILES` into a
profile-id -> scene map and `DEFAULT_STYLE_PROFILE_ID_BY_SCENE` into a
scene -> default-profile-id map, then look up in Python.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import subprocess

from .shared_schema_adapter import (
    BRIDGE_TIMEOUT_SECONDS,
    BUILD_HINT,
    SharedSchemaBuildMissingError,
    repo_root,
    shared_schema_entrypoint,
)


class SharedSchemaConstantsBridgeError(RuntimeError):
    pass


NODE_CONSTANTS_SCRIPT = r"""
import { pathToFileURL } from "node:url";

const entrypoint = process.argv[1];
const sharedSchema = await import(pathToFileURL(entrypoint).href);

const profileSceneMap = {};
for (const [id, profile] of Object.entries(sharedSchema.BUILT_IN_STYLE_PROFILES)) {
  profileSceneMap[id] = profile.scene;
}

process.stdout.write(
  JSON.stringify({
    SCENES: sharedSchema.SCENES,
    WORKFLOW_STATES: sharedSchema.WORKFLOW_STATES,
    ACTOR_TYPES: sharedSchema.ACTOR_TYPES,
    EVENT_TYPES: sharedSchema.EVENT_TYPES,
    profileSceneMap,
    defaultProfileIdByScene: sharedSchema.DEFAULT_STYLE_PROFILE_ID_BY_SCENE,
  }),
);
"""


@dataclass(frozen=True)
class SharedSchemaConstants:
    scenes: tuple[str, ...]
    workflow_states: tuple[str, ...]
    actor_types: tuple[str, ...]
    event_types: tuple[str, ...]
    # id -> scene, derived from BUILT_IN_STYLE_PROFILES
    profile_scene_map: dict[str, str]
    # scene -> default profile id, from DEFAULT_STYLE_PROFILE_ID_BY_SCENE
    default_profile_id_by_scene: dict[str, str]


def load_shared_schema_constants() -> SharedSchemaConstants:
    """Read shared-schema runtime constants via the Node dist bridge.

    Raises SharedSchemaBuildMissingError when `dist/index.js` is absent
    (reusing the validate bridge's build-missing semantics). This guard only
    covers a missing dist, not a stale one.
    """

    entrypoint = shared_schema_entrypoint()
    if not entrypoint.exists():
        raise SharedSchemaBuildMissingError(f"{BUILD_HINT} Missing file: {entrypoint}")

    try:
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", NODE_CONSTANTS_SCRIPT, str(entrypoint)],
            text=True,
            capture_output=True,
            cwd=repo_root(),
            check=False,
            timeout=BRIDGE_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise SharedSchemaConstantsBridgeError(
            "Node.js is required to load packages/shared-schema/dist/index.js. "
            "Install Node.js 20+ and build shared-schema before running the API."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise SharedSchemaConstantsBridgeError(
            f"shared-schema constants bridge timed out after {BRIDGE_TIMEOUT_SECONDS} seconds"
        ) from exc

    if completed.returncode != 0:
        raise SharedSchemaConstantsBridgeError(
            "shared-schema constants bridge failed with exit code "
            f"{completed.returncode}: {completed.stderr.strip()}"
        )

    try:
        raw = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise SharedSchemaConstantsBridgeError(
            f"shared-schema constants bridge returned invalid JSON: {exc}"
        ) from exc

    return SharedSchemaConstants(
        scenes=tuple(raw["SCENES"]),
        workflow_states=tuple(raw["WORKFLOW_STATES"]),
        actor_types=tuple(raw["ACTOR_TYPES"]),
        event_types=tuple(raw["EVENT_TYPES"]),
        profile_scene_map=dict(raw["profileSceneMap"]),
        default_profile_id_by_scene=dict(raw["defaultProfileIdByScene"]),
    )
