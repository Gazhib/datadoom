from collections.abc import AsyncIterator
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import MAX_TIMEOUT_SECONDS, load_judges
from .contracts import EvaluationRequest, EvaluationResult
from .errors import EvaluationError
from .panel import configured_seats, run_panel


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


@app.post("/evaluate", response_model=EvaluationResult)
async def evaluate(
    data: EvaluationRequest, client: Annotated[httpx.AsyncClient, Depends(provider_client)]
) -> EvaluationResult:
    try:
        # Read per request so edits to judges.yaml apply to the next evaluation.
        config = load_judges()
        seats = configured_seats(config)
    except ValueError as error:
        raise EvaluationError(503, "provider_unavailable", str(error)) from None
    return await run_panel(client, config, seats, data)
