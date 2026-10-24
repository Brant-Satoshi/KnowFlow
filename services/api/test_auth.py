import os
import secrets
import uuid
from urllib.parse import urlparse

import psycopg
import pytest
from fastapi import Depends, Request
from fastapi.testclient import TestClient

from main import create_app, require_user, success
from test_password import TS_HASH


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


LOGIN_PASSWORD = "correct horse"  # TS_HASH 对应的明文密码


@pytest.fixture
def login_user(conn):
    """建一个能真正登录的用户，密码是 "correct horse"（哈希由 TS 版生成），测完删掉；登录产生的会话随用户一起删除。"""
    email = f"pytest-{uuid.uuid4()}@example.com"
    user_id = conn.execute(
        "insert into users (email, password_hash) values (%s, %s) returning id",
        (email, TS_HASH),
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


def login(client: TestClient, email: str, password: str):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def assert_bad_credentials(response):
    assert response.status_code == 401
    body = response.json()
    assert body["ok"] is False
    assert body["data"] == {"code": "BAD_CREDENTIALS"}


def test_login_returns_user_and_sets_cookie(login_user):
    with make_client() as client:
        response = login(client, login_user["email"], LOGIN_PASSWORD)
    assert response.status_code == 200
    assert response.json()["data"] == {"user": login_user}
    assert response.cookies.get("rag_session")


def test_login_session_works_for_me(login_user):
    # 同一个客户端会把登录拿到的 cookie 带到下一个请求：能查到用户，说明会话真的写进了数据库
    with make_client() as client:
        login(client, login_user["email"], LOGIN_PASSWORD)
        response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json()["data"] == {"user": login_user}


def test_login_wrong_password_returns_401(login_user):
    with make_client() as client:
        response = login(client, login_user["email"], "wrong horse")

    assert_bad_credentials(response)


def test_login_unknown_email_looks_like_wrong_password(login_user):
    with make_client() as client:
        wrong_password = login(client, login_user["email"], "wrong horse")
        unknown_email = login(client, f"pytest-{uuid.uuid4()}@example.com", LOGIN_PASSWORD)

    assert_bad_credentials(unknown_email)
    # 除了每次都不同的 requestId，两个响应必须一模一样，否则就能借此判断邮箱是否注册过
    wrong_body, unknown_body = wrong_password.json(), unknown_email.json()
    del wrong_body["requestId"], unknown_body["requestId"]
    assert unknown_email.status_code == wrong_password.status_code
    assert unknown_body == wrong_body


def test_login_email_is_case_insensitive(login_user):
    with make_client() as client:
        response = login(client, login_user["email"].upper(), LOGIN_PASSWORD)

    assert response.status_code == 200
    # 返回的是数据库里存的邮箱，不是请求里的大写写法
    assert response.json()["data"] == {"user": login_user}


@pytest.mark.parametrize(
    "make_body",
    [
        lambda email: {"email": email, "password": "short"},
        lambda email: {"password": LOGIN_PASSWORD},
        lambda email: [email, LOGIN_PASSWORD],
    ],
    ids=["password-too-short", "missing-email", "array-body"],
)
def test_login_invalid_content_returns_401(login_user, make_body):
    # 用 lambda 是因为 parametrize 拿不到 fixture，要等测试运行时再填入 login_user 的邮箱
    with make_client() as client:
        response = client.post("/api/auth/login", json=make_body(login_user["email"]))

    assert_bad_credentials(response)


def test_login_invalid_json_returns_400(conn):
    with make_client() as client:
        response = client.post(
            "/api/auth/login",
            content="{bad json",
            headers={"content-type": "application/json"},
        )

    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "invalid_request"


def test_logout_then_me_returns_null_user(login_user):
    with make_client() as client:
        login(client, login_user["email"], LOGIN_PASSWORD)
        logout_response = client.post("/api/auth/logout")
        # 服务器清除 cookie 时会发一个 Max-Age=0 的同名 cookie，测试客户端收到后就把它删掉
        cookie_cleared = "rag_session" not in client.cookies
        me_response = client.get("/api/auth/me")

    assert logout_response.status_code == 200
    assert logout_response.json()["data"] == {"ok": True}
    assert cookie_cleared
    # 只删 cookie 或只删会话，/me 都会返回 None，所以会话有没有真的删掉要靠下一个测试
    assert me_response.json()["data"] == {"user": None}


def test_logout_deletes_session_row(conn, login_user):
    def session_exists(token: str) -> bool:
        return conn.execute("select 1 from sessions where id = %s", (token,)).fetchone() is not None

    with make_client() as client:
        token = login(client, login_user["email"], LOGIN_PASSWORD).cookies["rag_session"]
        # 先确认登录真的写进了这条会话，否则下面"已删除"的断言什么都证明不了
        assert session_exists(token)
        client.post("/api/auth/logout")

    assert not session_exists(token)


def test_logout_without_login_returns_200(conn):
    with make_client() as client:
        response = client.post("/api/auth/logout")

    assert response.status_code == 200
    assert response.json()["data"] == {"ok": True}