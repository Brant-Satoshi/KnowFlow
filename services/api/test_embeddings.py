import json

import httpx2
import pytest
from fastapi import Body, Depends
from fastapi.testclient import TestClient

import embeddings
from main import create_app, get_embed_query


@pytest.fixture(autouse=True)
def clean_embedding_env(monkeypatch):
    for name in (
        "OPENROUTER_API_KEY", "OPENROUTER_BASE_URL",
        "OPENROUTER_EMBEDDING_MODEL", "OPENROUTER_EMBEDDING_DIMENSIONS",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def provider(monkeypatch):
    """记录真实代码打算发出的 HTTP 请求，返回固定向量，不联网。"""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    calls = []
    vector = [1.0] + [0.0] * 1535

    def post(url, **kwargs):
        calls.append((url, kwargs))
        return httpx2.Response(
            200, json={"data": [{"embedding": vector}]},
            request=httpx2.Request("POST", url),
        )

    monkeypatch.setattr(embeddings.httpx2, "post", post)
    return calls, vector


def test_dependency_does_not_require_config_or_call_provider(monkeypatch):
    def unexpected_post(*args, **kwargs):
        pytest.fail("提供依赖时不能调用 embedding")

    monkeypatch.setattr(embeddings.httpx2, "post", unexpected_post)
    assert get_embed_query() is embeddings.embed_query


def test_dependency_can_be_overridden():
    app = create_app()
    calls = []

    def fake_embed(text):
        calls.append(text)
        return [1.0, 0.0]

    app.dependency_overrides[get_embed_query] = lambda: fake_embed

    @app.post("/api/test/embed")
    def embed(body=Body(), embed=Depends(get_embed_query)):
        return {"vector": embed(body["query"])}

    with TestClient(app) as client:
        response = client.post("/api/test/embed", json={"query": "如何登录？"})
    assert response.status_code == 200
    assert response.json() == {"vector": [1.0, 0.0]}
    assert calls == ["如何登录？"]


def test_default_embedding_request(provider):
    calls, vector = provider
    assert embeddings.embed_query("如何登录？") == vector
    assert calls == [(
        "https://openrouter.ai/api/v1/embeddings",
        {
            "headers": {"Authorization": "Bearer test-key", "Content-Type": "application/json"},
            "json": {"model": "text-embedding-3-small", "input": ["如何登录？"], "dimensions": 1536},
            "timeout": 30.0,
        },
    )]


def test_custom_embedding_config(provider, monkeypatch):
    calls, _ = provider
    monkeypatch.setenv("OPENROUTER_BASE_URL", " 'https://example.test/v1/' ")
    monkeypatch.setenv("OPENROUTER_EMBEDDING_MODEL", "custom-model")
    monkeypatch.setenv("OPENROUTER_EMBEDDING_DIMENSIONS", "1536")
    embeddings.embed_query("问题")
    url, kwargs = calls[0]
    assert url == "https://example.test/v1/embeddings"
    assert kwargs["json"] == {"model": "custom-model", "input": ["问题"], "dimensions": 1536}


def test_custom_model_omits_unspecified_dimensions(provider, monkeypatch):
    calls, _ = provider
    monkeypatch.setenv("OPENROUTER_EMBEDDING_MODEL", "custom-model")
    embeddings.embed_query("问题")
    assert calls[0][1]["json"] == {"model": "custom-model", "input": ["问题"]}


def test_missing_api_key_fails_before_http(provider, monkeypatch):
    calls, _ = provider
    monkeypatch.delenv("OPENROUTER_API_KEY")
    with pytest.raises(ValueError, match="Missing OPENROUTER_API_KEY"):
        embeddings.embed_query("问题")
    assert calls == []


@pytest.mark.parametrize("dimensions", ["0", "-1", "invalid", "1536.5", "512"])
def test_invalid_dimensions_fail_before_http(provider, monkeypatch, dimensions):
    calls, _ = provider
    monkeypatch.setenv("OPENROUTER_EMBEDDING_DIMENSIONS", dimensions)
    with pytest.raises(ValueError, match="dimensions|DIMENSIONS"):
        embeddings.embed_query("问题")
    assert calls == []


@pytest.mark.parametrize(
    "payload",
    [
        None, {}, {"data": []}, {"data": [{}, {}]},
        {"data": [{}]}, {"data": [{"embedding": [1.0, 0.0]}]},
        {"data": [{"embedding": ["wrong"] * 1536}]},
        {"data": [{"embedding": [True] * 1536}]},
    ],
    ids=["null", "missing-data", "empty-data", "too-many", "missing-vector", "wrong-dimensions", "strings", "booleans"],
)
def test_invalid_provider_response_is_rejected(provider, monkeypatch, payload):
    monkeypatch.setattr(
        embeddings.httpx2, "post",
        lambda *args, **kwargs: httpx2.Response(
            200, content=json.dumps(payload),
            request=httpx2.Request("POST", "https://example.test/embeddings"),
        ),
    )
    with pytest.raises(ValueError, match="embedding"):
        embeddings.embed_query("问题")


def test_provider_http_failure_is_not_used_as_vector(provider, monkeypatch):
    monkeypatch.setattr(
        embeddings.httpx2, "post",
        lambda *args, **kwargs: httpx2.Response(
            503, json={"error": {"message": "unavailable"}},
            request=httpx2.Request("POST", "https://example.test/embeddings"),
        ),
    )
    with pytest.raises(httpx2.HTTPStatusError):
        embeddings.embed_query("问题")


def test_provider_timeout_propagates(provider, monkeypatch):
    def post(*args, **kwargs):
        raise httpx2.ReadTimeout("timed out")

    monkeypatch.setattr(embeddings.httpx2, "post", post)
    with pytest.raises(httpx2.ReadTimeout):
        embeddings.embed_query("问题")
