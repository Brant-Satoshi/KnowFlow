"""问题向量化：沿用 lib/models.ts 和 lib/rag/embeddings.ts 的 OpenRouter 配置。"""

import math
import os

import httpx2

EMBEDDING_DIMENSIONS = 1536  # chunks.embedding 是 vector(1536)


def _read_env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value.strip("'\"") if value else None


def embed_query(text: str) -> list[float]:
    """调用 OpenRouter，把一个问题转成向量；配置和网络错误交给调用方处理。

    配置在调用时才读取，get_embed_query() 提供依赖时不会检查密钥或发请求。
    """
    api_key = _read_env("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("Missing OPENROUTER_API_KEY")

    base_url = _read_env("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1"
    model = _read_env("OPENROUTER_EMBEDDING_MODEL") or "text-embedding-3-small"
    raw_dimensions = _read_env("OPENROUTER_EMBEDDING_DIMENSIONS")
    dimensions = None
    if raw_dimensions:
        try:
            dimensions = int(raw_dimensions)
        except ValueError:
            raise ValueError("OPENROUTER_EMBEDDING_DIMENSIONS must be a positive integer") from None
        if dimensions <= 0:
            raise ValueError("OPENROUTER_EMBEDDING_DIMENSIONS must be a positive integer")
    elif model.startswith("text-embedding-3"):
        dimensions = EMBEDDING_DIMENSIONS

    if dimensions is not None and dimensions != EMBEDDING_DIMENSIONS:
        raise ValueError("embedding dimensions must match chunks.embedding vector(1536)")

    body = {"model": model, "input": [text]}
    if dimensions is not None:
        body["dimensions"] = dimensions

    response = httpx2.post(
        f"{base_url.rstrip('/')}/embeddings",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=body,
        timeout=30.0,
    )
    response.raise_for_status()
    payload = response.json()
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        raise ValueError("embedding response must contain exactly one vector")
    vector = data[0].get("embedding")
    if not isinstance(vector, list) or len(vector) != EMBEDDING_DIMENSIONS:
        raise ValueError("embedding response must contain a 1536-dimensional vector")
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in vector):
        raise ValueError("embedding vector must contain finite numbers")
    return vector
