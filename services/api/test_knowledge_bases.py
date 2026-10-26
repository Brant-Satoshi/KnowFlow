import re
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from main import create_app
from testdata import add_member, insert_knowledge_base, insert_session, insert_user, insert_workspace


@pytest.fixture
def tenants(conn):
    """两个互不相干的租户，加一个被邀请进 alice 工作区的普通成员 carol：

    - alice：自己的工作区里有知识库 kb_alice
    - bob：自己的工作区里有知识库 kb_bob
    - carol：没有自己的工作区，是 alice 工作区的 member

    测完删掉三个用户，工作区、成员关系、知识库随外键一起删掉。
    """
    alice, bob, carol = insert_user(conn), insert_user(conn), insert_user(conn)
    alice_ws = insert_workspace(conn, alice["id"])
    bob_ws = insert_workspace(conn, bob["id"])
    add_member(conn, alice_ws, carol["id"], role="member")
    data = {
        "alice": alice,
        "bob": bob,
        "carol": carol,
        "kb_alice": insert_knowledge_base(conn, alice_ws, alice["id"], "Alice 的知识库", "测试用"),
        "kb_bob": insert_knowledge_base(conn, bob_ws, bob["id"], "Bob 的知识库"),
    }
    yield data
    conn.execute(
        "delete from users where id = any(%s)",
        ([alice["id"], bob["id"], carol["id"]],),
    )


def client_for(conn, user: dict) -> TestClient:
    """以某个用户的身份发请求：给他插入一条会话，把 token 设成 cookie。"""
    client = TestClient(create_app(), raise_server_exceptions=False)
    client.cookies.set("rag_session", insert_session(conn, user["id"]))
    return client


def test_owner_can_get_own_knowledge_base(conn, tenants):
    client = client_for(conn, tenants["alice"])
    response = client.get(f"/api/knowledge-bases/{tenants['kb_alice']}")
    assert response.status_code == 200
    knowledge_base = response.json()["data"]["knowledgeBase"]
    assert knowledge_base["id"] == tenants["kb_alice"]
    assert knowledge_base["name"] == "Alice 的知识库"

# 2. bob 查看 kb_alice → 404 "Knowledge base not found"
def test_bob_view_kb_alice(conn, tenants):
    client = client_for(conn, tenants["bob"])
    response = client.get(f"/api/knowledge-bases/{tenants['kb_alice']}")
    assert response.status_code == 404
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "Knowledge base not found"

# 3. alice 查看一个不存在的 UUID → 404，除了 requestId，和第 2 条完全一样
def test_missing_kb_looks_like_other_tenants_kb(conn, tenants):
    other_tenant = client_for(conn, tenants["bob"]).get(f"/api/knowledge-bases/{tenants['kb_alice']}")
    missing = client_for(conn, tenants["alice"]).get(f"/api/knowledge-bases/{uuid.uuid4()}")
    assert missing.status_code == 404
    # "不存在"和"不是你的"必须分不出来，否则 bob 就能借此判断某个知识库 id 是否存在
    other_body, missing_body = other_tenant.json(), missing.json()
    del other_body["requestId"], missing_body["requestId"]
    assert missing.status_code == other_tenant.status_code
    assert missing_body == other_body

# 4. id 不是 UUID（比如 "not-a-uuid"）→ 400
def test_non_uuid_id_returns_400(conn, tenants):
    client = client_for(conn, tenants["alice"])
    response = client.get(f"/api/knowledge-bases/not-a-uuid")
    assert response.status_code == 400


# 5. carol（alice 工作区的 member）查看 kb_alice → 200
def test_member_can_get_workspace_kb(conn, tenants):
    client = client_for(conn, tenants["carol"])
    response = client.get(f"/api/knowledge-bases/{tenants['kb_alice']}")
    assert response.status_code == 200
    knowledge_base = response.json()["data"]["knowledgeBase"]
    assert knowledge_base["id"] == tenants["kb_alice"]
    assert knowledge_base["name"] == "Alice 的知识库"


# 6. 没登录查看 kb_alice → 401，data 是 {"code": "UNAUTHORIZED"}
def test_anonymous_gets_401(tenants):
    # 不用 client_for：它会插入会话、带上 cookie，这里要的是一个什么都没带的客户端
    client = TestClient(create_app(), raise_server_exceptions=False)
    response = client.get(f"/api/knowledge-bases/{tenants['kb_alice']}")
    assert response.status_code == 401
    assert response.json()["data"] == {"code": "UNAUTHORIZED"}


# 7. 返回格式（按你对第 3 个设计问题的决定）：键名、时间格式、description 为空时怎么返回
ISO_UTC_MILLIS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")  # JS toISOString() 的格式


def test_kb_response_keys_and_time_format(conn, tenants):
    client = client_for(conn, tenants["alice"])
    response = client.get(f"/api/knowledge-bases/{tenants['kb_alice']}")
    knowledge_base = response.json()["data"]["knowledgeBase"]

    # 和 TS 版 toKnowledgeBase 一致：驼峰键名；查看单个知识库时没有 chunkCount
    assert set(knowledge_base) == {"id", "name", "description", "createdAt", "updatedAt"}
    assert knowledge_base["description"] == "测试用"

    created_at, updated_at = conn.execute(
        "select created_at, updated_at from knowledge_bases where id = %s",
        (tenants["kb_alice"],),
    ).fetchone()
    for key, db_value in (("createdAt", created_at), ("updatedAt", updated_at)):
        text = knowledge_base[key]
        assert ISO_UTC_MILLIS.match(text), text
        # 只检查格式不够：时区换算错了，格式照样对。数据库存到微秒，返回值截断到毫秒，所以两者相差不到 1 毫秒
        assert timedelta(0) <= db_value - datetime.fromisoformat(text) < timedelta(milliseconds=1)


def test_kb_without_description_omits_key(conn, tenants):
    client = client_for(conn, tenants["bob"])
    response = client.get(f"/api/knowledge-bases/{tenants['kb_bob']}")
    knowledge_base = response.json()["data"]["knowledgeBase"]
    # kb_bob 的 description 是 NULL：和 TS 版一样，不返回这个键，而不是返回 null
    assert "description" not in knowledge_base
