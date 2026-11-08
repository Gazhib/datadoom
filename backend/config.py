import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
# Friendly names for organizer group IDs. The signed URL stays in .env; only group_id changes.
ORGANIZER_GROUPS = {"CHECKER": "FBroker", "SWAP": "Swap"}


def parse_groups(raw: str) -> dict[str, str]:
    groups = {}
    for pair in raw.split(","):
        name, separator, upstream = (part.strip() for part in pair.partition("="))
        if not separator or not name or not upstream:
            raise ValueError("ORGANIZER_GROUPS must look like NAME=group_id,NAME=group_id")
        groups[name] = upstream
    return groups


@dataclass(frozen=True)
class Settings:
    database_path: Path = BACKEND_DIR / "storage" / "datadoom.sqlite3"
    evaluator_url: str = "http://127.0.0.1:8001"
    organizer_get_url: str | None = None
    organizer_groups: dict[str, str] = field(default_factory=lambda: dict(ORGANIZER_GROUPS))
    upstream_timeout: float = 60.0
    evaluator_timeout: float = 600.0
    evaluation_concurrency: int = 1
    evaluator_stream: bool = False
    results_team_name: str | None = None
    allow_fixture: bool = False
    frontend_dir: Path = BACKEND_DIR.parent / "frontend" / "dist"

    def __post_init__(self) -> None:
        for name, value, maximum in (
            ("UPSTREAM_TIMEOUT_SECONDS", self.upstream_timeout, 60),
            ("EVALUATOR_TIMEOUT_SECONDS", self.evaluator_timeout, 900),
        ):
            if not 0 < value <= maximum:
                raise ValueError(f"{name} must be greater than 0 and at most {maximum}")
        if (
            type(self.evaluation_concurrency) is not int
            or not 1 <= self.evaluation_concurrency <= 8
        ):
            raise ValueError("EVALUATION_CONCURRENCY must be an integer from 1 to 8")

    @classmethod
    def from_env(cls) -> "Settings":
        def number(name: str, default: str) -> float:
            try:
                return float(os.getenv(name, default))
            except ValueError:
                raise ValueError(f"{name} must be a number") from None

        try:
            concurrency = int(os.getenv("EVALUATION_CONCURRENCY", "1"))
        except ValueError:
            raise ValueError("EVALUATION_CONCURRENCY must be an integer from 1 to 8") from None
        raw = os.getenv("ORGANIZER_GROUPS")
        groups = parse_groups(raw) if raw else dict(ORGANIZER_GROUPS)
        return cls(
            database_path=Path(os.getenv("DATABASE_PATH", str(cls.database_path))),
            evaluator_url=os.getenv("EVALUATOR_URL", cls.evaluator_url).rstrip("/"),
            organizer_get_url=os.getenv("ORGANIZER_GET_URL") or None,
            organizer_groups=groups,
            upstream_timeout=number("UPSTREAM_TIMEOUT_SECONDS", "60"),
            evaluator_timeout=number("EVALUATOR_TIMEOUT_SECONDS", "600"),
            evaluation_concurrency=concurrency,
            evaluator_stream=os.getenv("EVALUATOR_STREAM", "false").lower() == "true",
            results_team_name=os.getenv("RESULTS_TEAM_NAME") or None,
            allow_fixture=os.getenv("BACKEND_ALLOW_FIXTURE", "false").lower() == "true",
            frontend_dir=Path(os.getenv("FRONTEND_DIST", str(cls.frontend_dir))),
        )
