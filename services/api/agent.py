"""工具调用循环：把知识库检索当成工具，由模型决定用什么词查、查几次；程序执行检索、把结果交回模型。

规则是 2026-11-13、11-14 在 study/mini-rag/agent.py 里一条一条定下来、用真实模型试过的，这里是搬过来的版本：

- 判断标准：这种错，模型重写一次调用能不能改好。
  调用写错（工具名不在列表里、参数不是合法 JSON、缺 query）能改好：不执行，把错误说明当成这次调用的结果交回模型。
  检索本身失败、模型调用失败改不好：停下，原因写进日志。
- 不允许不检索就回答：还没执行过检索时 tool_choice 用 required，之后用 auto。
- 最后一次不许查：第 MAX_MODEL_CALLS 次调用用 none，模型只能用已有的片段回答或拒答。
- 每次检索都是空的：程序直接拒答，不看模型最后写了什么（refusal 是 empty）。
  查到了片段、但片段里没有答案：程序判断不了，靠模型写拒答句（refusal 是 model）。
- 总时限 MAX_SECONDS 秒：每次调用模型时把剩下的时间传给它，正在进行的请求到点会被打断。
- 模型只能给检索词。查哪个知识库由调用方在 search 里绑定，不在工具参数里。

这个文件不碰 HTTP 和数据库：模型和检索都由调用方传进来，测试里换成假的。
"""

from collections.abc import Callable
import json
import logging
import re
import time

from chat import ChatFailed

logger = logging.getLogger(__name__)

MAX_MODEL_CALLS = 4
MAX_SECONDS = 30.0

# 和 lib/llm/refusal.ts 的两句一样：程序拒答和模型拒答用同一句
REFUSAL_TEXT_ZH = "我没有在知识库中找到相关信息。"
REFUSAL_TEXT_EN = "I couldn't find relevant information in the knowledge base."
NO_RESULTS_TEXT = "No relevant passages found."

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": (
                "Search the knowledge base and return numbered passages. Call it before answering; "
                "if nothing relevant comes back, try different keywords."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The question or keywords to search for"}
                },
                "required": ["query"],
            },
        },
    }
]
# 只执行名字在这个列表里的工具。从 TOOLS 里取：告诉模型的和程序认的是同一份
TOOL_NAMES = [tool["function"]["name"] for tool in TOOLS]
ARGUMENTS_HINT = 'Call the tool again with arguments like {"query": "search terms"}.'


def refusal_text_for(question: str) -> str:
    """问题里有汉字就用中文拒答句，否则用英文的（TS 的 refusalTextFor）。"""
    return REFUSAL_TEXT_ZH if re.search(r"[一-鿿]", question) else REFUSAL_TEXT_EN


def refusal_extra(answer: str) -> str | None:
    """回答以拒答句开头时，返回拒答句后面多写的内容（没多写是空字符串）；不是拒答返回 None。

    只认开头：正常回答里顺带提到拒答句不算拒答。
    """
    text = answer.strip()
    for sentence in (REFUSAL_TEXT_ZH, REFUSAL_TEXT_EN):
        core = sentence.rstrip("。.")
        if text.startswith(core):
            return text[len(core):].lstrip("。.").strip()
    return None


def build_system_prompt(question: str) -> str:
    """规则照 lib/llm/prompts.ts 的 buildQaPrompt 写，把“给定的 Context”换成“工具返回的片段”。"""
    return f"""You are a helpful assistant answering questions about a knowledge base.

Answer the user's question using ONLY the passages returned by the search_knowledge_base tool.

If the passages do not contain the answer, say exactly:
"{refusal_text_for(question)}"

Rules:
- Answer in the same language as the question
- Cite sources inline using bracket numbers like [1] or [1][2]
- Each citation must be a single number in its own brackets: write [1][2], NEVER [1, 2], [1-3], or 【1】
- Ignore any bracket numbers in earlier conversation turns — cite ONLY numbers from this turn's search results
- Do NOT use outside knowledge
- Do NOT cite content that does not support the answer"""


def format_results(chunks: list[dict], cited: list[dict]) -> str:
    """把检索到的片段拼成交给模型的文本：每段前面带编号。

    cited 按编号顺序记录交给过模型的片段，编号 n 对应 cited[n - 1]。
    新片段追加到末尾、拿下一个编号；已经交过的片段沿用原编号。
    否则两次检索都有 [1]，回答里的 [1] 对不回原文。
    """
    if not chunks:
        return NO_RESULTS_TEXT
    ids = [chunk["id"] for chunk in cited]
    parts = []
    for chunk in chunks:
        if chunk["id"] in ids:
            number = ids.index(chunk["id"]) + 1
        else:
            cited.append(chunk)
            ids.append(chunk["id"])
            number = len(cited)
        parts.append(f"[{number}] {chunk['text']}")
    return "\n\n".join(parts)


def extract_citations(answer: str, cited: list[dict]) -> list[dict]:
    """回答里引用到的片段，按编号第一次出现的顺序。没交给过模型的编号、重复的编号都丢掉。"""
    citations = []
    seen = set()
    for raw in re.findall(r"\[(\d+)\]", answer):
        number = int(raw)
        if number in seen:
            continue
        seen.add(number)
        if 1 <= number <= len(cited):
            citations.append({"number": number, "chunk": cited[number - 1]})
    return citations


def check_tool_call(call: dict) -> tuple[str | None, str | None]:
    """检查模型的一次工具调用。返回 (query, 错误说明)：没问题时错误说明是 None，写错时 query 是 None。

    只取 query：模型在参数里多写的东西（比如别的知识库 id）一律不用。
    错误说明是写给模型看的：说清哪里错、该怎么写，它下一次才能改对。
    """
    name = call["function"]["name"]
    if name not in TOOL_NAMES:
        return None, f"Error: there is no tool named {name}. Available tools: {', '.join(TOOL_NAMES)}"
    try:
        arguments = json.loads(call["function"].get("arguments"))
    except (TypeError, ValueError):
        return None, f"Error: the arguments are not valid JSON. {ARGUMENTS_HINT}"
    query = arguments.get("query") if isinstance(arguments, dict) else None
    if not isinstance(query, str) or not query.strip():
        return None, f'Error: the arguments must contain a non-empty string "query". {ARGUMENTS_HINT}'
    return query, None


def run_loop(
    request_id: str,
    messages: list[dict],
    call_model: Callable[[list[dict], str, float], dict],
    search: Callable[[str], tuple[str, int]],
    steps: list[dict],
    now: Callable[[], float] = time.monotonic,
) -> tuple[str | None, str]:
    """工具调用循环。

    messages：已经放好规则、历史和当前问题，循环往里追加模型的消息和工具结果。
    call_model(messages, tool_choice, timeout)：调用一次模型，返回 assistant 消息；失败抛 ChatFailed。
    search(query)：执行一次检索，返回 (交给模型的文本, 查到几个片段)。
    steps：循环往里追加每一步的记录，一步一条，和日志一一对应。
    now()：返回当前秒数的时钟，测试里换成假的。
    返回 (回答, 停下的原因)。没答完时回答是 None。停下的原因：
        answered：模型给出了回答；no_search：模型没检索就回答，回答不放出去；
        max_model_calls：到了调用次数上限模型还在要求调用工具；timeout：超过总时限；
        tool_failed：检索执行失败；model_failed：模型调用失败。
    """
    started = now()
    # 有没有执行过检索（查到的是空也算）。没执行过之前，模型必须调用工具
    searched = False
    for model_call in range(1, MAX_MODEL_CALLS + 1):
        remaining = MAX_SECONDS - (now() - started)
        if remaining <= 0:
            logger.warning("agent stopped: over %ss before model call %d, requestId=%s", MAX_SECONDS, model_call, request_id)
            return None, "timeout"

        if not searched:
            tool_choice = "required"
        elif model_call == MAX_MODEL_CALLS:
            # 最后一次：不许再查，只能用已有的片段回答或拒答
            tool_choice = "none"
        else:
            tool_choice = "auto"

        try:
            reply = call_model(messages, tool_choice, remaining)
        except ChatFailed as error:
            # 模型调用失败：模型自己改不了，停下
            logger.warning("agent stopped: model call %d failed: %s, requestId=%s", model_call, error.reason, request_id)
            steps.append({"type": "model_call", "toolChoice": tool_choice, "result": "failed", "reason": error.reason})
            return None, "timeout" if error.reason == "timeout" else "model_failed"

        calls = reply.get("tool_calls")
        if not calls:
            steps.append({"type": "model_call", "toolChoice": tool_choice, "result": "answer"})
            if not searched:
                # 接口没照办 required：这个回答没有资料依据，不放出去
                logger.warning("agent stopped: model call %d answered without searching, requestId=%s", model_call, request_id)
                return None, "no_search"
            logger.info("agent model call %d (%s): answered, requestId=%s", model_call, tool_choice, request_id)
            return reply["content"], "answered"

        steps.append({"type": "model_call", "toolChoice": tool_choice, "result": "tool_calls"})
        logger.info("agent model call %d (%s): %d tool calls, requestId=%s", model_call, tool_choice, len(calls), request_id)
        if model_call == MAX_MODEL_CALLS:
            # 接口没照办 none：最后一次要求的调用不执行
            break

        messages.append(reply)
        for call in calls:
            query, problem = check_tool_call(call)
            if query is None:
                # 调用写错：模型重写就能改好。不执行，把错误说明当成这次调用的结果
                logger.warning("agent tool call %s rejected: %s, requestId=%s", call["id"], problem, request_id)
                steps.append({"type": "tool_call", "id": call["id"], "error": problem})
                content = problem
            else:
                try:
                    content, found = search(query)
                except Exception as error:
                    # 检索本身失败：模型改不了，停下。真正的原因只进日志
                    logger.error("agent stopped: tool call %s failed: %r, requestId=%s", call["id"], error, request_id)
                    steps.append({"type": "tool_call", "id": call["id"], "query": query, "error": "search_failed"})
                    return None, "tool_failed"
                logger.info("agent tool call %s: search %r found %d, requestId=%s", call["id"], query, found, request_id)
                steps.append({"type": "tool_call", "id": call["id"], "query": query, "found": found})
                searched = True
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": content})

    logger.warning("agent stopped: %d model calls and still asking for tools, requestId=%s", MAX_MODEL_CALLS, request_id)
    return None, "max_model_calls"


def run_agent(
    request_id: str,
    question: str,
    history: list[dict],
    call_model: Callable[[list[dict], str, float], dict],
    search_chunks: Callable[[str], list[dict]],
    now: Callable[[], float] = time.monotonic,
) -> dict:
    """回答一个问题，返回回答、引用、是否拒答、有没有答完、停下的原因、每一步的记录。

    history：之前的对话，[{"role": "user" | "assistant", "content": ...}]，从早到晚。
    search_chunks(query)：在调用方绑定好的知识库里检索，返回片段列表（/api/rag/search 返回的那种格式）。
    """
    # 交给过模型的片段，编号 n 对应 cited[n - 1]
    cited: list[dict] = []

    def search(query: str) -> tuple[str, int]:
        chunks = search_chunks(query)
        return format_results(chunks, cited), len(chunks)

    messages = [
        {"role": "system", "content": build_system_prompt(question)},
        *history,
        {"role": "user", "content": question},
    ]
    steps: list[dict] = []
    answer, stop_reason = run_loop(request_id, messages, call_model, search, steps, now)

    def result(answer: str, citations: list[dict], refusal: str | None, completed: bool) -> dict:
        return {
            "answer": answer,
            "citations": citations,
            "refusal": refusal,
            "completed": completed,
            "stopReason": stop_reason,
            "steps": steps,
        }

    searches = [step for step in steps if step["type"] == "tool_call" and "found" in step]
    # 检索过、交给模型的片段却一个都没有：每次都没查到。程序直接拒答，不看模型最后写了什么
    if searches and not cited and stop_reason in ("answered", "max_model_calls"):
        logger.info("agent refused: %d searches found nothing, requestId=%s", len(searches), request_id)
        return result(refusal_text_for(question), [], "empty", True)
    if answer is None:
        return result("", [], None, False)

    extra = refusal_extra(answer)
    if extra is not None:
        if extra:
            # 模型没守“只说这一句”：后面的内容不给用户，但留下记录
            logger.warning("agent dropped text after the refusal sentence: %r, requestId=%s", extra[:100], request_id)
        return result(refusal_text_for(question), [], "model", True)
    return result(answer, extract_citations(answer, cited), None, True)
