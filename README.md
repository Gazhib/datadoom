# Datadoom

## Docker development

From the repository root, start the frontend, backend, and evaluator with Docker Compose v2.32 or later and a Linux container engine.

```powershell
docker compose -p datadoom-dev -f compose.yaml -f compose.dev.yaml up --build --watch
```

Open [Datadoom](http://127.0.0.1:5173) and leave the command running while you edit. Compose Watch syncs `frontend/` changes to Vite for hot updates and syncs `backend/` Python changes before restarting FastAPI in the same container. Both apply without rebuilding images. Changes to dependency manifests or lockfiles automatically rebuild the affected service. Vite proxies `/api` to the backend.

The development stack has its own SQLite volume. Set `DATADOOM_FRONTEND_PORT` in the root `.env` to change the browser port. Provider and organizer settings are shared with the standard stack.

## Standard Docker stack

Run from the repository root with Docker Compose v2 and a Linux container engine.

```powershell
docker compose up --build -d --wait
```

Open [Datadoom](http://127.0.0.1:8000) or the [API docs](http://127.0.0.1:8000/docs). Set `DATADOOM_PORT` in the root `.env` to change the host port. The backend serves the built frontend and keeps its SQLite database in the `sqlite` volume. `docker compose down` stops the stack and retains the database.

All three judges in [ai/judges.yaml](ai/judges.yaml) use OpenAI GPT-6 Luna by default. Set `OPENAI_API_KEY` in the root `.env` before starting Compose. Edit each judge's `provider` and `model` in the YAML. The evaluator reads the file on each request.

To enable organizer imports, set `ORGANIZER_GET_URL` in the root `.env`. Keep the full signed URL in single quotes. For a local smoke check, import [the synthetic fixture](backend/fixtures/synthetic.json) using **Import conversations**.

Evaluation jobs stream judge results by default in Compose. Each completed LangGraph judge appears in its own tab as the workspace polls the job. Set `EVALUATOR_STREAM=false` in the root `.env` to use the evaluator's single-response endpoint.
