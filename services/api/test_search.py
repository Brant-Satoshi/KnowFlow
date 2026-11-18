import math
import uuid
from typing import cast

import pytest
from fastapi import FastAPI

from main import get_embed_query
from testdata import client_for, insert_chunk, insert_file, padded_vector


def at_angle(degrees: float) -> list[float]:
    """和问题向量 padded_vector(1, 0) 夹角为 degrees 度的向量。"""
    r = math.radians(degrees)  # math.cos / math.sin 接收的是弧度，不是度
    return padded_vector(math.cos(r), math.sin(r))


def fake_embed(vector: list[float]):
    """假的"问题转向量"：不联网，总是返回 vector；calls 按顺序记下收到的每个问题。"""
    calls = []

    def embed(text: str) -> list[float]:
        calls.append(text)
        return vector

    return embed, calls


def search_client(conn, user: dict, embed):
    """以 user 的身份发请求的客户端，"问题转向量"换成 embed。"""
    client = client_for(conn, user)
    # TestClient.app 的类型是通用的 ASGI 应用，类型检查器不知道它有 dependency_overrides；运行时它就是 create_app() 返回的 FastAPI
    cast(FastAPI, client.app).dependency_overrides[get_embed_query] = lambda: embed
    return client


# 1. 顺序和阈值：只返回距离 < 0.6 的片段，按距离从小到大排，_distance 和手算的一致
def test_order_from_alice_kb(conn, tenants):
    embed, _ = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["alice"], embed)

    file_id = insert_file(conn, tenants["kb_alice"], "alice_file")
    # 插入顺序故意和期望顺序不同：实现漏了 ORDER BY、按插入顺序返回时，这个测试通不过
    chunk_60 = insert_chunk(conn, file_id, 0, at_angle(60))
    insert_chunk(conn, file_id, 1, at_angle(90))  # 距离约为 1，应该被阈值挡掉
    chunk_0 = insert_chunk(conn, file_id, 2, at_angle(0))
    chunk_45 = insert_chunk(conn, file_id, 3, at_angle(45))
    # 单位向量的余弦距离 = 1 - 第一维：0.41 -> 0.59，0.39 -> 0.61。
    # 只用 60° / 90°，阈值误写成 0.8 也能通过；这两个片段把阈值夹在 0.6 附近。
    # 不用恰好 0.6 的片段，避免 vector 单精度存储把边界推向任意一侧。
    chunk_059 = insert_chunk(
        conn, file_id, 4, padded_vector(0.41, math.sqrt(1 - 0.41**2))
    )
    insert_chunk(conn, file_id, 5, padded_vector(0.39, math.sqrt(1 - 0.39**2)))

    response = client.post(
        "/api/rag/search", json={"query": "问题", "knowledgeBaseId": tenants["kb_alice"]}
    )
    assert response.status_code == 200
    chunks = response.json()["data"]["chunks"]

    assert [chunk["id"] for chunk in chunks] == [chunk_0, chunk_45, chunk_60, chunk_059]
    # 手算：1-cos(0°)=0，1-cos(45°)=1-√2/2，1-cos(60°)=0.5。
    expected_distances = [0.0, 1 - math.sqrt(2) / 2, 0.5, 0.59]
    for chunk, expected in zip(chunks, expected_distances, strict=True):
        # vector 列每个分量按单精度存，算出来的距离有约 1e-7 的误差；期望值是 0 时只能用绝对误差
        assert chunk["meta"]["_distance"] == pytest.approx(expected, abs=1e-6)


# 2. bob 的片段距离更小，也不能混进 alice 的知识库结果里
def test_search_only_returns_chunks_from_requested_kb(conn, tenants):
    embed, _ = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["alice"], embed)
    alice_file = insert_file(conn, tenants["kb_alice"], "alice.md")
    bob_file = insert_file(conn, tenants["kb_bob"], "bob.md")
    alice_chunk = insert_chunk(conn, alice_file, 0, at_angle(45))
    insert_chunk(conn, bob_file, 0, at_angle(0))  # 距离为 0，比 alice 的片段还近

    response = client.post(
        "/api/rag/search", json={"query": "问题", "knowledgeBaseId": tenants["kb_alice"]}
    )

    assert response.status_code == 200
    chunks = response.json()["data"]["chunks"]
    assert [chunk["id"] for chunk in chunks] == [alice_chunk]


# 3. 跨租户先返回 404，不能先调用 embedding 再发现没有权限
def test_unauthorized_search_does_not_call_embedding(conn, tenants):
    embed, calls = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["bob"], embed)

    response = client.post(
        "/api/rag/search", json={"query": "问题", "knowledgeBaseId": tenants["kb_alice"]}
    )

    assert response.status_code == 404
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "Knowledge base not found"
    assert calls == []


# 问题原样拿去转向量，不去掉首尾空格：TS 也是把请求里的 query 原样传给 embedChunk
def test_query_is_embedded_without_trimming(conn, tenants):
    embed, calls = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["alice"], embed)

    response = client.post(
        "/api/rag/search", json={"query": "  问题  ", "knowledgeBaseId": tenants["kb_alice"]}
    )

    assert response.status_code == 200
    assert calls == ["  问题  "]


# 4. topK 限制的是按距离排序后的结果数
def test_top_k_returns_nearest_two_chunks(conn, tenants):
    embed, calls = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["alice"], embed)
    file_id = insert_file(conn, tenants["kb_alice"])
    insert_chunk(conn, file_id, 0, at_angle(60))
    chunk_0 = insert_chunk(conn, file_id, 1, at_angle(0))
    chunk_45 = insert_chunk(conn, file_id, 2, at_angle(45))

    response = client.post(
        "/api/rag/search",
        json={"query": "问题", "knowledgeBaseId": tenants["kb_alice"], "topK": 2},
    )

    assert response.status_code == 200
    chunks = response.json()["data"]["chunks"]
    assert [chunk["id"] for chunk in chunks] == [chunk_0, chunk_45]
    assert calls == ["问题"]


# 不传 topK 时默认返回 5 个（TS 的 RETRIEVAL.finalTopK）
def test_top_k_defaults_to_5(conn, tenants):
    embed, _ = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["alice"], embed)
    file_id = insert_file(conn, tenants["kb_alice"])
    # 6 个片段都在阈值内（最远的 50° 距离约 0.36），只靠默认 topK 截掉一个；插入顺序打乱
    chunk_ids = {
        degrees: insert_chunk(conn, file_id, idx, at_angle(degrees))
        for idx, degrees in enumerate([30, 50, 0, 40, 10, 20])
    }

    response = client.post(
        "/api/rag/search", json={"query": "问题", "knowledgeBaseId": tenants["kb_alice"]}
    )

    assert response.status_code == 200
    chunks = response.json()["data"]["chunks"]
    assert [chunk["id"] for chunk in chunks] == [chunk_ids[d] for d in (0, 10, 20, 30, 40)]


# topK: null 也是 400：JS 的解构默认值只在字段不存在时生效，null 会留下来，typeof null 不是 'number'
# topK: 2.5 和 TS 有意不同：TS 交给数据库时报错返回 500，Python 这边 Postgres 会把它取整成 2，这里统一返回 400
@pytest.mark.parametrize(
    "top_k",
    [0, 21, True, "5", None, 2.5],
    ids=["zero", "too-large", "boolean", "string", "null", "fractional"],
)
def test_invalid_top_k_returns_400(conn, tenants, top_k):
    embed, calls = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["alice"], embed)

    response = client.post(
        "/api/rag/search",
        json={"query": "问题", "knowledgeBaseId": tenants["kb_alice"], "topK": top_k},
    )

    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "topK must be between 1 and 20"
    assert calls == []


# topK: 5.0 要接受：JSON 的 5.0 到 Python 是 float，在 JS 里就是整数 5，TS 正常返回。
# 防止整数检查改过头写成 isinstance(top_k, int)，把它错拒成 400
def test_top_k_whole_number_float_is_accepted(conn, tenants):
    embed, _ = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["alice"], embed)
    file_id = insert_file(conn, tenants["kb_alice"])
    # 和 test_top_k_defaults_to_5 一样：6 个片段都在阈值内，只靠 topK 截掉一个
    chunk_ids = {
        degrees: insert_chunk(conn, file_id, idx, at_angle(degrees))
        for idx, degrees in enumerate([30, 50, 0, 40, 10, 20])
    }

    response = client.post(
        "/api/rag/search",
        json={"query": "问题", "knowledgeBaseId": tenants["kb_alice"], "topK": 5.0},
    )

    assert response.status_code == 200
    chunks = response.json()["data"]["chunks"]
    assert [chunk["id"] for chunk in chunks] == [chunk_ids[d] for d in (0, 10, 20, 30, 40)]


# maxDistance 替换默认阈值 0.6：60° 的距离是 0.5，默认会返回，传 0.4 时要被挡掉
def test_max_distance_overrides_default_threshold(conn, tenants):
    embed, _ = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["alice"], embed)
    file_id = insert_file(conn, tenants["kb_alice"])
    insert_chunk(conn, file_id, 0, at_angle(60))
    chunk_0 = insert_chunk(conn, file_id, 1, at_angle(0))
    chunk_45 = insert_chunk(conn, file_id, 2, at_angle(45))

    response = client.post(
        "/api/rag/search",
        json={"query": "问题", "knowledgeBaseId": tenants["kb_alice"], "maxDistance": 0.4},
    )

    assert response.status_code == 200
    chunks = response.json()["data"]["chunks"]
    assert [chunk["id"] for chunk in chunks] == [chunk_0, chunk_45]


# maxDistance: 0 合法，但比较是严格的 "<"：连方向完全相同（距离正好是 0）的片段也不返回
def test_max_distance_zero_returns_nothing(conn, tenants):
    embed, _ = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["alice"], embed)
    file_id = insert_file(conn, tenants["kb_alice"])
    insert_chunk(conn, file_id, 0, at_angle(0))  # (1, 0) 和问题向量完全相同，距离精确为 0，没有浮点误差

    response = client.post(
        "/api/rag/search",
        json={"query": "问题", "knowledgeBaseId": tenants["kb_alice"], "maxDistance": 0},
    )

    assert response.status_code == 200
    assert response.json()["data"]["chunks"] == []


# 和 topK 一样：True 是 int 的子类、null 不会被默认值替换，都要返回 400
@pytest.mark.parametrize(
    "max_distance",
    [-0.1, 1.1, "0.5", True, None],
    ids=["negative", "too-large", "string", "boolean", "null"],
)
def test_invalid_max_distance_returns_400(conn, tenants, max_distance):
    embed, calls = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["alice"], embed)

    response = client.post(
        "/api/rag/search",
        json={"query": "问题", "knowledgeBaseId": tenants["kb_alice"], "maxDistance": max_distance},
    )

    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "maxDistance must be between 0 and 1"
    assert calls == []


# 5. 每次只让一个字段无效，避免前面的校验把真正想测的分支挡住
@pytest.mark.parametrize(
    ("body_patch", "omit_fields", "expected_error"),
    [
        ({}, ("query",), "Missing query"),
        ({"query": "   "}, (), "Missing query"),
        ({"knowledgeBaseId": "not-a-uuid"}, (), "Invalid knowledgeBaseId"),
        ({}, ("knowledgeBaseId",), "knowledgeBaseId or fileId is required"),
        # 下面三个 Python 版暂不支持、TS 会正常处理：对拍时是已知差异
        ({"mode": "hybrid"}, (), "mode hybrid is not supported yet"),
        ({"fileId": "00000000-0000-4000-8000-000000000000"}, (), "fileId is not supported yet"),
        ({"filter": {"fileTypes": ["pdf"]}}, (), "filter is not supported yet"),
    ],
    ids=[
        "missing-query", "blank-query", "invalid-kb-id", "missing-scope",
        "hybrid-mode", "file-id", "filter",
    ],
)
def test_invalid_search_request_returns_400(
    conn, tenants, body_patch, omit_fields, expected_error
):
    embed, calls = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["alice"], embed)
    payload = {"query": "问题", "knowledgeBaseId": tenants["kb_alice"]}
    payload.update(body_patch)
    for field in omit_fields:
        del payload[field]

    response = client.post("/api/rag/search", json=payload)

    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == expected_error
    assert calls == []


# 6. 返回键来自 searchChunks 的 SELECT；attachDistance 把 distance 移入 meta
@pytest.mark.parametrize("section_title", ["安装步骤", None, ""], ids=["title", "null", "empty"])
def test_search_response_shape_and_metadata(conn, tenants, section_title):
    embed, _ = fake_embed(padded_vector(1, 0))
    client = search_client(conn, tenants["alice"], embed)
    file_id = insert_file(conn, tenants["kb_alice"], "guide.md")
    text = "先启动服务，再打开页面。"
    chunk_id = insert_chunk(
        conn, file_id, 0, at_angle(0), text=text, section_title=section_title
    )

    response = client.post(
        "/api/rag/search", json={"query": "问题", "knowledgeBaseId": tenants["kb_alice"]}
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"requestId", "ok", "data"}
    assert body["ok"] is True
    uuid.UUID(body["requestId"])
    assert set(body["data"]) == {"chunks"}
    assert len(body["data"]["chunks"]) == 1
    chunk = body["data"]["chunks"][0]
    assert set(chunk) == {
        "id", "fileId", "idx", "text", "embeddingText",
        "documentTitle", "sectionTitle", "meta", "fileName",
    }
    assert chunk["id"] == chunk_id
    assert chunk["fileId"] == file_id
    assert chunk["idx"] == 0
    assert chunk["text"] == text
    assert chunk["fileName"] == "guide.md"
    assert chunk["documentTitle"] == "pytest 文档"
    embedding_text = conn.execute(
        "select embedding_text from chunks where id = %s", (chunk_id,)
    ).fetchone()[0]
    assert chunk["embeddingText"] == embedding_text
    assert chunk["meta"] == {
        "start": 0,
        "end": len(text),
        "_distance": pytest.approx(0.0, abs=1e-6),
    }
    # SQL NULL 直接保留为 JSON null；不像 description 的 ?? undefined 会省略键。
    # 空字符串也保留为空字符串，不能用 truthiness 把它和 NULL 混为一谈。
    assert chunk["sectionTitle"] == section_title
