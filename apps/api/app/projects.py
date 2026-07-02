"""Project creation service: scene/style resolution + ownership validation.

Scene/style rules are enforced against the shared-schema-derived, serialized
profile->scene map (via the constants bridge), NOT via a `Presentation` entity
validator — this group adds no shared-schema `Project`.
"""

from __future__ import annotations

import uuid

from .errors import InvalidSceneError, StyleProfileMismatchError
from .repository import Repository, StoredProject
from .shared_schema_constants import SharedSchemaConstants

DEFAULT_SCENE = "default"
INITIAL_STATE = "NEW_PROJECT"


def resolve_scene_and_style(
    scene: str | None,
    style_profile_id: str | None,
    constants: SharedSchemaConstants,
) -> tuple[str, str]:
    """Apply defaults/fallback and validate scene/style ownership.

    - scene omitted -> "default"; scene not in SCENES -> InvalidSceneError.
    - styleProfileId omitted -> the scene's built-in default id.
    - given styleProfileId whose mapped scene != effective scene, OR unknown id
      (absent from the map) -> StyleProfileMismatchError.

    Scene validation precedes style ownership, so if both are invalid the
    caller sees INVALID_SCENE.
    """

    effective_scene = scene if scene is not None else DEFAULT_SCENE

    if effective_scene not in constants.scenes:
        raise InvalidSceneError(f"unknown scene: {effective_scene!r}")

    if style_profile_id is None:
        return effective_scene, constants.default_profile_id_by_scene[effective_scene]

    mapped_scene = constants.profile_scene_map.get(style_profile_id)
    if mapped_scene != effective_scene:
        raise StyleProfileMismatchError(
            f"styleProfileId {style_profile_id!r} does not belong to scene "
            f"{effective_scene!r}"
        )

    return effective_scene, style_profile_id


def create_project(
    repository: Repository,
    constants: SharedSchemaConstants,
    *,
    title: str | None = None,
    initial_request: str | None = None,
    scene: str | None = None,
    style_profile_id: str | None = None,
) -> StoredProject:
    """Validate inputs, then persist a NEW_PROJECT record.

    Validation runs before any write, so a rejected request leaves the
    repository untouched (project count / event sequences unchanged).
    """

    effective_scene, effective_style = resolve_scene_and_style(
        scene, style_profile_id, constants
    )

    project = StoredProject(
        projectId=uuid.uuid4().hex,
        title=title or "",
        initialRequest=initial_request,
        scene=effective_scene,
        styleProfileId=effective_style,
        state=INITIAL_STATE,
    )
    return repository.create_project(project)


def _selfcheck() -> None:
    from .repository import InMemoryRepository
    from .shared_schema_constants import load_shared_schema_constants

    constants = load_shared_schema_constants()
    assert "default" in constants.scenes
    assert "NEW_PROJECT" in constants.workflow_states
    assert "user" in constants.actor_types
    assert constants.profile_scene_map.get("style_education_default") == "education"
    assert constants.default_profile_id_by_scene["default"] == "style_default"

    # defaults / fallback
    assert resolve_scene_and_style(None, None, constants) == ("default", "style_default")
    assert resolve_scene_and_style("education", None, constants) == (
        "education",
        "style_education_default",
    )

    # validation errors
    for bad in [
        (lambda: resolve_scene_and_style("education2", None, constants), InvalidSceneError),
        (
            lambda: resolve_scene_and_style("education", "style_corporate_default", constants),
            StyleProfileMismatchError,
        ),
        (lambda: resolve_scene_and_style("education", "style_foo", constants), StyleProfileMismatchError),
    ]:
        fn, exc_type = bad
        try:
            fn()
        except exc_type:
            pass
        else:
            raise AssertionError(f"expected {exc_type.__name__}")

    # scene precedes style: both invalid -> INVALID_SCENE
    try:
        resolve_scene_and_style("nope", "style_foo", constants)
    except InvalidSceneError:
        pass
    else:
        raise AssertionError("expected InvalidSceneError when both invalid")

    # failed create leaves repository untouched; atomic state change pairs both
    repo = InMemoryRepository()
    try:
        create_project(repo, constants, scene="bad")
    except InvalidSceneError:
        pass
    p = create_project(repo, constants, title="t", scene="education")
    assert p.state == "NEW_PROJECT" and p.styleProfileId == "style_education_default"
    repo.commit_state_change(p.projectId, "REQUIREMENT_DISCOVERY", {"type": "WORKFLOW_STATE_CHANGED"})
    assert p.state == "REQUIREMENT_DISCOVERY" and len(repo.list_events(p.projectId)) == 1
    print("shared_schema_constants + projects selfcheck OK")


if __name__ == "__main__":
    _selfcheck()
