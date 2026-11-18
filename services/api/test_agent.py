import copy
import json
import logging

import pytest

from agent import (
    MAX_MODEL_CALLS,
    MAX_SECONDS,
    NO_RESULTS_TEXT,
    REFUSAL_TEXT_EN,
    REFUSAL_TEXT_ZH,
    build_system_prompt,
    run_agent,
    run_loop,
)
from chat import ChatFailed

# 工具调用循环：模型和检索都是假的，不联网、不连数据库。
# 规则是 2026-11-13、11-14 在 study/mini-rag 里一条一条定下来、用真实模型试过的，这里是搬过来以后的测试。


class ScriptedModel:
    """假模型：按顺序返回写好的回复，记下每次收到的 messages、tool_choice 和剩余时间。

    messages 要深拷贝：循环会继续往同一个列表里追加，不拷贝就看不到调用那一刻的样子。
    回复是异常时抛出它，用来模拟模型调用失败。
    """

    def __init__(self, replies):
        self.replies = list(replies)
        self.received = []
        self.tool_choices = []
        self.timeouts = []

    def __call__(self, messages, tool_choice, timeout):
        self.received.append(copy.deepcopy(messages))
        self.tool_choices.append(tool_choice)
        self.timeouts.append(timeout)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


class FakeSearch:
    """假检索：记下收到的 query，返回 (交给模型的文本, 查到几个片段)。"""

    def __init__(self):
        self.queries = []

    def __call__(self, query):
        self.queries.append(query)
        return f"检索结果：{query}", 1


class FakeClock:
    """假时钟：测试里手动拨快，不用真的等。"""

    def __init__(self):
        self.seconds = 0.0

    def __call__(self):
        return self.seconds


def raw_tool_reply(*calls):
    """模型要求调用工具的回复，calls 是若干 (id, 工具名, 参数原文)。"""
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}
            for call_id, name, arguments in calls
        ],
    }


def tool_reply(*calls):
    """模型要求检索的回复，calls 是若干 (id, query)。"""
    return raw_tool_reply(
        *[(call_id, "search_knowledge_base", json.dumps({"query": query})) for call_id, query in calls]
    )


def answer_reply(text):
    return {"role": "assistant", "content": text}


def loop(model, search=None, now=None):
    """跑一次循环，返回 (回答, 停下的原因, 每一步的记录, 最后的 messages)。"""
    messages = [{"role": "user", "content": "测试问题？"}]
    steps = []
    answer, stop_reason = run_loop(
        "req-1", messages, model, search or FakeSearch(), steps, now or FakeClock()
    )
    return answer, stop_reason, steps, messages


# ---------- 消息怎么来回传 ----------


def test_tool_result_sent_back_before_next_call():
    call = tool_reply(("call_1", "首席研究员"))
    model = ScriptedModel([call, answer_reply("埃琳娜·科瓦奇博士 [1]")])
    search = FakeSearch()
    answer, stop_reason, _, _ = loop(model, search)
    assert (answer, stop_reason) == ("埃琳娜·科瓦奇博士 [1]", "answered")
    assert search.queries == ["首席研究员"]
    # 第 2 次调用模型时：原来的消息 → 模型要求调用工具的那条 → 工具结果（带上对应的 id）
    assert model.received[1] == [
        {"role": "user", "content": "测试问题？"},
        call,
        {"role": "tool", "tool_call_id": "call_1", "content": "检索结果：首席研究员"},
    ]


def test_every_tool_call_in_one_reply_gets_a_result():
    call = tool_reply(("call_a", "甲"), ("call_b", "乙"))
    model = ScriptedModel([call, answer_reply("回答")])
    search = FakeSearch()
    loop(model, search)
    assert search.queries == ["甲", "乙"]
    assert model.received[1][1:] == [
        call,
        {"role": "tool", "tool_call_id": "call_a", "content": "检索结果：甲"},
        {"role": "tool", "tool_call_id": "call_b", "content": "检索结果：乙"},
    ]


# ---------- tool_choice：必须先检索，最后一次不许查 ----------


def test_must_search_first_and_may_not_search_last():
    replies = [tool_reply((f"call_{i}", f"第 {i} 次查")) for i in range(1, MAX_MODEL_CALLS)]
    model = ScriptedModel(replies + [answer_reply("回答")])
    answer, stop_reason, _, _ = loop(model)
    assert (answer, stop_reason) == ("回答", "answered")
    assert model.tool_choices == ["required"] + ["auto"] * (MAX_MODEL_CALLS - 2) + ["none"]


def test_rejected_call_does_not_count_as_search():
    bad = raw_tool_reply(("call_1", "search_knowledge_base", "{"))
    model = ScriptedModel([bad, tool_reply(("call_2", "首席研究员")), answer_reply("回答")])
    loop(model)
    assert model.tool_choices == ["required", "required", "auto"]


def test_answer_without_search_is_not_released():
    # 接口万一没照办 required、模型直接回答了：回答不放出去
    model = ScriptedModel([answer_reply("直接回答")])
    search = FakeSearch()
    answer, stop_reason, _, _ = loop(model, search)
    assert (answer, stop_reason) == (None, "no_search")
    assert search.queries == []


def test_stops_at_max_model_calls_when_model_ignores_none():
    # 接口万一没照办 none、最后一次还在要求调用工具：不执行，停下
    replies = [tool_reply((f"call_{i}", "再查一次")) for i in range(MAX_MODEL_CALLS + 2)]
    model = ScriptedModel(replies)
    search = FakeSearch()
    answer, stop_reason, _, _ = loop(model, search)
    assert (answer, stop_reason) == (None, "max_model_calls")
    assert len(model.received) == MAX_MODEL_CALLS
    assert len(search.queries) == MAX_MODEL_CALLS - 1


def test_never_searched_keeps_required_until_the_end():
    replies = [
        raw_tool_reply((f"call_{i}", "search_knowledge_base", "{")) for i in range(MAX_MODEL_CALLS + 2)
    ]
    model = ScriptedModel(replies)
    answer, stop_reason, _, _ = loop(model)
    assert (answer, stop_reason) == (None, "max_model_calls")
    assert model.tool_choices == ["required"] * MAX_MODEL_CALLS


# ---------- 调用写错：把错误说明交回模型 ----------


@pytest.mark.parametrize(
    "arguments",
    ['{"query": "首席研究员"', '{"q": "首席研究员"}', '{"query": 42}', '{"query": "  "}', '["首席研究员"]', ""],
    ids=["不是合法 JSON", "没有 query", "query 不是字符串", "query 是空白", "参数不是对象", "参数是空字符串"],
)
def test_bad_arguments_sent_back_as_error(arguments):
    bad = raw_tool_reply(("call_1", "search_knowledge_base", arguments))
    model = ScriptedModel([bad, tool_reply(("call_2", "首席研究员")), answer_reply("回答")])
    search = FakeSearch()
    answer, stop_reason, _, _ = loop(model, search)
    assert (answer, stop_reason) == ("回答", "answered")
    # 写错的那次没有执行，改正后的那次执行了
    assert search.queries == ["首席研究员"]
    error_message = model.received[1][-1]
    assert error_message["role"] == "tool"
    assert error_message["tool_call_id"] == "call_1"
    assert error_message["content"].startswith("Error:")


def test_unknown_tool_not_executed():
    bad = raw_tool_reply(("call_1", "delete_knowledge_base", '{"query": "首席研究员"}'))
    model = ScriptedModel([bad, tool_reply(("call_2", "换个词")), answer_reply("回答")])
    search = FakeSearch()
    loop(model, search)
    assert search.queries == ["换个词"]
    content = model.received[1][-1]["content"]
    assert content.startswith("Error:")
    # 错误说明里写了它要的名字和能用的名字，方便模型改正
    assert "delete_knowledge_base" in content
    assert "search_knowledge_base" in content


def test_model_cannot_pick_the_knowledge_base():
    # 模型在参数里塞进别的知识库：检索只收到 query。查哪个知识库由服务端按登录用户的请求决定
    arguments = json.dumps({"query": "首席研究员", "knowledge_base_id": "别人的知识库", "knowledgeBaseId": "别人的"})
    model = ScriptedModel(
        [raw_tool_reply(("call_1", "search_knowledge_base", arguments)), answer_reply("回答")]
    )
    search = FakeSearch()
    answer, stop_reason, _, _ = loop(model, search)
    assert (answer, stop_reason) == ("回答", "answered")
    assert search.queries == ["首席研究员"]


# ---------- 模型改不了的错：停下 ----------


def test_search_failure_stops_loop(caplog):
    def broken_search(query):
        raise TimeoutError("embedding 接口超时")

    model = ScriptedModel([tool_reply(("call_1", "首席研究员")), answer_reply("不该走到这里")])
    with caplog.at_level(logging.ERROR, logger="agent"):
        answer, stop_reason, _, _ = loop(model, broken_search)
    assert (answer, stop_reason) == (None, "tool_failed")
    assert len(model.received) == 1
    # 返回值只说“工具失败”，真正的原因留在日志里，带着 requestId
    assert "embedding 接口超时" in caplog.text
    assert "req-1" in caplog.text


def test_model_failure_stops_loop():
    model = ScriptedModel([tool_reply(("call_1", "首席研究员")), ChatFailed("upstream_error")])
    answer, stop_reason, _, _ = loop(model)
    assert (answer, stop_reason) == (None, "model_failed")


def test_model_timeout_counts_as_timeout():
    # 剩余时间用完、正在进行的请求被打断：和“超过总时限”是同一个原因
    model = ScriptedModel([ChatFailed("timeout")])
    answer, stop_reason, _, _ = loop(model)
    assert (answer, stop_reason) == (None, "timeout")


# ---------- 总时限 ----------


def test_each_model_call_gets_the_remaining_time():
    clock = FakeClock()
    replies = [tool_reply(("call_1", "首席研究员")), answer_reply("回答")]
    scripted = ScriptedModel(replies)

    def model(messages, tool_choice, timeout):
        reply = scripted(messages, tool_choice, timeout)
        clock.seconds += 10  # 每次调用模型花 10 秒
        return reply

    loop(model, now=clock)
    assert scripted.timeouts == [MAX_SECONDS, MAX_SECONDS - 10]


def test_stops_when_time_is_up():
    clock = FakeClock()
    scripted = ScriptedModel([tool_reply((f"call_{i}", "再查一次")) for i in range(MAX_MODEL_CALLS + 2)])

    def slow_model(messages, tool_choice, timeout):
        clock.seconds += MAX_SECONDS / 2 + 1
        return scripted(messages, tool_choice, timeout)

    answer, stop_reason, _, _ = loop(slow_model, now=clock)
    assert (answer, stop_reason) == (None, "timeout")
    # 超时后不再开始第 3 次调用
    assert len(scripted.received) == 2


# ---------- 每一步的记录 ----------


def test_steps_record_every_model_call_and_tool_call(caplog):
    bad = raw_tool_reply(("call_1", "delete_knowledge_base", "{}"))
    model = ScriptedModel([bad, tool_reply(("call_2", "首席研究员")), answer_reply("回答")])
    with caplog.at_level(logging.INFO, logger="agent"):
        _, _, steps, _ = loop(model)
    assert [step["type"] for step in steps] == [
        "model_call", "tool_call", "model_call", "tool_call", "model_call",
    ]
    assert steps[0] == {"type": "model_call", "toolChoice": "required", "result": "tool_calls"}
    assert steps[1]["id"] == "call_1" and steps[1]["error"].startswith("Error:")
    assert steps[3] == {"type": "tool_call", "id": "call_2", "query": "首席研究员", "found": 1}
    assert steps[4] == {"type": "model_call", "toolChoice": "auto", "result": "answer"}
    # 日志和记录一样，一步一行
    assert len(caplog.records) == len(steps)


# ---------- 整条链路：编号、引用、拒答 ----------

CHUNK_A = {"id": "file-1-0", "fileId": "file-1", "fileName": "a.md", "text": "首席研究员是埃琳娜·科瓦奇博士。"}
CHUNK_B = {"id": "file-1-1", "fileId": "file-1", "fileName": "a.md", "text": "初始资金是 4.2 亿信用点。"}
CHUNK_C = {"id": "file-2-0", "fileId": "file-2", "fileName": "b.md", "text": "基地在奥林匹斯山。"}


def agent(model, results, question="首席研究员是谁？", history=()):
    """results：检索词 → 查到的片段；没列出的检索词查到的是空。"""

    def search_chunks(query):
        return results.get(query, [])

    return run_agent("req-1", question, list(history), model, search_chunks, FakeClock())


def test_answer_with_citations():
    model = ScriptedModel(
        [tool_reply(("call_1", "首席研究员")), answer_reply("埃琳娜·科瓦奇博士 [1]")]
    )
    result = agent(model, {"首席研究员": [CHUNK_A, CHUNK_B]})
    assert result["answer"] == "埃琳娜·科瓦奇博士 [1]"
    assert result["citations"] == [{"number": 1, "chunk": CHUNK_A}]
    assert result["refusal"] is None
    assert result["completed"] is True
    assert result["stopReason"] == "answered"
    # 交回模型的检索结果带编号
    tool_message = model.received[1][-1]["content"]
    assert "[1] 首席研究员是埃琳娜·科瓦奇博士。" in tool_message
    assert "[2] 初始资金是 4.2 亿信用点。" in tool_message


def test_numbers_continue_across_searches_and_repeat_for_the_same_chunk():
    model = ScriptedModel(
        [
            tool_reply(("call_1", "首席研究员")),
            tool_reply(("call_2", "基地")),
            answer_reply("科瓦奇博士 [1]，基地在奥林匹斯山 [3]"),
        ]
    )
    result = agent(model, {"首席研究员": [CHUNK_A, CHUNK_B], "基地": [CHUNK_B, CHUNK_C]})
    second = model.received[2][-1]["content"]
    # 乙第二次被检索到，沿用编号 2；丙是新片段，拿编号 3。否则两次检索都有 [1]，回答里的 [1] 对不回原文
    assert "[2] 初始资金是 4.2 亿信用点。" in second
    assert "[3] 基地在奥林匹斯山。" in second
    assert result["citations"] == [{"number": 1, "chunk": CHUNK_A}, {"number": 3, "chunk": CHUNK_C}]


def test_citations_the_tool_never_returned_are_dropped():
    # 引用了没返回过的编号、重复的编号、[0]：都不进引用列表
    model = ScriptedModel(
        [tool_reply(("call_1", "首席研究员")), answer_reply("科瓦奇博士 [1][1]，另见 [7] 和 [0]")]
    )
    result = agent(model, {"首席研究员": [CHUNK_A]})
    assert result["citations"] == [{"number": 1, "chunk": CHUNK_A}]


def test_program_refuses_when_every_search_is_empty():
    model = ScriptedModel(
        [
            tool_reply(("call_1", "红烧肉")),
            tool_reply(("call_2", "食谱")),
            answer_reply("红烧肉的做法：五花肉切块，焯水后加冰糖炒色……"),
        ]
    )
    result = agent(model, {}, question="怎么做红烧肉？")
    assert result["refusal"] == "empty"
    # 模型凭自己的知识写的做法没有放出去
    assert result["answer"] == REFUSAL_TEXT_ZH
    assert result["citations"] == []
    assert result["completed"] is True
    # 单次为空时照旧把“没找到”交回模型，它还能换词再查
    assert model.received[1][-1]["content"] == NO_RESULTS_TEXT


def test_program_refuses_at_limit_when_every_search_is_empty():
    replies = [tool_reply((f"call_{i}", "再查一次")) for i in range(MAX_MODEL_CALLS + 2)]
    result = agent(ScriptedModel(replies), {}, question="怎么做红烧肉？")
    assert result["refusal"] == "empty"
    assert result["answer"] == REFUSAL_TEXT_ZH
    assert result["completed"] is True
    assert result["stopReason"] == "max_model_calls"


def test_one_search_with_results_is_enough():
    model = ScriptedModel(
        [
            tool_reply(("call_1", "谁是老大")),
            tool_reply(("call_2", "首席研究员")),
            answer_reply("埃琳娜·科瓦奇博士 [1]"),
        ]
    )
    result = agent(model, {"首席研究员": [CHUNK_A]}, question="谁是老大？")
    assert result["refusal"] is None
    assert result["citations"] == [{"number": 1, "chunk": CHUNK_A}]


def test_model_refusal_with_extra_text_is_still_a_refusal(caplog):
    # 查到了片段、但片段里没有答案：靠模型说。它在拒答句后面多写的内容不给用户，留一条日志
    model = ScriptedModel(
        [
            tool_reply(("call_1", "工资")),
            answer_reply(REFUSAL_TEXT_ZH + "\n\n资料里只提到了资金总额，没有提到工资。[1]"),
        ]
    )
    with caplog.at_level(logging.WARNING, logger="agent"):
        result = agent(model, {"工资": [CHUNK_B]}, question="项目成员的工资是多少？")
    assert result["refusal"] == "model"
    assert result["answer"] == REFUSAL_TEXT_ZH
    assert result["citations"] == []
    assert "资料里只提到了资金总额" in caplog.text


def test_exact_model_refusal_logs_no_warning(caplog):
    model = ScriptedModel([tool_reply(("call_1", "工资")), answer_reply(REFUSAL_TEXT_ZH + "\n")])
    with caplog.at_level(logging.WARNING, logger="agent"):
        result = agent(model, {"工资": [CHUNK_B]}, question="项目成员的工资是多少？")
    assert result["refusal"] == "model"
    assert caplog.records == []


def test_refusal_sentence_in_the_middle_is_not_a_refusal():
    answer = "首席研究员是科瓦奇博士 [1]。至于工资，" + REFUSAL_TEXT_ZH
    model = ScriptedModel([tool_reply(("call_1", "首席研究员")), answer_reply(answer)])
    result = agent(model, {"首席研究员": [CHUNK_A]})
    assert result["refusal"] is None
    assert result["answer"] == answer


def test_english_question_gets_the_english_refusal():
    model = ScriptedModel([tool_reply(("call_1", "braised pork")), answer_reply("Sear the pork…")])
    result = agent(model, {}, question="How do I cook braised pork?")
    assert result["refusal"] == "empty"
    assert result["answer"] == REFUSAL_TEXT_EN


def test_incomplete_when_limit_reached_with_material():
    # 查到过片段、到上限时模型还在要求调用工具：不是“每次都空”，标记没答完
    replies = [tool_reply((f"call_{i}", "首席研究员")) for i in range(MAX_MODEL_CALLS + 2)]
    result = agent(ScriptedModel(replies), {"首席研究员": [CHUNK_A]})
    assert result["completed"] is False
    assert result["stopReason"] == "max_model_calls"
    assert result["answer"] == ""
    assert result["refusal"] is None
    assert result["citations"] == []


def test_incomplete_when_search_fails():
    def broken(query):
        raise TimeoutError("embedding 接口超时")

    model = ScriptedModel([tool_reply(("call_1", "首席研究员")), answer_reply("不该走到这里")])
    result = run_agent("req-1", "首席研究员是谁？", [], model, broken, FakeClock())
    assert result["completed"] is False
    assert result["stopReason"] == "tool_failed"
    assert result["refusal"] is None


def test_history_sits_between_the_rules_and_the_question():
    history = [
        {"role": "user", "content": "首席研究员是谁？"},
        {"role": "assistant", "content": "埃琳娜·科瓦奇博士 [1]"},
    ]
    model = ScriptedModel([tool_reply(("call_1", "科瓦奇博士 职责")), answer_reply("负责科学方向 [1]")])
    agent(model, {"科瓦奇博士 职责": [CHUNK_A]}, question="她负责什么？", history=history)
    first = model.received[0]
    assert first[0]["role"] == "system"
    assert first[1:] == history + [{"role": "user", "content": "她负责什么？"}]


def test_system_prompt_names_the_refusal_sentence_for_the_question_language():
    assert REFUSAL_TEXT_ZH in build_system_prompt("首席研究员是谁？")
    assert REFUSAL_TEXT_EN in build_system_prompt("Who is the lead researcher?")
    # 历史里旧回答的 [1] 指的是当时的片段，不是这一轮的
    assert "earlier conversation turns" in build_system_prompt("她负责什么？")
