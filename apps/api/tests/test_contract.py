"""Phase 2 contract tests (group D, tasks 7.1-7.6).

Each `#### 场景:` block in the change specs (project-lifecycle-api,
workflow-state-machine, event-log, api-error-and-validation-contract) maps to a
test below. Tests drive the real FastAPI app through TestClient so routing and
the registered exception handlers are exercised end to end.
"""

from __future__ import annotations

import pytest

from app.events import EventValidationError, validate_state_change_event
from app.repository import InMemoryRepository
from app.routes import get_constants
from app.workflow import backend_known_states


def _create(client, body):
    return client.post("/api/projects", json=body)


def _project_count(repo: InMemoryRepository) -> int:
    return len(repo._projects)


# --------------------------------------------------------------------------- #
# 7.1 项目创建/读取
# --------------------------------------------------------------------------- #


def test_create_with_valid_input(client):
    # 场景:使用合法输入创建项目
    resp = _create(client, {"title": "Deck", "scene": "education"})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "NEW_PROJECT"
    assert data["projectId"]


def test_create_applies_defaults_when_scene_and_style_omitted(client):
    # 场景:省略场景与风格时应用默认
    resp = _create(client, {})
    assert resp.status_code == 200, resp.text
    pid = resp.json()["projectId"]

    got = client.get(f"/api/projects/{pid}").json()
    assert got["scene"] == "default"
    assert got["styleProfileId"] == "style_default"


def test_empty_body_creates_default_project(client):
    # 场景:空请求体创建默认项目
    resp = client.post("/api/projects", content=b"{}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "NEW_PROJECT"
    got = client.get(f"/api/projects/{data['projectId']}").json()
    assert got["scene"] == "default"
    assert got["styleProfileId"] == "style_default"
    assert got["title"] == ""


def test_get_existing_project(client):
    # 场景:读取已存在项目
    pid = _create(client, {"title": "T", "scene": "education"}).json()["projectId"]
    resp = client.get(f"/api/projects/{pid}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["projectId"] == pid
    assert data["title"] == "T"
    assert data["scene"] == "education"
    assert data["styleProfileId"] == "style_education_default"
    assert data["status"] == "NEW_PROJECT"


def test_get_missing_project_returns_project_not_found(client):
    # 场景:读取不存在项目
    resp = client.get("/api/projects/does-not-exist")
    assert resp.status_code == 404, resp.text
    data = resp.json()
    assert data["error"] == "NOT_FOUND"
    assert data["code"] == "PROJECT_NOT_FOUND"


# --------------------------------------------------------------------------- #
# 7.2 非法创建（错误码 + 无副作用：项目数 / 事件序列长度不变）
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "body,code",
    [
        ({"scene": "education2"}, "INVALID_SCENE"),
        ({"scene": "education", "styleProfileId": "style_corporate_default"}, "STYLE_PROFILE_MISMATCH"),
        ({"scene": "education", "styleProfileId": "style_foo"}, "STYLE_PROFILE_MISMATCH"),
    ],
)
def test_invalid_create_rejected_with_no_side_effects(client, repo, body, code):
    assert _project_count(repo) == 0
    resp = _create(client, body)
    assert resp.status_code == 400, resp.text
    data = resp.json()
    assert data["error"] == "VALIDATION_ERROR"
    assert data["code"] == code
    # No project record created.
    assert _project_count(repo) == 0


def test_scene_validation_precedes_style_ownership(client):
    # 两者同时不满足 -> INVALID_SCENE（scene 校验先行）
    resp = _create(client, {"scene": "nope", "styleProfileId": "style_foo"})
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_SCENE"


# --------------------------------------------------------------------------- #
# 7.3 状态机（多步前向 + 回退各写事件；未知状态 / 非法边无副作用）
# --------------------------------------------------------------------------- #


def _transition(client, pid, to):
    return client.post(f"/api/projects/{pid}/transitions", json={"to": to})


def test_multi_step_forward_and_backward_each_append_event(client, repo):
    # 场景:多步早期前向序列 + 场景:执行一次合法回退转移
    pid = _create(client, {}).json()["projectId"]
    assert len(repo.list_events(pid)) == 0

    r1 = _transition(client, pid, "REQUIREMENT_DISCOVERY")
    assert r1.status_code == 200 and r1.json()["status"] == "REQUIREMENT_DISCOVERY"
    assert len(repo.list_events(pid)) == 1

    r2 = _transition(client, pid, "REQUIREMENT_REVIEW")
    assert r2.status_code == 200 and r2.json()["status"] == "REQUIREMENT_REVIEW"
    assert len(repo.list_events(pid)) == 2

    # rollback edge REQUIREMENT_REVIEW -> REQUIREMENT_DISCOVERY
    r3 = _transition(client, pid, "REQUIREMENT_DISCOVERY")
    assert r3.status_code == 200 and r3.json()["status"] == "REQUIREMENT_DISCOVERY"
    assert len(repo.list_events(pid)) == 3
    assert repo.get_project(pid).state == "REQUIREMENT_DISCOVERY"


def test_unknown_state_string_rejected_no_side_effect(client, repo):
    # 场景:未知目标状态字符串被拒绝
    pid = _create(client, {}).json()["projectId"]
    before_state = repo.get_project(pid).state
    resp = _transition(client, pid, "BOGUS_STATE")
    assert resp.status_code == 400, resp.text
    data = resp.json()
    assert data["error"] == "VALIDATION_ERROR"
    assert data["code"] == "INVALID_WORKFLOW_STATE"
    assert repo.get_project(pid).state == before_state
    assert len(repo.list_events(pid)) == 0


def test_known_state_illegal_edge_rejected_no_side_effect(client, repo):
    # 场景:已知状态间的非法边被拒绝
    pid = _create(client, {}).json()["projectId"]  # NEW_PROJECT
    resp = _transition(client, pid, "EXPORTED")
    assert resp.status_code == 409, resp.text
    data = resp.json()
    assert data["error"] == "STATE_ERROR"
    assert data["code"] == "INVALID_STATE_TRANSITION"
    assert repo.get_project(pid).state == "NEW_PROJECT"
    assert len(repo.list_events(pid)) == 0


def test_late_stage_edge_needing_content_is_illegal(client, repo):
    # 场景:进入需要内容的后段状态不属于本期合法边
    pid = _create(client, {}).json()["projectId"]
    _transition(client, pid, "REQUIREMENT_DISCOVERY")
    _transition(client, pid, "REQUIREMENT_REVIEW")
    events_before = len(repo.list_events(pid))
    resp = _transition(client, pid, "OUTLINE_GENERATION")
    assert resp.status_code == 409
    assert resp.json()["code"] == "INVALID_STATE_TRANSITION"
    assert repo.get_project(pid).state == "REQUIREMENT_REVIEW"
    assert len(repo.list_events(pid)) == events_before


# --------------------------------------------------------------------------- #
# 7.4 转移 API（合法/非法 + 错误优先级）
# --------------------------------------------------------------------------- #


def test_api_legal_transition_advances_and_returns_state(client, repo):
    # 场景:通过 API 执行合法转移
    pid = _create(client, {}).json()["projectId"]
    resp = _transition(client, pid, "REQUIREMENT_DISCOVERY")
    assert resp.status_code == 200
    assert resp.json()["status"] == "REQUIREMENT_DISCOVERY"
    assert len(repo.list_events(pid)) == 1


def test_precedence_nonexistent_project_with_illegal_to_returns_not_found(client):
    # 错误优先级:项目存在性 先于 状态校验
    resp = _transition(client, "ghost", "EXPORTED")
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "PROJECT_NOT_FOUND"


def test_precedence_missing_body_before_project_existence(client):
    # 错误优先级:请求体解析 先于 项目存在性 / 状态校验
    # 对不存在项目发缺失 to 的请求体，应先返回 INVALID_REQUEST_BODY
    resp = client.post("/api/projects/ghost/transitions", json={})
    assert resp.status_code == 400, resp.text
    data = resp.json()
    assert data["error"] == "VALIDATION_ERROR"
    assert data["code"] == "INVALID_REQUEST_BODY"


def test_transition_missing_to_returns_invalid_request_body(client, repo):
    # 场景:转移请求体缺失 to
    pid = _create(client, {}).json()["projectId"]
    resp = client.post(f"/api/projects/{pid}/transitions", json={})
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == "INVALID_REQUEST_BODY"
    assert len(repo.list_events(pid)) == 0


# --------------------------------------------------------------------------- #
# 7.5 事件（WORKFLOW_STATE_CHANGED 通过 validateEvent；失败动作不增事件）
# --------------------------------------------------------------------------- #


def test_transition_writes_valid_workflow_state_changed_event(client, repo):
    # 场景:合法状态转移写入事件
    pid = _create(client, {}).json()["projectId"]
    _transition(client, pid, "REQUIREMENT_DISCOVERY")
    events = repo.list_events(pid)
    assert len(events) == 1
    event = events[0]
    assert event["type"] == "WORKFLOW_STATE_CHANGED"
    assert event["actor"] == "user"
    assert event["payload"] == {
        "previousState": "NEW_PROJECT",
        "nextState": "REQUIREMENT_DISCOVERY",
    }
    # payload actor is NOT duplicated inside payload (producer-side invariant)
    assert "actor" not in event["payload"]
    # stored event actually passes shared-schema validateEvent
    validate_state_change_event(event)  # raises EventValidationError on failure


def test_failed_action_leaves_event_sequence_length_unchanged(client, repo):
    # 场景:失败动作不产生事件
    pid = _create(client, {}).json()["projectId"]
    _transition(client, pid, "REQUIREMENT_DISCOVERY")
    length_before = len(repo.list_events(pid))

    # illegal edge
    _transition(client, pid, "EXPORTED")
    # unknown state string
    _transition(client, pid, "BOGUS_STATE")
    # malformed body
    client.post(f"/api/projects/{pid}/transitions", json={})

    assert len(repo.list_events(pid)) == length_before


# --------------------------------------------------------------------------- #
# 7.6 错误约定（畸形请求体 -> 统一结构，非默认 422）
# --------------------------------------------------------------------------- #


def test_missing_body_rejected_as_invalid_request_body(client, repo):
    # 场景:缺失或非 JSON 请求体被拒绝（区别于空 {} 成功）
    resp = client.post("/api/projects", content=b"")
    assert resp.status_code == 400, resp.text
    data = resp.json()
    assert data["error"] == "VALIDATION_ERROR"
    assert data["code"] == "INVALID_REQUEST_BODY"
    assert _project_count(repo) == 0


def test_malformed_json_body_returns_unified_structure_not_default_422(client, repo):
    # 场景:畸形请求体返回统一结构
    resp = client.post(
        "/api/projects",
        content=b"{not-json",
        headers={"content-type": "application/json"},
    )
    assert resp.status_code == 400, resp.text
    data = resp.json()
    # unified {error, code, details} — NOT FastAPI's default `detail` array
    assert set(data) >= {"error", "code", "details"}
    assert "detail" not in data
    assert data["error"] == "VALIDATION_ERROR"
    assert data["code"] == "INVALID_REQUEST_BODY"
    assert isinstance(data["details"], dict)
    assert _project_count(repo) == 0


def test_non_object_json_body_rejected(client):
    # JSON 数组/标量不是对象 -> INVALID_REQUEST_BODY
    resp = client.post("/api/projects", json=[1, 2, 3])
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_REQUEST_BODY"


def test_health_unchanged(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_unknown_route_returns_neutral_not_found_not_business_code(client):
    # Framework 404 (unknown route) must NOT reuse the business PROJECT_NOT_FOUND.
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404, resp.text
    data = resp.json()
    assert data["error"] == "NOT_FOUND"
    assert data["code"] == "RESOURCE_NOT_FOUND"


def test_disallowed_method_returns_neutral_http_error(client):
    # Framework 405 (method not allowed) maps to the neutral HTTP_ERROR code,
    # never a business code, with a status/class-consistent response.
    resp = client.delete("/api/projects/does-not-matter")
    assert resp.status_code == 405, resp.text
    assert resp.json()["code"] == "HTTP_ERROR"


def test_unexpected_exception_returns_unified_500(monkeypatch):
    # An unexpected (non-domain, non-framework) error must still honor the
    # unified {error,code,details} contract via the catch-all handler.
    from starlette.testclient import TestClient

    import app.routes as routes_module
    from app.main import app

    def _boom(*_args, **_kwargs):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(routes_module, "create_project", _boom)
    # raise_server_exceptions=False so the 500 response is returned, not re-raised.
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/projects", json={})
    assert resp.status_code == 500, resp.text
    data = resp.json()
    assert data["error"] == "INTERNAL_ERROR"
    assert data["code"] == "INTERNAL_ERROR"


def test_backend_known_states_match_shared_schema_exact_set():
    # spec 3.4: backend recognises exactly the 12 shared-schema WORKFLOW_STATES.
    expected = {
        "NEW_PROJECT",
        "REQUIREMENT_DISCOVERY",
        "REQUIREMENT_REVIEW",
        "OUTLINE_GENERATION",
        "OUTLINE_REVIEW",
        "SLIDE_PLANNING",
        "SLIDE_PLAN_REVIEW",
        "SLIDE_GENERATION",
        "EDITING",
        "REVIEW",
        "EXPORT_READY",
        "EXPORTED",
    }
    assert backend_known_states(get_constants()) == expected


def test_validate_state_change_event_rejects_malformed_payload():
    # Negative path: a non-WORKFLOW_STATES payload must be rejected by the
    # shared-schema bridge, raising EventValidationError before any commit.
    from app.events import build_state_change_event

    event = build_state_change_event("p1", "BOGUS", "ALSO_BOGUS", actor="user")
    with pytest.raises(EventValidationError):
        validate_state_change_event(event)
