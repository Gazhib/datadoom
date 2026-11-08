"""LangGraph orchestration for the panel and the single-repair judge loop."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import aclosing

import httpx

from .privacy import enabled  # Import before LangGraph so tracing is off at initialization.

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from .config import JudgesConfig
from .contracts import EvaluationRequest, EvaluationResult
from .errors import EvaluationError
from .graph_state import JudgeBranch, JudgeState, PanelState
from .judge import (
    Usage,
    Verdict,
    build_attempt,
    call_model,
    invalid_grades,
    log_invalid,
    repair_attempt,
    validate_attempt,
)
from .panel import Observe, aggregate, prepare_run, run_judge, timed_out
from .providers import Provider
from .scheduler import Seat, load_panel


def build_prompt(state: JudgeState) -> dict:
    return {"attempt": build_attempt(state["provider"], state["data"])}


async def infer(state: JudgeState) -> dict:
    try:
        completion = await call_model(state["client"], state["provider"], state["attempt"], state["name"])
    except EvaluationError as error:
        return {"error": error}
    return {"completion": completion, "usage": state.get("usage", Usage()).add(completion)}


def after_inference(state: JudgeState) -> str:
    return "failed" if "error" in state else "validate"


def validate(state: JudgeState) -> dict:
    try:
        return {"verdict": validate_attempt(state["completion"], state["data"], state["attempt"], state["usage"])}
    except ValueError as error:
        log_invalid(state["name"], state["provider"], state["attempt"], error)
        if state["attempt"].number == 2:
            return {"error": invalid_grades()}
        return {"problem": error}


def after_validation(state: JudgeState) -> str:
    return "done" if "verdict" in state else "failed" if "error" in state else "repair"


def repair(state: JudgeState) -> dict:
    return {"attempt": repair_attempt(state["attempt"], state["problem"]), "problem": None}


judge_builder = StateGraph(JudgeState)
judge_builder.add_node("build_prompt", build_prompt)
judge_builder.add_node("call_model", infer)
judge_builder.add_node("validate", validate)
judge_builder.add_node("repair", repair)
judge_builder.add_node("done", lambda _: {})
judge_builder.add_node("failed", lambda _: {})
judge_builder.add_edge(START, "build_prompt")
judge_builder.add_edge("build_prompt", "call_model")
judge_builder.add_conditional_edges("call_model", after_inference, ["validate", "failed"])
judge_builder.add_conditional_edges("validate", after_validation, ["done", "failed", "repair"])
judge_builder.add_edge("repair", "call_model")
judge_builder.add_edge("done", END)
judge_builder.add_edge("failed", END)
judge_graph = judge_builder.compile()


async def grade_in_graph(client: httpx.AsyncClient, provider: Provider, data: EvaluationRequest, name: str) -> Verdict:
    state = await judge_graph.ainvoke({"client": client, "provider": provider, "data": data, "name": name})
    if "error" in state:
        raise state["error"]
    return state["verdict"]


async def prepare(state: PanelState) -> dict:
    config, seats = (state["config"], state["seats"]) if "config" in state else load_panel()
    return {"config": config, "seats": seats, "run": await prepare_run(state["client"], config, seats, observe=state.get("observe"))}


def send_judges(state: PanelState) -> list[Send]:
    run = state["run"]
    return [Send("judge", JudgeBranch(run=run, data=state["data"], route=route)) for route in run.routes]


async def judge(state: JudgeBranch) -> dict:
    # The slot and timeout cover the entire judge subgraph, including its repair loop.
    outcome = await run_judge(
        state["run"], state["route"], state["data"], call=grade_in_graph, emit=get_stream_writer(),
    )
    return {"outcomes": [outcome]}


def combine(state: PanelState) -> dict:
    result = aggregate(state["run"], state["data"], state["outcomes"], state["emit_panel"])
    get_stream_writer()({"event": "result", "result": result.model_dump(exclude_unset=True)})
    return {"result": result}


builder = StateGraph(PanelState)
builder.add_node("prepare", prepare)
builder.add_node("judge", judge)
builder.add_node("aggregate", combine)
builder.add_edge(START, "prepare")
builder.add_conditional_edges("prepare", send_judges, ["judge"])
builder.add_edge("judge", "aggregate")
builder.add_edge("aggregate", END)
graph = builder.compile()


def inputs(
    client: httpx.AsyncClient, config: JudgesConfig, seats: list[Seat], data: EvaluationRequest,
    *, emit_panel: bool | None = None, observe: Observe | None = None,
) -> PanelState:
    state = PanelState(client=client, config=config, seats=seats, data=data, outcomes=[],
                       emit_panel=enabled("EVALUATOR_EMIT_PANEL") if emit_panel is None else emit_panel)
    if observe:
        state["observe"] = observe
    return state


async def run_graph(
    client: httpx.AsyncClient, config: JudgesConfig, seats: list[Seat], data: EvaluationRequest,
    *, emit_panel: bool | None = None, observe: Observe | None = None,
) -> EvaluationResult:
    try:
        async with asyncio.timeout(config.panel.timeout_seconds + 10):
            result = await graph.ainvoke(inputs(client, config, seats, data, emit_panel=emit_panel, observe=observe))
    except TimeoutError:
        raise timed_out() from None
    return result["result"]


async def stream_graph(
    client: httpx.AsyncClient, config: JudgesConfig, seats: list[Seat], data: EvaluationRequest
) -> AsyncIterator[dict]:
    try:
        async with asyncio.timeout(config.panel.timeout_seconds + 10):
            async with aclosing(graph.astream(inputs(client, config, seats, data), stream_mode="custom")) as events:
                async for event in events:
                    yield event
    except TimeoutError:
        raise timed_out() from None
