import json
import socket
import threading
import time
from typing import cast

import anyio
import httpx2
import pytest
from fastapi import FastAPI
import uvicorn

from main import create_app, get_embed_query, get_rerank
import rerank
from rerank import RerankCancelled, RerankFailed, rerank_documents
from test_search import at_angle, fake_embed
from testdata import client_for, insert_chunk, insert_file, insert_session, padded_vector


async def never_disconnected() -> bool:
    return False


# ---------- 调用重排服务：用假的 HTTP 传输层，不联网 ----------


@pytest.fixture
def provider(monkeypatch):
    """把 HTTP 客户端换成假的。返回一个函数，用它指定上游怎么响应；calls 记下收到的请求。"""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    for name in ("OPENROUTER_BASE_URL", "OPENROUTER_RERANK_MODEL", "RERANK_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    calls = []

    def use(handler):
        async def record(request: httpx2.Request):
            calls.append(request)
            return await handler(request)

        monkeypatch.setattr(
            rerank, "_new_client",
            lambda: httpx2.AsyncClient(transport=httpx2.MockTransport(record)),
        )
        return calls

    return use


def run_rerank(**overrides):
    args = {"query": "问题", "documents": ["a", "b", "c"], "top_n": 3,
            "is_disconnected": never_disconnected, "timeout": 5.0}
    args.update(overrides)

    async def main():
        return await rerank_documents(**args)

    return anyio.run(main)


def respond(status=200, **kwargs):
    async def handler(request):
        return httpx2.Response(status, **kwargs)

    return handler


def test_request_matches_ts_shape(provider, monkeypatch):
    monkeypatch.setenv("OPENROUTER_RERANK_MODEL", "some/model")
    monkeypatch.setenv("OPENROUTER_BASE_URL", "https://example.test/v1/")
    calls = provider(respond(json={"results": [{"index": 0, "relevance_score": 0.5}]}))

    run_rerank(top_n=2)

    assert str(calls[0].url) == "https://example.test/v1/rerank"
    assert calls[0].headers["authorization"] == "Bearer test-key"
    assert json.loads(calls[0].content) == {
        "model": "some/model", "query": "问题", "documents": ["a", "b", "c"], "top_n": 2,
    }


def test_default_model_and_url(provider):
    calls = provider(respond(json={"results": [{"index": 0}]}))
    run_rerank()
    assert str(calls[0].url) == "https://openrouter.ai/api/v1/rerank"
    assert json.loads(calls[0].content)["model"] == "cohere/rerank-v3.5"


def test_results_keep_provider_order_and_skip_invalid_items(provider):
    provider(respond(json={"results": [
        {"index": 2, "relevance_score": 0.9},
        {"index": 2, "relevance_score": 0.8},  # 重复
        {"index": 99, "relevance_score": 0.7},  # 越界
        {"index": True, "relevance_score": 0.6},  # bool 不算下标
        "not-an-object",
        {"index": 0, "relevance_score": "high"},  # 分数不是数字：片段保留，不带分数
    ]}))
    assert run_rerank() == [(2, 0.9), (0, None)]


@pytest.mark.parametrize(
    ("kwargs", "reason"),
    [
        ({"status": 500, "json": {"error": {"message": "boom"}}}, "upstream_error"),
        ({"status": 429, "text": "slow down"}, "upstream_error"),
        ({"text": "不是 JSON"}, "invalid_response"),
        ({"json": ["not", "an", "object"]}, "invalid_response"),
        ({"json": {"results": []}}, "invalid_response"),
        ({"json": {"results": [{"index": 99}]}}, "invalid_response"),
    ],
    ids=["500", "429", "not-json", "not-object", "empty", "all-invalid"],
)
def test_bad_responses_raise_rerank_failed(provider, kwargs, reason):
    provider(respond(**kwargs))
    with pytest.raises(RerankFailed) as exc:
        run_rerank()
    assert exc.value.reason == reason


def test_network_error_raises_rerank_failed(provider):
    async def handler(request):
        raise httpx2.ConnectError("refused", request=request)

    provider(handler)
    with pytest.raises(RerankFailed) as exc:
        run_rerank()
    assert exc.value.reason == "network"


def test_timeout_when_provider_never_responds(provider):
    async def handler(request):
        await anyio.sleep(30)

    provider(handler)
    started = time.monotonic()
    with pytest.raises(RerankFailed) as exc:
        run_rerank(timeout=0.1)
    assert exc.value.reason == "timeout"
    assert time.monotonic() - started < 2


# TS 的 rerank.ts 在读响应体之前就撤掉了时限；这里头部到了、响应体卡住，也要算超时
def test_timeout_covers_reading_the_response_body(provider):
    class StalledBody(httpx2.AsyncByteStream):
        async def __aiter__(self):
            yield b'{"results":'
            await anyio.sleep(30)

    async def handler(request):
        return httpx2.Response(200, stream=StalledBody())

    provider(handler)
    started = time.monotonic()
    with pytest.raises(RerankFailed) as exc:
        run_rerank(timeout=0.1)
    assert exc.value.reason == "timeout"
    assert time.monotonic() - started < 2


# 用户取消不是服务故障：要抛 RerankCancelled（不能被当成 fallback），并且真的取消上游请求
def test_disconnect_cancels_provider_call(provider):
    cancelled = []

    async def handler(request):
        try:
            await anyio.sleep(30)
        except BaseException:
            cancelled.append(True)
            raise

    provider(handler)
    answers = iter([False, False])

    async def disconnects_soon():
        return next(answers, True)

    started = time.monotonic()
    with pytest.raises(RerankCancelled):
        run_rerank(is_disconnected=disconnects_soon)
    assert cancelled == [True]
    assert time.monotonic() - started < 2


def test_missing_api_key_is_a_config_error_not_a_fallback(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(ValueError):
        run_rerank()


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, True), ("true", True), ("TRUE", True), ("false", False), ("0", False)],
)
def test_is_rerank_enabled(monkeypatch, value, expected):
    monkeypatch.delenv("RERANK_ENABLED", raising=False)
    if value is not None:
        monkeypatch.setenv("RERANK_ENABLED", value)
    assert rerank.is_rerank_enabled() is expected


# ---------- 接口 ----------


def fake_rerank(results=None, error=None):
    """假的重排函数：返回 results 或抛 error；calls 记下收到的参数。"""
    calls = []

    def run(query, documents, top_n):
        calls.append({"query": query, "documents": documents, "top_n": top_n})
        if error is not None:
            raise error
        return results

    return run, calls


def rerank_client(conn, user, rerank_fn, embed=None):
    client = client_for(conn, user)
    embed = embed or fake_embed(padded_vector(1, 0))[0]
    overrides = cast(FastAPI, client.app).dependency_overrides
    overrides[get_embed_query] = lambda: embed
    overrides[get_rerank] = lambda: rerank_fn
    return client


@pytest.fixture(autouse=True)
def rerank_on_by_default(monkeypatch):
    monkeypatch.delenv("RERANK_ENABLED", raising=False)


def insert_angles(conn, kb_id, degrees):
    """按给定角度插入片段（距离随角度增大），返回 {角度: 片段 id}。"""
    file_id = insert_file(conn, kb_id)
    return {d: insert_chunk(conn, file_id, idx, at_angle(d)) for idx, d in enumerate(degrees)}


def post(client, kb_id, **fields):
    return client.post(
        "/api/rag/search",
        json={"query": "问题", "knowledgeBaseId": kb_id, "rerank": True, **fields},
    )


def test_rerank_reorders_and_keeps_top_5(conn, tenants):
    chunks = insert_angles(conn, tenants["kb_alice"], [0, 5, 10, 15, 20, 25, 30])
    # 下标按召回顺序（距离从小到大）：把最远的排到第一
    run, calls = fake_rerank([(6, 0.9), (5, 0.8), (4, 0.7), (3, 0.6), (2, 0.5), (1, 0.4), (0, 0.3)])
    client = rerank_client(conn, tenants["alice"], run)

    response = post(client, tenants["kb_alice"])

    assert response.status_code == 200
    data = response.json()["data"]
    assert [c["id"] for c in data["chunks"]] == [chunks[d] for d in (30, 25, 20, 15, 10)]
    assert [c["meta"]["_rerankScore"] for c in data["chunks"]] == [0.9, 0.8, 0.7, 0.6, 0.5]
    assert all("_distance" in c["meta"] for c in data["chunks"])
    assert data["rerank"] == {"status": "applied"}
    assert data["refusal"] is None


def test_rerank_sees_all_candidates_even_when_top_k_is_small(conn, tenants):
    insert_angles(conn, tenants["kb_alice"], [0, 10, 20])
    run, calls = fake_rerank([(2, 0.9), (1, 0.5), (0, 0.1)])
    client = rerank_client(conn, tenants["alice"], run)

    response = post(client, tenants["kb_alice"], topK=1)

    assert len(calls[0]["documents"]) == 3
    assert len(response.json()["data"]["chunks"]) == 1


def test_recall_is_capped_at_20_and_top_n_at_8(conn, tenants):
    insert_angles(conn, tenants["kb_alice"], list(range(0, 44, 2)))  # 22 个都在阈值内
    run, calls = fake_rerank([(0, 0.9)])
    client = rerank_client(conn, tenants["alice"], run)

    post(client, tenants["kb_alice"])

    assert len(calls[0]["documents"]) == 20
    assert calls[0]["top_n"] == 8


def test_provider_receives_trimmed_query_and_embedding_text(conn, tenants):
    insert_angles(conn, tenants["kb_alice"], [0, 10])
    run, calls = fake_rerank([(0, 0.9), (1, 0.1)])
    embed, embed_calls = fake_embed(padded_vector(1, 0))
    client = rerank_client(conn, tenants["alice"], run, embed)

    post(client, tenants["kb_alice"], query="  问题  ")

    assert embed_calls == ["  问题  "]  # 转向量用原文，和 TS 一样
    assert calls[0]["query"] == "问题"
    assert calls[0]["documents"][0].startswith("title: pytest 文档")
    assert calls[0]["top_n"] == 2


def test_unranked_chunks_follow_in_recall_order_without_score(conn, tenants):
    chunks = insert_angles(conn, tenants["kb_alice"], [0, 10, 20, 30])
    run, _ = fake_rerank([(3, 0.9)])
    client = rerank_client(conn, tenants["alice"], run)

    data = post(client, tenants["kb_alice"]).json()["data"]

    assert [c["id"] for c in data["chunks"]] == [chunks[d] for d in (30, 0, 10, 20)]
    assert data["chunks"][0]["meta"]["_rerankScore"] == 0.9
    assert "_rerankScore" not in data["chunks"][1]["meta"]


@pytest.mark.parametrize("reason", ["timeout", "network", "upstream_error", "invalid_response"])
def test_failure_falls_back_to_recall_order_and_says_so(conn, tenants, reason):
    chunks = insert_angles(conn, tenants["kb_alice"], [20, 0, 10, 30, 40, 50])
    run, _ = fake_rerank(error=RerankFailed(reason))
    client = rerank_client(conn, tenants["alice"], run)

    response = post(client, tenants["kb_alice"])

    assert response.status_code == 200
    data = response.json()["data"]
    assert [c["id"] for c in data["chunks"]] == [chunks[d] for d in (0, 10, 20, 30, 40)]
    assert all("_rerankScore" not in c["meta"] for c in data["chunks"])
    assert data["rerank"] == {"status": "fallback", "reason": reason}
    assert data["refusal"] is None


def test_cancel_is_not_a_fallback(conn, tenants):
    insert_angles(conn, tenants["kb_alice"], [0, 10])
    run, _ = fake_rerank(error=RerankCancelled())
    client = rerank_client(conn, tenants["alice"], run)

    response = post(client, tenants["kb_alice"])

    assert response.status_code == 499
    assert response.json()["error"] == "request_cancelled"


def test_empty_recall_refuses_without_calling_rerank(conn, tenants):
    insert_angles(conn, tenants["kb_alice"], [90])  # 距离约 1，被阈值挡掉
    run, calls = fake_rerank([])
    client = rerank_client(conn, tenants["alice"], run)

    response = post(client, tenants["kb_alice"])

    assert response.status_code == 200
    assert response.json()["data"] == {
        "chunks": [],
        "refusal": "empty",
        "rerank": {"status": "skipped", "reason": "no_candidates"},
    }
    assert calls == []


def test_single_candidate_skips_rerank(conn, tenants):
    chunks = insert_angles(conn, tenants["kb_alice"], [0])
    run, calls = fake_rerank([])
    client = rerank_client(conn, tenants["alice"], run)

    data = post(client, tenants["kb_alice"]).json()["data"]

    assert [c["id"] for c in data["chunks"]] == [chunks[0]]
    assert data["rerank"] == {"status": "skipped", "reason": "single_candidate"}
    assert calls == []


def test_disabled_by_env_skips_rerank(conn, tenants, monkeypatch):
    monkeypatch.setenv("RERANK_ENABLED", "false")
    chunks = insert_angles(conn, tenants["kb_alice"], [0, 10])
    run, calls = fake_rerank([])
    client = rerank_client(conn, tenants["alice"], run)

    data = post(client, tenants["kb_alice"]).json()["data"]

    assert [c["id"] for c in data["chunks"]] == [chunks[0], chunks[10]]
    assert data["rerank"] == {"status": "skipped", "reason": "disabled"}
    assert calls == []


def test_max_distance_applies_to_recall(conn, tenants):
    insert_angles(conn, tenants["kb_alice"], [0, 45, 60])
    run, calls = fake_rerank([(0, 0.9), (1, 0.1)])
    client = rerank_client(conn, tenants["alice"], run)

    post(client, tenants["kb_alice"], maxDistance=0.4)

    assert len(calls[0]["documents"]) == 2


@pytest.mark.parametrize("fields", [{}, {"rerank": False}], ids=["absent", "false"])
def test_old_path_response_is_unchanged(conn, tenants, fields):
    insert_angles(conn, tenants["kb_alice"], [0, 10])
    run, calls = fake_rerank([])
    client = rerank_client(conn, tenants["alice"], run)

    response = client.post(
        "/api/rag/search",
        json={"query": "问题", "knowledgeBaseId": tenants["kb_alice"], **fields},
    )

    assert set(response.json()["data"]) == {"chunks"}
    assert calls == []


@pytest.mark.parametrize("value", ["true", 1, None], ids=["string", "number", "null"])
def test_non_boolean_rerank_returns_400(conn, tenants, value):
    embed, embed_calls = fake_embed(padded_vector(1, 0))
    run, calls = fake_rerank([])
    client = rerank_client(conn, tenants["alice"], run, embed)

    response = post(client, tenants["kb_alice"], rerank=value)

    assert response.status_code == 400
    assert response.json()["error"] == "rerank must be a boolean"
    assert embed_calls == [] and calls == []


def test_no_access_costs_nothing(conn, tenants):
    embed, embed_calls = fake_embed(padded_vector(1, 0))
    run, calls = fake_rerank([])
    client = rerank_client(conn, tenants["alice"], run, embed)

    response = post(client, tenants["kb_bob"])

    assert response.status_code == 404
    assert embed_calls == [] and calls == []


# ---------- 真实 HTTP 服务：TestClient 模拟不了客户端断开 ----------


# 防的是换回 @app.middleware("http")：测试全绿，但 request.is_disconnected() 永远是 False
def test_real_disconnect_cancels_rerank(conn, tenants, provider):
    insert_angles(conn, tenants["kb_alice"], [0, 10])
    upstream_started = threading.Event()
    upstream_cancelled = threading.Event()

    async def handler(request):
        upstream_started.set()
        try:
            await anyio.sleep(30)
        except BaseException:
            upstream_cancelled.set()
            raise

    provider(handler)
    app = create_app()
    app.dependency_overrides[get_embed_query] = lambda: fake_embed(padded_vector(1, 0))[0]

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 5
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.01)

        token = insert_session(conn, tenants["alice"]["id"])
        body = json.dumps(
            {"query": "问题", "knowledgeBaseId": tenants["kb_alice"], "rerank": True}
        ).encode()
        client = socket.create_connection(("127.0.0.1", port))
        client.sendall(
            b"POST /api/rag/search HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\n"
            + f"Cookie: rag_session={token}\r\nContent-Length: {len(body)}\r\n\r\n".encode()
            + body
        )
        assert upstream_started.wait(5), "重排服务没有被调用"
        client.close()

        assert upstream_cancelled.wait(3), "客户端断开后，上游请求没有被取消"
    finally:
        server.should_exit = True
        thread.join(5)
