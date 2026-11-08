import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Settings
from .database import Database
from .errors import APIError
from .export import build_results
from .jobs import Jobs, JobWorkers
from .models import (
    AppealCreate,
    Checklist,
    ChecklistCreate,
    ChecklistList,
    Conversation,
    ConversationLatestList,
    ConversationList,
    Decision,
    Evaluation,
    EvaluationCreate,
    EvaluationJob,
    EvaluationList,
    ImportRequest,
    ImportResult,
    JobBatch,
    JobList,
    Nonblank,
)
from .service import Service
from .upstream import Upstream


class RequestLimit:
    """Bound JSON uploads before parsing, including requests without Content-Length."""

    def __init__(self, app: ASGIApp, max_bytes: int = 25_000_000) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > self.max_bytes:
                response = JSONResponse(
                    status_code=422,
                    content={
                        "error": {
                            "code": "invalid_input",
                            "message": "Request exceeds the 25 MB limit.",
                        }
                    },
                )
                await response(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        delivered = False

        async def replay() -> Message:
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)


def get_service(request: Request) -> Service:
    service: Service = request.app.state.service
    return service


ServiceDep = Annotated[Service, Depends(get_service)]
router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict[str, Literal["ok"]]:
    return {"status": "ok"}


@router.post("/imports")
def import_conversations(body: ImportRequest, service: ServiceDep) -> ImportResult:
    return service.import_records(body)


@router.get("/conversations")
def list_conversations(
    service: ServiceDep,
    group_id: Annotated[Nonblank | None, Query()] = None,
    include: Annotated[Literal["latest"] | None, Query()] = None,
) -> ConversationList | ConversationLatestList:
    if include == "latest":
        return ConversationLatestList(items=service.list_conversations_latest(group_id))
    return ConversationList(items=service.list_conversations(group_id))


@router.get("/conversations/{key}")
def get_conversation(key: str, service: ServiceDep) -> Conversation:
    return service.get_conversation(key)


@router.get("/checklists")
def list_checklists(service: ServiceDep) -> ChecklistList:
    return ChecklistList(items=service.list_checklists())


@router.post("/checklists", status_code=201)
def create_checklist(body: ChecklistCreate, service: ServiceDep) -> Checklist:
    return service.create_checklist(body)


@router.post("/evaluations", status_code=201)
def evaluate(body: EvaluationCreate, service: ServiceDep) -> Evaluation:
    return service.evaluate(
        body.conversation_key, body.checklist_version_id, reason_locale=body.reason_locale
    )


@router.get("/evaluations")
def list_evaluations(
    conversation_key: Annotated[Nonblank, Query()],
    service: ServiceDep,
) -> EvaluationList:
    return EvaluationList(items=service.list_evaluations(conversation_key))


@router.get("/evaluations/{id}")
def get_evaluation(id: str, service: ServiceDep) -> Evaluation:
    return service.get_evaluation(id)


@router.post("/evaluations/{id}/appeals", status_code=201)
def appeal(id: str, body: AppealCreate, service: ServiceDep) -> Evaluation:
    return service.create_appeal(id, body)


@router.post("/evaluations/{id}/appeals/{criterion_id:path}/decision")
def decide(id: str, criterion_id: str, body: Decision, service: ServiceDep) -> Evaluation:
    return service.decide(id, criterion_id, body)


@router.post("/evaluation-jobs", status_code=202)
def enqueue_job(body: EvaluationCreate, service: ServiceDep) -> EvaluationJob:
    return Jobs(service).enqueue(body)


@router.post("/evaluation-jobs/batch", status_code=202)
def enqueue_batch(body: JobBatch, service: ServiceDep) -> JobList:
    return JobList(items=Jobs(service).batch(body))


@router.get("/evaluation-jobs")
def list_jobs(
    service: ServiceDep,
    conversation_key: Annotated[Nonblank | None, Query()] = None,
    active: bool = False,
) -> JobList:
    return JobList(items=Jobs(service).list_jobs(conversation_key, active))


@router.get("/evaluation-jobs/{id}")
def get_job(id: str, service: ServiceDep) -> EvaluationJob:
    return Jobs(service).get(id)


@router.post("/evaluation-jobs/{id}/cancel")
def cancel_job(id: str, service: ServiceDep) -> EvaluationJob:
    return Jobs(service).cancel(id)


@router.get("/judges")
def judges(service: ServiceDep) -> dict[str, object]:
    return service.upstream.judges()


@router.get("/exports/results")
def export_results(
    service: ServiceDep,
    group_id: Annotated[Nonblank, Query()],
    checklist_version_id: Annotated[Nonblank, Query()],
    team_name: Annotated[Nonblank | None, Query()] = None,
    use_final: bool = False,
) -> JSONResponse:
    team = team_name or service.upstream.settings.results_team_name
    if not team:
        raise APIError(422, "invalid_input", "A team name is required for export.")
    document = build_results(
        service.database, group_id, checklist_version_id, team, use_final=use_final
    )
    return JSONResponse(
        content=document.model_dump(),
        headers={
            "Content-Disposition": 'attachment; filename="results.json"',
        },
    )


def create_app(settings: Settings | None = None, *, start_workers: bool = True) -> FastAPI:
    config = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # HTTP transport diagnostics can include the complete signed organizer URL.
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        database = Database(config.database_path)
        database.initialize()
        with httpx.Client(trust_env=False) as client:
            app.state.service = Service(database, Upstream(config, client))
            Jobs(app.state.service).recover()
            workers = JobWorkers(database, config)
            if start_workers:
                workers.start()
            try:
                yield
            finally:
                workers.stop()

    application = FastAPI(title="Datadoom Backend", version="1.0.0", lifespan=lifespan)
    application.add_middleware(RequestLimit)

    @application.exception_handler(APIError)
    async def api_error(request: Request, exc: APIError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    @application.exception_handler(RequestValidationError)
    async def invalid_input(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Pydantic errors contain input values; never echo transcripts or secrets.
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "invalid_input",
                    "message": (
                        "Request does not match the API contract. "
                        "Check required fields and allowed values."
                    ),
                }
            },
        )

    @application.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        if exc.status_code == 400 and request.url.path.startswith("/api/"):
            return JSONResponse(
                status_code=422,
                content={
                    "error": {
                        "code": "invalid_input",
                        "message": "Request body must contain valid JSON.",
                    }
                },
            )
        return JSONResponse(
            status_code=exc.status_code,
            headers=exc.headers,
            content={
                "error": {
                    "code": "http_error",
                    "message": "Route not found."
                    if exc.status_code == 404
                    else "Request cannot be handled.",
                }
            },
        )

    @application.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "An internal error occurred. Please retry.",
                }
            },
        )

    @application.middleware("http")
    async def prevent_cache(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    application.include_router(router)
    if config.frontend_dir.is_dir():
        application.frontend("/", directory=str(config.frontend_dir))
    return application


app = create_app()
