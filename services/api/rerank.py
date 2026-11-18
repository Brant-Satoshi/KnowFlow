"""重排：沿用 lib/models.ts 和 lib/rag/rerank.ts 的 OpenRouter 配置。"""

from collections.abc import Awaitable, Callable
import logging
import math

import anyio
import httpx2

from embeddings import _read_env

logger = logging.getLogger(__name__)

RERANK_TIMEOUT_SECONDS = 15.0  # TS 的 LLM_TIMEOUTS.rerankMs
DISCONNECT_POLL_SECONDS = 0.1


class RerankFailed(Exception):
    """重排服务没给出可用结果，调用方退回召回顺序。reason 会返回给客户端，不放上游的原始信息。"""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class RerankCancelled(Exception):
    """客户端断开了：不算服务故障，不退回召回顺序。"""


def is_rerank_enabled() -> bool:
    return (_read_env("RERANK_ENABLED") or "true").lower() == "true"


def _new_client() -> httpx2.AsyncClient:
    # 关掉 httpx 按单次读写计的超时，由 _call_provider 的总时限负责
    return httpx2.AsyncClient(timeout=None)


async def _call_provider(url: str, api_key: str, body: dict, timeout: float) -> object:
    try:
        # 时限覆盖连接、发送和读完响应体：client.post 读完整个响应才返回
        with anyio.fail_after(timeout):
            async with _new_client() as client:
                response = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json=body,
                )
    except TimeoutError:
        raise RerankFailed("timeout") from None
    except httpx2.RequestError as exc:
        logger.warning("rerank request failed: %s", type(exc).__name__)
        raise RerankFailed("network") from None

    if not response.is_success:
        logger.warning("rerank bad response: %s %s", response.status_code, response.text[:200])
        raise RerankFailed("upstream_error")
    try:
        return response.json()
    except ValueError:
        raise RerankFailed("invalid_response") from None


def _parse_results(payload: object, document_count: int) -> list[tuple[int, float | None]]:
    """取出 (文档下标, 分数)。和 TS 一样跳过下标不合法或重复的项；一项都不剩就算失败。"""
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list):
        raise RerankFailed("invalid_response")

    parsed: list[tuple[int, float | None]] = []
    used = set()
    for item in results:
        index = item.get("index") if isinstance(item, dict) else None
        if type(index) is not int or not 0 <= index < document_count or index in used:
            continue
        score = item.get("relevance_score")
        valid_score = type(score) in (int, float) and math.isfinite(score)
        parsed.append((index, score if valid_score else None))
        used.add(index)
    if not parsed:
        raise RerankFailed("invalid_response")
    return parsed


async def rerank_documents(
    query: str,
    documents: list[str],
    top_n: int,
    is_disconnected: Callable[[], Awaitable[bool]],
    timeout: float = RERANK_TIMEOUT_SECONDS,
) -> list[tuple[int, float | None]]:
    """返回按相关性排好的 (文档下标, 分数)。

    服务失败或超时抛 RerankFailed；等待期间客户端断开就取消请求，抛 RerankCancelled。
    """
    api_key = _read_env("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("Missing OPENROUTER_API_KEY")
    base_url = _read_env("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1"
    model = _read_env("OPENROUTER_RERANK_MODEL") or "cohere/rerank-v3.5"
    url = f"{base_url.rstrip('/')}/rerank"
    body = {"model": model, "query": query, "documents": documents, "top_n": top_n}

    outcome: list[object] = []
    disconnected = False

    # 两个任务谁先结束，就取消另一个
    async with anyio.create_task_group() as group:

        async def call() -> None:
            try:
                outcome.append(await _call_provider(url, api_key, body, timeout))
            except RerankFailed as exc:
                outcome.append(exc)
            group.cancel_scope.cancel()

        async def watch_disconnect() -> None:
            nonlocal disconnected
            while not await is_disconnected():
                await anyio.sleep(DISCONNECT_POLL_SECONDS)
            disconnected = True
            group.cancel_scope.cancel()

        group.start_soon(call)
        group.start_soon(watch_disconnect)

    if disconnected:
        raise RerankCancelled()
    if isinstance(outcome[0], RerankFailed):
        raise outcome[0]
    return _parse_results(outcome[0], len(documents))
