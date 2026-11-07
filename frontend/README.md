# Datadoom frontend

The analyst workspace imports and opens conversations, runs a saved checklist version, and links each grade to its source turns. It builds to static HTML, CSS and JavaScript with a single React mount and a same-origin API boundary.

## Setup

Use Node.js 22.14 or a newer supported LTS release. Run these commands from the `frontend/` directory.

```sh
npm ci
npm run lint
npm run build
```

## Synthetic mode

```sh
npm run dev -- --mode mock
```

Open the local URL printed by Vite. Synthetic mode is explicitly labeled and makes no live API calls. It starts with group `SYNTH`, containing RU and KZ chats and an EN call with a generated recording. The supplied `ru-001` fixture starts with an evaluation at **77.69**. Click **Run evaluation** to create a fresh run with the selected version. Open **Section scores** for the breakdown and select an evidence chip to focus the cited turn.

Use **Import conversations** to reimport `SYNTH` and see the skipped count, or upload a synthetic JSON record, an array of records, or a successful organizer export. The default upload group is `UPLOAD`. The mock uses fixed grades for the supplied samples and clearly labeled placeholder grades for other transcripts. Synthetic uploads and runs persist in this browser's local storage. Clear the `datadoom.synthetic.v1` key to reset the samples.

To build and preview the static synthetic app:

```sh
npm run build -- --mode mock
npm run preview -- --mode mock
```

## Live mode

Start the backend on `127.0.0.1:8000`, then run:

```sh
npm run dev
```

Vite proxies relative `/api` requests to the backend in development. To serve the frontend with the backend, run `npm run build` and serve `frontend/dist/` at the backend origin. Organizer credentials and evaluator settings belong in the backend and ML configuration.

## Milestone T-006 checks

- Open the RU, KZ and EN conversations and check source order, roles and timestamps. Open the recording from the EN call.
- Evaluate `ru-001` with `default-v1`. Check two N/A rows, no serious errors, a total of 77.69 and section scores of 15.38 / 15.38, 23.08 / 30.77, 39.23 / 53.85 and an unavailable flag section.
- Click C01 evidence and check that turn `t2` at `00:02` is focused and highlighted. Use **Back to C01** to return to the evidence button. Run again and select the older run from **Evaluation history**.
- Reimport `SYNTH`, upload a valid synthetic JSON file, and try an invalid file. In live mode, a failed evaluation should show the API error and preserve the previously displayed run.
