import asyncio
import json
import os
from contextlib import aclosing, suppress
from collections.abc import AsyncIterator
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.types import Receive, Scope, Send

from .config import MAX_TIMEOUT_SECONDS
from .contracts import EvaluationRequest, EvaluationResult
from .diagnostics import inspect, warmup
from .errors import EvaluationError
from .graph import run_graph, stream_graph
from .panel import run_panel
from .privacy import enabled
from .scheduler import load_panel


app = FastAPI(title="Datadoom evaluator")


@app.exception_handler(EvaluationError)
async def evaluation_error(_request: Request, error: EvaluationError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content={"error": {"code": error.code, "message": str(error)}},
    )


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, _error: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "invalid_request",
                "message": "The conversation or checklist does not match the evaluator contract.",
            }
        },
    )


async def provider_client() -> AsyncIterator[httpx.AsyncClient]:
    # The panel enforces the configured deadline. This bound only stops a stuck socket.
    timeout = httpx.Timeout(MAX_TIMEOUT_SECONDS, connect=3)
    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        yield client


def selected_engine() -> str:
    engine = os.getenv("EVALUATOR_ENGINE", "").strip().lower() or "langgraph"
    if engine not in {"langgraph", "legacy"}:
        raise EvaluationError(503, "provider_unavailable", "Set EVALUATOR_ENGINE to langgraph or legacy.")
    return engine


ProviderClient = Annotated[httpx.AsyncClient, Depends(provider_client)]


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/judges")
async def judges(client: ProviderClient) -> dict:
    config, seats = load_panel()
    rows = await inspect(client, seats)
    return {"execution": config.panel.execution, "quorum": config.quorum,
            "timeout_seconds": config.panel.timeout_seconds, "judges": [row.report() for row in rows]}


@app.post("/warmup")
async def warm_models(client: ProviderClient) -> dict:
    config, seats = load_panel()
    return await warmup(client, config, seats)


@app.post("/evaluate", response_model=EvaluationResult, response_model_exclude_unset=True)
async def evaluate(data: EvaluationRequest, client: ProviderClient) -> EvaluationResult:
    config, seats = load_panel()
    if selected_engine() == "langgraph":
        return await run_graph(client, config, seats, data)
    return await run_panel(client, config, seats, data, emit_panel=enabled("EVALUATOR_EMIT_PANEL"))


class EvaluationStream(StreamingResponse):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Watch for disconnects even while the next graph event is still being computed.
        writer = asyncio.create_task(self.stream_response(send))
        disconnect = asyncio.create_task(self.listen_for_disconnect(receive))
        try:
            done, _ = await asyncio.wait((writer, disconnect), return_when=asyncio.FIRST_COMPLETED)
            if writer in done:
                with suppress(OSError):  # ASGI 2.4+ can report disconnect on send.
                    writer.result()
            else:
                disconnect.result()
        finally:
            for task in (writer, disconnect):
                if not task.done():
                    task.cancel()
            await asyncio.gather(writer, disconnect, return_exceptions=True)
            await self.body_iterator.aclose()


@app.post("/evaluate/stream", response_class=StreamingResponse)
async def evaluate_stream(data: EvaluationRequest, client: ProviderClient) -> StreamingResponse:
    engine = selected_engine()
    config, seats = load_panel()

    def line(event: dict) -> str:
        return json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"

    async def events() -> AsyncIterator[str]:
        yield line({"event": "started", "judges": [seat.name for seat in seats]})
        try:
            if engine == "legacy":
                result = await run_panel(client, config, seats, data, emit_panel=enabled("EVALUATOR_EMIT_PANEL"))
                yield line({"event": "result", "result": result.model_dump(exclude_unset=True)})
            else:
                async with aclosing(stream_graph(client, config, seats, data)) as stream:
                    async for event in stream:
                        yield line(event)
        except EvaluationError as error:
            yield line({"event": "error", "status": error.status, "error": {"code": error.code, "message": str(error)}})

    return EvaluationStream(events(), media_type="application/x-ndjson")
