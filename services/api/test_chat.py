import json

import anyio
import httpx2
import pytest

import chat
from chat import CHAT_MODEL, ChatFailed, chat_with_tools

# 调模型（带工具）：用假的 HTTP 传输层，不联网。写法照 test_rerank.py。

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": "检索",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    }
]
MESSAGES = [{"role": "user", "content": "首席研究员是谁？"}]
TOOL_CALL_MESSAGE = {
    "role": "assistant",
    "content": None,
    "tool_calls": [
        {
            "id": "call_1",
            "type": "function",
            "function": {"name": "search_knowledge_base", "arguments": '{"query": "首席研究员"}'},
        }
    ],
}
ANSWER_MESSAGE = {"role": "assistant", "content": "埃琳娜·科瓦奇博士 [1]"}


@pytest.fixture
def provider(monkeypatch):
    """把 HTTP 客户端换成假的。返回一个函数，用它指定上游怎么响应；calls 记下收到的请求。"""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.delenv("OPENROUTER_BASE_URL", raising=False)
    calls = []

    def use(handler):
        async def record(request: httpx2.Request):
            calls.append(request)
            return await handler(request)

        monkeypatch.setattr(
            chat, "_new_client",
            lambda: httpx2.AsyncClient(transport=httpx2.MockTransport(record)),
        )
        return calls

    return use


def run_chat(tool_choice="auto", timeout=5.0):
    async def main():
        return await chat_with_tools(MESSAGES, TOOLS, tool_choice, timeout)

    return anyio.run(main)


def respond(status=200, **kwargs):
    async def handler(request):
        return httpx2.Response(status, **kwargs)

    return handler


def reply_with(message):
    return respond(json={"choices": [{"message": message}]})


def test_request_shape(provider, monkeypatch):
    monkeypatch.setenv("OPENROUTER_BASE_URL", "https://example.test/v1/")
    calls = provider(reply_with(ANSWER_MESSAGE))

    run_chat(tool_choice="required")

    assert str(calls[0].url) == "https://example.test/v1/chat/completions"
    assert calls[0].headers["authorization"] == "Bearer test-key"
    assert json.loads(calls[0].content) == {
        "model": CHAT_MODEL,
        "messages": MESSAGES,
        "tools": TOOLS,
        # 循环每次传进来的值原样发出去：required / auto / none
        "tool_choice": "required",
        "temperature": 0,
    }


def test_default_url(provider):
    calls = provider(reply_with(ANSWER_MESSAGE))
    run_chat()
    assert str(calls[0].url) == "https://openrouter.ai/api/v1/chat/completions"


def test_returns_tool_call_message_as_is(provider):
    # 原样返回：循环要把这条消息加回 messages，再发给模型
    provider(reply_with(TOOL_CALL_MESSAGE))
    assert run_chat() == TOOL_CALL_MESSAGE


def test_returns_answer_message(provider):
    provider(reply_with(ANSWER_MESSAGE))
    assert run_chat() == ANSWER_MESSAGE


def test_missing_api_key_is_a_config_error(provider, monkeypatch):
    provider(reply_with(ANSWER_MESSAGE))
    monkeypatch.delenv("OPENROUTER_API_KEY")
    with pytest.raises(ValueError, match="Missing OPENROUTER_API_KEY"):
        run_chat()


def test_timeout_covers_the_whole_call(provider):
    # 上游一直不回：到了时限就放弃，不会等下去
    async def never_answers(request):
        await anyio.sleep(60)

    provider(never_answers)
    with pytest.raises(ChatFailed) as caught:
        run_chat(timeout=0.05)
    assert caught.value.reason == "timeout"


def test_network_error(provider):
    async def unreachable(request):
        raise httpx2.ConnectError("连不上", request=request)

    provider(unreachable)
    with pytest.raises(ChatFailed) as caught:
        run_chat()
    assert caught.value.reason == "network"


def test_upstream_error_status(provider):
    provider(respond(500, json={"error": {"message": "上游内部错误，带着不该给用户看的细节"}}))
    with pytest.raises(ChatFailed) as caught:
        run_chat()
    # 只给原因，不把上游的原始信息带出去
    assert caught.value.reason == "upstream_error"
    assert "细节" not in str(caught.value)


@pytest.mark.parametrize(
    "response",
    [
        respond(content=b"not json"),
        respond(json={"choices": []}),
        respond(json={"choices": [{"message": "不是对象"}]}),
        # 既没有回答，也没有工具调用：循环拿到这种回复没法往下走
        reply_with({"role": "assistant", "content": None}),
        reply_with({"role": "assistant", "content": "  "}),
        reply_with({"role": "assistant", "content": None, "tool_calls": []}),
        # 工具调用缺 id 或者缺名字：没法给它回结果
        reply_with({"role": "assistant", "content": None, "tool_calls": [
            {"type": "function", "function": {"name": "search_knowledge_base", "arguments": "{}"}},
        ]}),
        reply_with({"role": "assistant", "content": None, "tool_calls": [
            {"id": "call_1", "type": "function", "function": {"arguments": "{}"}},
        ]}),
    ],
    ids=[
        "不是 JSON", "choices 是空的", "message 不是对象", "没有回答也没有工具调用",
        "回答是空白", "tool_calls 是空列表", "工具调用缺 id", "工具调用缺名字",
    ],
)
def test_unusable_reply_is_invalid_response(provider, response):
    provider(response)
    with pytest.raises(ChatFailed) as caught:
        run_chat()
    assert caught.value.reason == "invalid_response"


def test_bad_arguments_are_left_to_the_loop(provider):
    # 参数写坏了不算回复不可用：循环会把错误说明交回模型，让它重写（学习日 2 的决定）
    message = {"role": "assistant", "content": None, "tool_calls": [
        {"id": "call_1", "type": "function",
         "function": {"name": "search_knowledge_base", "arguments": '{"query": "首席研究员"'}},
    ]}
    provider(reply_with(message))
    assert run_chat() == message
