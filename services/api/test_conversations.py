import uuid

import pytest

from main import (
    MAX_HISTORY_MESSAGES,
    ApiError,
    list_recent_messages,
    require_conversation_access,
)
from testdata import insert_conversation, insert_message

# 会话访问检查和读对话历史（学习日 3 的决定：历史按会话 id 从数据库读，不由请求带进来）。
# 这两个函数还没有接口在用，所以直接调用函数，不走 HTTP。


def test_owner_can_access_own_conversation(conn, tenants):
    conversation_id = insert_conversation(conn, tenants["kb_alice"])
    conversation = require_conversation_access(
        conn, uuid.UUID(conversation_id), tenants["alice"]["id"]
    )
    # 返回会话所在的知识库：接口要用它核对请求里的知识库是不是同一个
    assert conversation == {"id": conversation_id, "knowledgeBaseId": tenants["kb_alice"]}


def test_workspace_member_can_access_conversation(conn, tenants):
    # 会话没有“属于谁”这一列：能访问知识库的人都能访问它里面的会话，和 TS 版一样
    conversation_id = insert_conversation(conn, tenants["kb_alice"])
    conversation = require_conversation_access(
        conn, uuid.UUID(conversation_id), tenants["carol"]["id"]
    )
    assert conversation["id"] == conversation_id


def test_other_tenant_gets_404(conn, tenants):
    conversation_id = insert_conversation(conn, tenants["kb_alice"])
    with pytest.raises(ApiError) as caught:
        require_conversation_access(conn, uuid.UUID(conversation_id), tenants["bob"]["id"])
    assert (caught.value.status, caught.value.message) == (404, "Conversation not found")


def test_missing_conversation_looks_like_other_tenants(conn, tenants):
    # “不存在”和“不是你的”必须分不出来，否则 bob 能借此判断某个会话 id 是否存在
    with pytest.raises(ApiError) as caught:
        require_conversation_access(conn, uuid.uuid4(), tenants["alice"]["id"])
    assert (caught.value.status, caught.value.message) == (404, "Conversation not found")


def test_history_is_oldest_first_with_role_and_content_only(conn, tenants):
    conversation_id = insert_conversation(conn, tenants["kb_alice"])
    # 故意先插入晚的那条：顺序要看时间，不看插入的先后
    insert_message(conn, conversation_id, "assistant", "埃琳娜·科瓦奇博士 [1]", seconds_ago=10)
    insert_message(conn, conversation_id, "user", "首席研究员是谁？", seconds_ago=20)
    history = list_recent_messages(conn, uuid.UUID(conversation_id))
    assert history == [
        {"role": "user", "content": "首席研究员是谁？"},
        {"role": "assistant", "content": "埃琳娜·科瓦奇博士 [1]"},
    ]


def test_history_keeps_only_the_most_recent_messages(conn, tenants):
    conversation_id = insert_conversation(conn, tenants["kb_alice"])
    total = MAX_HISTORY_MESSAGES + 2
    for i in range(total):  # 第 0 条最早
        role = "user" if i % 2 == 0 else "assistant"
        insert_message(conn, conversation_id, role, f"第 {i} 条", seconds_ago=total - i)
    history = list_recent_messages(conn, uuid.UUID(conversation_id))
    # 丢掉最早的 2 条，留下的仍然从早到晚
    assert [message["content"] for message in history] == [
        f"第 {i} 条" for i in range(2, total)
    ]


def test_empty_conversation_has_no_history(conn, tenants):
    conversation_id = insert_conversation(conn, tenants["kb_alice"])
    assert list_recent_messages(conn, uuid.UUID(conversation_id)) == []


def test_history_excludes_other_conversations(conn, tenants):
    mine = insert_conversation(conn, tenants["kb_alice"])
    other = insert_conversation(conn, tenants["kb_alice"])
    insert_message(conn, mine, "user", "我的问题")
    insert_message(conn, other, "user", "另一个会话的问题")
    history = list_recent_messages(conn, uuid.UUID(mine))
    assert history == [{"role": "user", "content": "我的问题"}]
