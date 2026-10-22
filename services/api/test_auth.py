import os
import secrets
import uuid
from urllib.parse import urlparse

import psycopg
import pytest
from fastapi import Depends, Request
from fastapi.testclient import TestClient

from main import create_app, require_user, success


@pytest.fixture
def conn():
    """连到本地数据库。没导出 DATABASE_URL 就跳过；不是本地数据库就拒绝运行。"""
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("先在终端里 export DATABASE_URL")
    if urlparse(url).hostname not in ("localhost", "127.0.0.1"):
        pytest.fail(f"测试会写数据库，只允许连本地：{urlparse(url).hostname}")
    with psycopg.connect(url, autocommit=True) as connection:
        yield connection


@pytest.fixture
def test_user(conn):
    """建一个测试用户，测完删掉。删用户时，他的会话会一起被删掉（外键是 ON DELETE CASCADE）。"""
    email = f"pytest-{uuid.uuid4()}@example.com"
    user_id = conn.execute(
        "insert into users (email, password_hash) values (%s, %s) returning id",
        (email, "not-a-real-hash"),
    ).fetchone()[0]
    yield {"id": str(user_id), "email": email}
    conn.execute("delete from users where id = %s", (user_id,))


def insert_session(conn, user_id: str, expires_in: str = "1 day") -> str:
    """给用户插入一条会话，返回 token，也就是 cookie 的值。expires_in 写成 "-1 minute" 就是一条已经过期的会话。"""
    token = secrets.token_urlsafe(32)
    conn.execute(
        "insert into sessions (id, user_id, expires_at) values (%s, %s, now() + %s::interval)",
        (token, user_id, expires_in),
    )
    return token


def make_client() -> TestClient:
    """和 test_main.py 一样，往新应用上加一个只在测试里存在的路由，用来测"必须登录"。"""
    app = create_app()

    @app.get("/api/test/whoami")
    def whoami(request: Request, user: dict = Depends(require_user)):
        return success(request, {"user": user})

    return TestClient(app, raise_server_exceptions=False)

def test_me_without_cookie_returns_null_user(conn):
    response = make_client().get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["data"] == {"user": None}
    
def test_insert_session_then_returns_me(conn, test_user):
    token = insert_session(conn, test_user["id"])
    with make_client() as client:
        client.cookies.set("rag_session", token)
        response = client.get("/api/auth/me")
    assert response.status_code == 200
    body = response.json()
    assert body["data"] == {"user": test_user}
    
def test_whoami_without_cookie_returns_401(conn):
    with make_client() as client:
        response = client.get("/api/test/whoami")
    assert response.status_code == 401
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "Unauthorized"
    assert body["data"] == {"code": "UNAUTHORIZED"}

def test_whoami_with_unknown_session_returns_401(conn):
    with make_client() as client:
        client.cookies.set("rag_session", "not-a-real-session")
        response = client.get("/api/test/whoami")

    assert response.status_code == 401
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "Unauthorized"
    assert body["data"] == {"code": "UNAUTHORIZED"}

def test_expired_session_is_treated_as_logged_out(conn, test_user):
    token = insert_session(
        conn,
        test_user["id"],
        expires_in="-1 minute",
    )
    
    with make_client() as client:
        client.cookies.set("rag_session", token)
        whoami_response = client.get("/api/test/whoami")
        me_response = client.get("/api/auth/me")
    
    assert whoami_response.status_code == 401
    assert whoami_response.json()["data"] == {"code": "UNAUTHORIZED"}

    # me 允许未登录，所以正常返回“没有当前用户”
    assert me_response.status_code == 200
    assert me_response.json()["ok"] is True
    assert me_response.json()["data"] == {"user": None}

def test_whoami_with_valid_session_returns_user(conn, test_user):
    token = insert_session(conn, test_user["id"])

    with make_client() as client:
        client.cookies.set("rag_session", token)
        response = client.get("/api/test/whoami")

    assert response.status_code == 200

    body = response.json()
    assert body["ok"] is True
    assert body["data"] == {"user": test_user}