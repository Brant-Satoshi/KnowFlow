import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from main import create_app
    
class Item(BaseModel):
    name: str
    
def make_client() -> TestClient:
    app = create_app()

    @app.get("/api/test/conflict")
    def conflict(): 
        raise HTTPException(status_code=409, detail="File is already being parsed")
    
    @app.post("/api/test/items")
    def create_item(item: Item):
        return {"ok": True}

    @app.get("/api/test/boom")
    def boom():
        raise RuntimeError("database password is secret123")
    
    # 像真实服务器一样，把未捕获的异常变成 500 响应，而不是在测试里直接抛出
    return  TestClient(app, raise_server_exceptions=False)

def test_health_returns_envelope():
    client = TestClient(create_app())
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"] == {"status": "ok"}
    uuid.UUID(body["requestId"])  # requestId 不是合法的 UUID 时会直接报错

def test_nope_returns():
    client = TestClient(create_app())
    response = client.get("/api/nope")
    assert response.status_code == 404
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "Not Found"

def test_conflict():
    client = make_client()
    response = client.get("/api/test/conflict")
    assert response.status_code == 409
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "File is already being parsed"

def test_validation_error_hides_input():
    client = make_client()
    response = client.post("/api/test/items", json={"name": 12345})
    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert "name" in body["error"]
    assert "12345" not in response.text  # 检查整个响应体，不只是 error 字段

def test_malformed_json_returns_invalid_request():
    client = make_client()
    response = client.post(
        "/api/test/items",
        content="不是 JSON",
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "invalid_request"

def test_missing_body_returns_invalid_request():
    client = make_client()
    response = client.post("/api/test/items")  # 不带请求体
    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "invalid_request"  # 与 KnowFlow 一致：空请求体 req.json() 会抛错 → parseJsonBody 返回 400

def test_uncaught_exception_returns_internal_error():
    client = make_client()
    response = client.get("/api/test/boom")
    assert response.status_code == 500
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "internal_error"
    assert "secret123" not in response.text

def test_uncaught_exception_logs_request_id(caplog):
    client = make_client()
    response = client.get("/api/test/boom")
    request_id = response.json()["requestId"]
    assert request_id in caplog.text  # 用户拿响应里的 requestId 来报错时，能在日志里找到这次请求

@pytest.mark.parametrize(
    ("method", "path", "kwargs"),
    [
        ("GET", "/api/health", {}),
        ("GET", "/api/nope", {}),
        ("GET", "/api/test/conflict", {}),
        ("POST", "/api/test/items", {"json": {"name": 12345}}),
        ("POST", "/api/test/items", {"content": "不是 JSON", "headers": {"content-type": "application/json"}}),
        ("GET", "/api/test/boom", {}),
    ],
    ids=["health", "not-found", "http-exception", "validation", "malformed-json", "uncaught"],
)
def test_request_id_header_matches_body(method, path, kwargs):
    response = make_client().request(method, path, **kwargs)
    assert response.headers["x-request-id"] == response.json()["requestId"]

def test_request_id_differs_between_requests():
    client = make_client()
    first = client.get("/api/health").json()["requestId"]
    second = client.get("/api/health").json()["requestId"]
    assert first != second