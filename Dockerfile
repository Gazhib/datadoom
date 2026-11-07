# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS frontend-dev
WORKDIR /app/frontend
RUN chown node:node /app/frontend
USER node
COPY --chown=node:node frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 npm ci
COPY --chown=node:node frontend/ ./
EXPOSE 5173
CMD ["node", "node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--strictPort"]

FROM frontend-dev AS frontend-build
RUN npm run build

FROM python:3.11-slim-bookworm AS python-base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app

FROM python-base AS backend-deps
COPY --from=ghcr.io/astral-sh/uv:0.11.3 /uv /usr/local/bin/uv
COPY backend/pyproject.toml backend/uv.lock ./backend/
RUN --mount=type=cache,target=/root/.cache/uv \
    UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never \
    uv sync --project backend --locked --no-dev --no-install-project

FROM python-base AS evaluator
COPY ai/requirements.txt /tmp/evaluator-requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install -r /tmp/evaluator-requirements.txt
COPY ai/*.py ./ai/
USER app
EXPOSE 8001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s \
    CMD ["python", "-c", "from urllib.request import urlopen; urlopen('http://127.0.0.1:8001/openapi.json', timeout=2).close()"]
CMD ["python", "-m", "uvicorn", "ai.main:app", "--host", "0.0.0.0", "--port", "8001"]

FROM python-base AS backend-runtime
COPY --from=backend-deps /app/backend/.venv /app/backend/.venv
RUN install -d -o app -g app /app/backend/storage
ENV PATH="/app/backend/.venv/bin:${PATH}"
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s \
    CMD ["python", "-c", "from urllib.request import urlopen; urlopen('http://127.0.0.1:8000/api/health', timeout=2).close()"]
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM backend-runtime AS backend-dev
RUN chown app:app /app/backend
COPY --chown=app:app backend/*.py ./backend/
USER app

FROM backend-runtime AS backend
COPY backend/*.py ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
USER app
