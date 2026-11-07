import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Settings:
    database_path: Path = BACKEND_DIR / "storage" / "datadoom.sqlite3"
    evaluator_url: str = "http://127.0.0.1:8001"
    organizer_get_url: str | None = None
    upstream_timeout: float = 60.0
    allow_fixture: bool = False
    frontend_dir: Path = BACKEND_DIR.parent / "frontend" / "dist"

    @classmethod
    def from_env(cls) -> "Settings":
        timeout = float(os.getenv("UPSTREAM_TIMEOUT_SECONDS", "60"))
        if not 0 < timeout <= 60:
            raise ValueError("UPSTREAM_TIMEOUT_SECONDS must be greater than 0 and at most 60")
        return cls(
            database_path=Path(os.getenv("DATABASE_PATH", str(cls.database_path))),
            evaluator_url=os.getenv("EVALUATOR_URL", cls.evaluator_url).rstrip("/"),
            organizer_get_url=os.getenv("ORGANIZER_GET_URL") or None,
            upstream_timeout=timeout,
            allow_fixture=os.getenv("BACKEND_ALLOW_FIXTURE", "false").lower() == "true",
            frontend_dir=Path(os.getenv("FRONTEND_DIST", str(cls.frontend_dir))),
        )
