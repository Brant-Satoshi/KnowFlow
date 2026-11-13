"""调用模型（带工具）：OpenRouter 的 chat completions，非流式。工具调用循环每一轮调用它一次。"""

import logging

import anyio
import httpx2

from embeddings import _read_env

logger = logging.getLogger(__name__)

# 2026-11-13、11-14 实测：这个模型支持工具调用，tool_choice 的 auto / required / none 都照办
CHAT_MODEL = "deepseek/deepseek-chat-v3.1"


class ChatFailed(Exception):
    """模型服务没给出可用的回复。reason 可以返回给客户端，不放上游的原始信息。"""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _new_client() -> httpx2.AsyncClient:
    # 关掉 httpx 按单次读写计的超时，由 chat_with_tools 的总时限负责
    return httpx2.AsyncClient(timeout=None)


def _parse_message(payload: object) -> dict:
    """取出模型的那条 assistant 消息。它要么要求调用工具，要么给出回答；两样都没有就算失败。"""
    choices = payload.get("choices") if isinstance(payload, dict) else None
    first = choices[0] if isinstance(choices, list) and choices else None
    message = first.get("message") if isinstance(first, dict) else None
    if not isinstance(message, dict):
        raise ChatFailed("invalid_response")

    calls = message.get("tool_calls")
    if calls:
        for call in calls:
            function = call.get("function") if isinstance(call, dict) else None
            # 缺 id 或缺名字：没法给这次调用回结果。参数写得对不对不在这里查，留给循环
            if (
                not isinstance(call.get("id"), str)
                or not isinstance(function, dict)
                or not isinstance(function.get("name"), str)
            ):
                raise ChatFailed("invalid_response")
        return message

    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ChatFailed("invalid_response")
    return message


async def chat_with_tools(
    messages: list[dict], tools: list[dict], tool_choice: str, timeout: float
) -> dict:
    """调用一次模型，原样返回它的 assistant 消息。

    tool_choice：required 是这一次必须调用工具，auto 是由模型决定，none 是不许调用。
    timeout：这一次调用最多能用的秒数，覆盖连接、发送和读完响应。循环把总时限里剩下的时间传进来，
    所以总时限是硬的：正在进行的请求到点也会被打断。
    超时、连不上、上游报错、回复用不了，都抛 ChatFailed。
    """
    api_key = _read_env("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("Missing OPENROUTER_API_KEY")
    base_url = _read_env("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1"
    body = {
        "model": CHAT_MODEL,
        "messages": messages,
        "tools": tools,
        "tool_choice": tool_choice,
        "temperature": 0,
    }

    try:
        with anyio.fail_after(timeout):
            async with _new_client() as client:
                response = await client.post(
                    f"{base_url.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json=body,
                )
    except TimeoutError:
        raise ChatFailed("timeout") from None
    except httpx2.RequestError as exc:
        logger.warning("chat request failed: %s", type(exc).__name__)
        raise ChatFailed("network") from None

    if not response.is_success:
        logger.warning("chat bad response: %s %s", response.status_code, response.text[:200])
        raise ChatFailed("upstream_error")
    try:
        payload = response.json()
    except ValueError:
        raise ChatFailed("invalid_response") from None
    return _parse_message(payload)
