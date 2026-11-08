"""Disable remote graph tracing before importing LangGraph."""

import os


def enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() == "true"


if not enabled("EVALUATOR_ALLOW_TRACING"):
    os.environ["LANGSMITH_TRACING"] = "false"
    os.environ["LANGCHAIN_TRACING_V2"] = "false"
