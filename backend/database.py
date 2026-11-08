import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .rubric import default_checklist

# Ordered local schema migrations. Never recreate a populated database on startup.
MIGRATIONS = [
    [
        """CREATE TABLE conversations (
            key TEXT PRIMARY KEY,
            group_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            source_json TEXT NOT NULL,
            payload TEXT NOT NULL,
            UNIQUE(group_id, conversation_id)
        )""",
        """CREATE TABLE checklists (
            version_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL
        )""",
        """CREATE TABLE evaluations (
            id TEXT PRIMARY KEY,
            conversation_key TEXT NOT NULL REFERENCES conversations(key),
            checklist_version_id TEXT NOT NULL REFERENCES checklists(version_id),
            mode TEXT NOT NULL CHECK(mode IN ('live', 'fixture')),
            payload TEXT NOT NULL
        )""",
        """CREATE INDEX evaluation_resume
            ON evaluations(conversation_key, checklist_version_id, mode)""",
        """CREATE TABLE appeals (
            evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
            criterion_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            decision_json TEXT,
            PRIMARY KEY(evaluation_id, criterion_id)
        )""",
    ],
    [
        """CREATE TABLE evaluation_jobs (
            id TEXT PRIMARY KEY,
            conversation_key TEXT NOT NULL REFERENCES conversations(key),
            checklist_version_id TEXT NOT NULL REFERENCES checklists(version_id),
            status TEXT NOT NULL CHECK(status IN
                ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            evaluation_id TEXT REFERENCES evaluations(id),
            error_json TEXT,
            progress_json TEXT
        )""",
        "CREATE INDEX evaluation_jobs_status ON evaluation_jobs(status)",
    ],
    [
        "ALTER TABLE evaluation_jobs ADD COLUMN reason_locale TEXT "
        "CHECK (reason_locale IN ('en', 'ru', 'kk'))",
    ],
]


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def transaction(self, *, write: bool = False) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.transaction(write=True) as connection:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version > len(MIGRATIONS):
                raise RuntimeError("Database schema is newer than this backend")
            for index in range(version, len(MIGRATIONS)):
                for statement in MIGRATIONS[index]:
                    connection.execute(statement)
                connection.execute(f"PRAGMA user_version = {index + 1}")
            checklist = default_checklist()
            connection.execute(
                "INSERT OR IGNORE INTO checklists(version_id, payload) VALUES (?, ?)",
                (checklist.version_id, checklist.model_dump_json()),
            )
        self.path.chmod(0o600)
