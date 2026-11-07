# Datadoom frontend

The workspace imports and opens conversations, evaluates saved checklist versions, and links grades to source turns. Analysts can save checklist changes and appeal individual grades. Reviewers can confirm or change a grade and see the original and final results together. The frontend builds to static HTML, CSS and JavaScript with a single React mount and a same-origin API boundary.

## Setup

Use Node.js 22.14 or a newer supported LTS release. Run these commands from the `frontend/` directory.

```sh
npm ci
npm run lint
npm run build
```

## Synthetic mode

```sh
npm run dev:mock
```

Open the local URL printed by Vite. Synthetic mode is explicitly labeled and makes no live API calls. It starts with group `SYNTH`, containing RU and KZ chats and an EN call with a generated recording. The supplied `ru-001` fixture starts with an evaluation at **77.69**. Click **Run evaluation** to create a fresh run with the selected version. Open **Section scores** for the breakdown and select an evidence chip to focus the cited turn.

Use **Import conversations** to reimport `SYNTH` and see the skipped count, or upload a synthetic JSON record, an array of records, or a successful organizer export. The default upload group is `UPLOAD`. The mock uses fixed grades for unchanged criteria on the supplied samples and labeled placeholders for other transcript and criterion combinations. Uploads, checklist versions, runs and reviews persist in this browser's local storage. Clear the `datadoom.synthetic.v1` key to reset the samples.

To build and preview the static synthetic app:

```sh
npm run build:mock
npm run preview
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

## Milestone T-007 checks

1. Open `ru-001` in synthetic mode and use the `default-v1` run. Appeal C06 with a comment distinguishing dialogue clarity from incomplete consultation.
2. Resolve C06 with **Change grade**, choose 10, enter a decision reason and a replacement rationale, and cite turns `t2` and `t3`. Check the original total of **77.69** and the final total of **84.62**. Confirm a separate appeal and verify the final total stays the same.
3. Reload and verify that the grades, appeal comments, and reviewer reasons persist. Open the original and final evidence links on C06.
4. With `default-v1` selected, open **Edit checklist**. Replace the C05 label and scoring instruction, then save. Run the automatically selected new version. Switch to the earlier run in **Evaluation history** and expand C05's **Scoring rule** to verify the old version still has its original wording.
5. In live mode, apply the saved C05 criterion to the fresh-input pair in the root requirements and compare the evidence on both runs.

The page composes the conversation desk widget and the import and checklist features. The desk composes the criterion review feature. The quality entity owns the contract and its live and synthetic adapters, and shared code provides HTTP, request state, and UI controls.
