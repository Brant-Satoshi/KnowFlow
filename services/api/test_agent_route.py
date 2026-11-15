import json
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent import REFUSAL_TEXT_ZH
from chat import ChatFailed
from main import create_app, get_chat, get_embed_query, get_rerank
from test_agent import ScriptedModel, answer_reply, raw_tool_reply, tool_reply
from test_search import at_angle, fake_embed
from testdata import (
    client_for,
    insert_chunk,
    insert_conversation,
    insert_file,
    insert_knowledge_base,
    insert_message,
    padded_vector,
)

# POST /api/chat/agent：模型是假的，检索走真的数据库（召回 + 重排），重排换成“保持召回顺序”。
# 循环本身的规则在 test_agent.py 里测，这里只测接口这一层：登录、知识库、会话、历史、返回格式。

URL = "/api/chat/agent"


def keep_order(query, documents, top_n):
    """假重排：保持召回顺序，分数依次递减。"""
    return [(index, 1.0 - index * 0.1) for index in range(min(top_n, len(documents)))]


def agent_client(conn, user, model, embed=None):
    """以 user 的身份发请求的客户端：模型、问题转向量、重排都换成假的。返回 (客户端, embedding 收到的检索词)。"""
    client = client_for(conn, user)
    embed_calls = []
    if embed is None:
        embed, embed_calls = fake_embed(padded_vector(1, 0))
    overrides = cast(FastAPI, client.app).dependency_overrides
    overrides[get_embed_query] = lambda: embed
    overrides[get_rerank] = lambda: keep_order
    overrides[get_chat] = lambda: model
    return client, embed_calls


# ---------- 谁能调用 ----------


def test_anonymous_gets_401(tenants):
    client = TestClient(create_app(), raise_server_exceptions=False)
    response = client.post(URL, json={"message": "首席研究员是谁？", "knowledgeBaseId": tenants["kb_alice"]})
    assert response.status_code == 401
    assert response.json()["data"] == {"code": "UNAUTHORIZED"}


def test_other_tenants_knowledge_base_is_404_and_costs_nothing(conn, tenants):
    model = ScriptedModel([])
    client, embed_calls = agent_client(conn, tenants["bob"], model)
    response = client.post(URL, json={"message": "首席研究员是谁？", "knowledgeBaseId": tenants["kb_alice"]})
    assert response.status_code == 404
    assert response.json()["error"] == "Knowledge base not found"
    # 没有权限的请求不调用模型，也不调用 embedding
    assert model.received == []
    assert embed_calls == []


def test_bad_requests_are_400_before_any_model_call(conn, tenants):
    kb = tenants["kb_alice"]
    cases = [
        ({}, "Message is required"),
        ({"message": "   ", "knowledgeBaseId": kb}, "Message is required"),
        ({"message": "问题"}, "knowledgeBaseId is required"),
        ({"message": "问题", "knowledgeBaseId": 5}, "knowledgeBaseId must be a string"),
        ({"message": "问题", "knowledgeBaseId": "not-a-uuid"}, "Invalid knowledgeBaseId"),
        ({"message": "问题", "knowledgeBaseId": kb, "conversationId": "not-a-uuid"}, "Invalid conversationId"),
        ({"message": "问题", "knowledgeBaseId": kb, "conversationId": 5}, "Invalid conversationId"),
    ]
    model = ScriptedModel([])
    client, _ = agent_client(conn, tenants["alice"], model)
    for body, error in cases:
        response = client.post(URL, json=body)
        assert (response.status_code, response.json()["error"]) == (400, error), body
    assert model.received == []


# ---------- 回答、引用、每一步的记录 ----------


def test_answer_citations_and_steps(conn, tenants):
    file_id = insert_file(conn, tenants["kb_alice"], "olympus.md")
    near = insert_chunk(conn, file_id, 0, at_angle(0), text="首席研究员是埃琳娜·科瓦奇博士。")
    insert_chunk(conn, file_id, 1, at_angle(30), text="初始资金是 4.2 亿信用点。")
    model = ScriptedModel(
        [tool_reply(("call_1", "首席研究员")), answer_reply("埃琳娜·科瓦奇博士 [1]")]
    )
    client, embed_calls = agent_client(conn, tenants["alice"], model)

    response = client.post(URL, json={"message": "首席研究员是谁？", "knowledgeBaseId": tenants["kb_alice"]})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    data = body["data"]
    assert set(data) == {"answer", "citations", "refusal", "completed", "stopReason", "steps"}
    assert data["answer"] == "埃琳娜·科瓦奇博士 [1]"
    assert data["refusal"] is None
    assert data["completed"] is True
    assert data["stopReason"] == "answered"
    # 引用里是完整的片段，格式和 /api/rag/search 返回的一样
    assert [citation["number"] for citation in data["citations"]] == [1]
    chunk = data["citations"][0]["chunk"]
    assert chunk["id"] == near
    assert chunk["fileName"] == "olympus.md"
    assert chunk["text"] == "首席研究员是埃琳娜·科瓦奇博士。"
    assert data["steps"] == [
        {"type": "model_call", "toolChoice": "required", "result": "tool_calls"},
        {"type": "tool_call", "id": "call_1", "query": "首席研究员", "found": 2},
        {"type": "model_call", "toolChoice": "auto", "result": "answer"},
    ]
    # 拿去检索的是模型写的检索词，不是用户的原话
    assert embed_calls == ["首席研究员"]
    # 模型第 2 次被调用时看到的检索结果：带编号的片段正文
    tool_message = model.received[1][-1]["content"]
    assert "[1] 首席研究员是埃琳娜·科瓦奇博士。" in tool_message
    assert "[2] 初始资金是 4.2 亿信用点。" in tool_message


def test_model_cannot_search_another_knowledge_base(conn, tenants):
    alice_file = insert_file(conn, tenants["kb_alice"], "alice.md")
    bob_file = insert_file(conn, tenants["kb_bob"], "bob.md")
    insert_chunk(conn, alice_file, 0, at_angle(30), text="alice 的资料")
    # bob 的片段离问题更近：只要查错了知识库，它一定排在第一个
    insert_chunk(conn, bob_file, 0, at_angle(0), text="bob 的资料")
    arguments = json.dumps(
        {"query": "资料", "knowledgeBaseId": tenants["kb_bob"], "knowledge_base_id": tenants["kb_bob"]}
    )
    model = ScriptedModel(
        [raw_tool_reply(("call_1", "search_knowledge_base", arguments)), answer_reply("见 [1]")]
    )
    client, _ = agent_client(conn, tenants["alice"], model)

    response = client.post(URL, json={"message": "有什么资料？", "knowledgeBaseId": tenants["kb_alice"]})

    assert response.status_code == 200
    tool_message = model.received[1][-1]["content"]
    assert "alice 的资料" in tool_message
    assert "bob 的资料" not in tool_message
    citations = response.json()["data"]["citations"]
    assert [citation["chunk"]["text"] for citation in citations] == ["alice 的资料"]


def test_every_search_empty_is_a_program_refusal(conn, tenants):
    # 知识库里没有任何片段：每次检索都是空的，程序直接拒答，模型编的内容不放出去
    model = ScriptedModel(
        [tool_reply(("call_1", "红烧肉")), answer_reply("红烧肉的做法：五花肉切块……")]
    )
    client, _ = agent_client(conn, tenants["alice"], model)
    response = client.post(URL, json={"message": "怎么做红烧肉？", "knowledgeBaseId": tenants["kb_alice"]})
    data = response.json()["data"]
    assert response.status_code == 200
    assert data["refusal"] == "empty"
    assert data["answer"] == REFUSAL_TEXT_ZH
    assert data["citations"] == []
    assert data["completed"] is True


def test_model_failure_is_reported_as_incomplete(conn, tenants):
    # 模型调用失败不是 500：照常返回，标记没答完，原因写在 stopReason 里
    model = ScriptedModel([ChatFailed("upstream_error")])
    client, _ = agent_client(conn, tenants["alice"], model)
    response = client.post(URL, json={"message": "首席研究员是谁？", "knowledgeBaseId": tenants["kb_alice"]})
    data = response.json()["data"]
    assert response.status_code == 200
    assert data["completed"] is False
    assert data["stopReason"] == "model_failed"
    assert data["answer"] == ""


# ---------- 会话和历史 ----------


def test_history_comes_from_the_conversation(conn, tenants):
    file_id = insert_file(conn, tenants["kb_alice"], "olympus.md")
    insert_chunk(conn, file_id, 0, at_angle(0), text="科瓦奇博士负责总体科学方向。")
    conversation_id = insert_conversation(conn, tenants["kb_alice"])
    insert_message(conn, conversation_id, "user", "首席研究员是谁？", seconds_ago=20)
    insert_message(conn, conversation_id, "assistant", "埃琳娜·科瓦奇博士 [1]", seconds_ago=10)
    model = ScriptedModel(
        [tool_reply(("call_1", "科瓦奇博士 职责")), answer_reply("负责总体科学方向 [1]")]
    )
    client, _ = agent_client(conn, tenants["alice"], model)

    response = client.post(
        URL,
        json={"message": "她负责什么？", "knowledgeBaseId": tenants["kb_alice"], "conversationId": conversation_id},
    )

    assert response.status_code == 200
    first_call = model.received[0]
    assert first_call[0]["role"] == "system"
    # 规则 → 库里的历史（从早到晚）→ 这一次的问题
    assert first_call[1:] == [
        {"role": "user", "content": "首席研究员是谁？"},
        {"role": "assistant", "content": "埃琳娜·科瓦奇博士 [1]"},
        {"role": "user", "content": "她负责什么？"},
    ]


def test_nothing_is_written_back_to_the_conversation(conn, tenants):
    file_id = insert_file(conn, tenants["kb_alice"], "olympus.md")
    insert_chunk(conn, file_id, 0, at_angle(0))
    conversation_id = insert_conversation(conn, tenants["kb_alice"])
    insert_message(conn, conversation_id, "user", "首席研究员是谁？", seconds_ago=20)
    model = ScriptedModel([tool_reply(("call_1", "首席研究员")), answer_reply("见 [1]")])
    client, _ = agent_client(conn, tenants["alice"], model)

    response = client.post(
        URL,
        json={"message": "再说一遍", "knowledgeBaseId": tenants["kb_alice"], "conversationId": conversation_id},
    )

    assert response.status_code == 200
    # 只读不写：这一轮的问题和回答都不进会话
    count = conn.execute(
        "select count(*) from messages where conversation_id = %s", (conversation_id,)
    ).fetchone()[0]
    assert count == 1


def test_other_tenants_conversation_is_404(conn, tenants):
    conversation_id = insert_conversation(conn, tenants["kb_bob"])
    insert_message(conn, conversation_id, "user", "bob 问过的问题")
    model = ScriptedModel([])
    client, _ = agent_client(conn, tenants["alice"], model)
    response = client.post(
        URL,
        json={"message": "她负责什么？", "knowledgeBaseId": tenants["kb_alice"], "conversationId": conversation_id},
    )
    assert response.status_code == 404
    assert response.json()["error"] == "Conversation not found"
    assert model.received == []


def test_conversation_from_another_knowledge_base_is_400(conn, tenants):
    workspace_id = conn.execute(
        "select workspace_id from knowledge_bases where id = %s", (tenants["kb_alice"],)
    ).fetchone()[0]
    other_kb = insert_knowledge_base(conn, str(workspace_id), tenants["alice"]["id"], "Alice 的另一个知识库")
    conversation_id = insert_conversation(conn, other_kb)
    model = ScriptedModel([])
    client, _ = agent_client(conn, tenants["alice"], model)
    response = client.post(
        URL,
        json={"message": "她负责什么？", "knowledgeBaseId": tenants["kb_alice"], "conversationId": conversation_id},
    )
    # 会话是自己的，但属于另一个知识库：它的历史不能配着这个知识库的资料用
    assert response.status_code == 400
    assert response.json()["error"] == "Conversation does not belong to this knowledge base"
    assert model.received == []
