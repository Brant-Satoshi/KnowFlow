"""MCP adapter checks use fake HTTP responses; no database or model calls."""

import json
from pathlib import Path
import sys
from uuid import uuid4

import httpx2
import pytest

pytest.importorskip("mcp")  # The existing API can be used without the optional SDK.
from mcp import Client
from mcp.client.stdio import StdioServerParameters

import mcp_server

KB_ID = "00000000-0000-4000-8000-000000000001"
REQUEST_ID = "00000000-0000-4000-8000-000000000002"
OTHER_KB_ID = "00000000-0000-4000-8000-000000000003"
ARGS = {"query": "登录如何实现？"}


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def config(monkeypatch):
    monkeypatch.setenv("KNOWFLOW_API_URL", "https://knowflow.test/")
    monkeypatch.setenv("KNOWFLOW_SESSION_TOKEN", "test-session-token")
    monkeypatch.setenv("KNOWFLOW_KNOWLEDGE_BASE_ID", KB_ID)


@pytest.fixture
async def client():
    async with Client(mcp_server.mcp, raise_exceptions=True) as connection:
        yield connection


@pytest.fixture
def upstream(monkeypatch):
    state = {
        "calls": [],
        "response": httpx2.Response(200, json={
            "requestId": REQUEST_ID, "ok": True, "data": {"chunks": []},
        }),
    }

    def handle(request):
        state["calls"].append(request)
        if isinstance(state["response"], Exception):
            raise state["response"]
        return state["response"]

    monkeypatch.setattr(mcp_server, "_new_client", lambda: httpx2.AsyncClient(
        transport=httpx2.MockTransport(handle), follow_redirects=False,
    ))
    return state


def error_text(result):
    assert result.is_error
    return "\n".join(block.text for block in result.content if block.type == "text")


@pytest.mark.anyio
async def test_discovery_and_schema(client):
    result = await client.list_tools()
    assert [tool.name for tool in result.tools] == ["knowflow_search"]
    tool = result.tools[0]
    assert tool.annotations.read_only_hint is True
    assert set(tool.input_schema["required"]) == {"query"}
    properties = tool.input_schema["properties"]
    assert properties["topK"]["maximum"] == 20
    assert "knowledgeBaseId" not in properties  # The model never chooses the knowledge base.
    assert "KNOWFLOW_SESSION_TOKEN" not in properties


@pytest.mark.anyio
async def test_forwarding_and_rerank_results(client, upstream):
    data = {
        "chunks": [{"id": str(uuid4()), "text": "登录使用会话 Cookie", "fileName": "auth.md",
                    "meta": {"_distance": 0.2, "_rerankScore": 0.9}}],
        "refusal": None,
        "rerank": {"status": "fallback", "reason": "timeout"},
    }
    payload = {"requestId": REQUEST_ID, "ok": True, "data": data}
    upstream["response"] = httpx2.Response(200, json=payload)
    result = await client.call_tool("knowflow_search", {**ARGS, "topK": 3, "rerank": True})
    assert not result.is_error
    assert result.structured_content == payload
    assert result.content  # Text fallback for clients without structured output support.
    request, = upstream["calls"]
    assert request.method == "POST"
    assert str(request.url) == "https://knowflow.test/api/rag/search"
    assert request.headers["cookie"] == "rag_session=test-session-token"
    assert json.loads(request.content) == {
        **ARGS, "knowledgeBaseId": KB_ID, "topK": 3, "maxDistance": 1.0, "rerank": True,
    }
    assert "test-session-token" not in str(result)


@pytest.mark.anyio
async def test_empty_results_are_success(client, upstream):
    result = await client.call_tool("knowflow_search", ARGS)
    assert not result.is_error
    assert result.structured_content["data"]["chunks"] == []


@pytest.mark.anyio
@pytest.mark.parametrize("patch", [
    {"query": "  "}, {"query": 12},
    {"topK": 0}, {"topK": 21}, {"topK": True}, {"topK": 1.5},
    {"maxDistance": -1}, {"maxDistance": 1.1}, {"rerank": "true"},
])
async def test_invalid_arguments_do_not_call_api(client, upstream, patch):
    result = await client.call_tool("knowflow_search", {**ARGS, **patch})
    assert result.is_error
    assert upstream["calls"] == []


@pytest.mark.anyio
@pytest.mark.parametrize(("status", "message", "expected"), [
    (400, "Invalid request", "Invalid request"),
    (401, "Unauthorized", "update KNOWFLOW_SESSION_TOKEN"),
    (404, "Knowledge base not found", "Knowledge base not found"),
    (500, "secret database connection details", "Search failed"),
])
async def test_api_errors_preserve_status_and_trace(client, upstream, status, message, expected):
    upstream["response"] = httpx2.Response(status, json={
        "requestId": REQUEST_ID, "ok": False, "error": message,
    })
    text = error_text(await client.call_tool("knowflow_search", ARGS))
    assert str(status) in text
    assert REQUEST_ID in text
    assert expected in text
    assert "secret database" not in text


@pytest.mark.anyio
@pytest.mark.parametrize("response", [
    httpx2.Response(502, text="private proxy details"),
    httpx2.Response(200, json=[]),
    httpx2.Response(200, json={"ok": True, "data": {}}),
    httpx2.Response(302, headers={"location": "https://other.test/"}),
    httpx2.ConnectError("private connection details"),
    httpx2.ReadTimeout("private timeout details"),
])
async def test_network_and_invalid_responses(client, upstream, response):
    upstream["response"] = response
    text = error_text(await client.call_tool("knowflow_search", ARGS))
    assert "private" not in text
    assert len(upstream["calls"]) == 1  # No redirects or automatic retries.


@pytest.mark.anyio
async def test_model_supplied_knowledge_base_is_ignored(client, upstream):
    result = await client.call_tool("knowflow_search", {**ARGS, "knowledgeBaseId": OTHER_KB_ID})
    assert not result.is_error
    request, = upstream["calls"]
    assert json.loads(request.content)["knowledgeBaseId"] == KB_ID


@pytest.mark.anyio
@pytest.mark.parametrize("value", [None, "", "  ", "not-a-uuid"])
async def test_missing_or_invalid_knowledge_base_is_actionable(client, upstream, monkeypatch, value):
    if value is None:
        monkeypatch.delenv("KNOWFLOW_KNOWLEDGE_BASE_ID")
    else:
        monkeypatch.setenv("KNOWFLOW_KNOWLEDGE_BASE_ID", value)
    text = error_text(await client.call_tool("knowflow_search", ARGS))
    assert "KNOWFLOW_KNOWLEDGE_BASE_ID" in text
    assert upstream["calls"] == []


@pytest.mark.anyio
async def test_missing_session_is_actionable(client, upstream, monkeypatch):
    monkeypatch.delenv("KNOWFLOW_SESSION_TOKEN")
    text = error_text(await client.call_tool("knowflow_search", ARGS))
    assert "KNOWFLOW_SESSION_TOKEN" in text
    assert upstream["calls"] == []


@pytest.mark.anyio
async def test_stdio_subprocess_discovers_tool_without_session():
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(Path(mcp_server.__file__).resolve())],
        env={"KNOWFLOW_SESSION_TOKEN": "", "KNOWFLOW_API_URL": "http://127.0.0.1:8000"},
    )
    async with Client(params, read_timeout_seconds=10) as connection:
        tools = await connection.list_tools()
        assert [tool.name for tool in tools.tools] == ["knowflow_search"]
        text = error_text(await connection.call_tool("knowflow_search", ARGS))
        assert "KNOWFLOW_SESSION_TOKEN" in text
