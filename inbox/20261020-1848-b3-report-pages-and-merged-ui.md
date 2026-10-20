---
title: B3 UI — report pages library, explanation pages in the report editor, merged reports
from: scanin-svc-reports
to: scanin-web-platform
kind: task
status: open
created: 2026-10-20T18:48
---
Context: spec `../scanin-handbook/docs/work-plan/tasks/B3-explanation-pages-merged-reports.md` (decisions table at the top; read it first). Backend status:
- **explanation pages: done** (`scanin-svc-reports` `f556b5c`). Reports already render `introPages`/`closingPages`, so phase 2 can be tested end to end as soon as the UI writes the fields.
- **merged reports: in progress now** in `scanin-svc-reports` (phase 3). Build the UI against the contract below; it won't change.

Assignment (all in `scanin-web-platform`; commit, **you may deploy hosting + rules**, Hillel approved):

**A. Report pages library (phase 2).** New settings page, e.g. `settings/report-pages`, next to `report-config`.
- **Upload only, no editor** (Hillel). Accepted files: PDF (one or more A4 pages; other sizes get scaled) or PNG/JPG (one page).
  - Reject a PDF over 5 MB or an image over 20 MB.
  - Storage path: `report-pages/{pageId}/{fileName}`.
- Write `ReportPages/{pageId}`:
  `{ title, fileType: "pdf"|"image", storagePath, fileUrl (download URL), pageCount, overlayTemplate: bool, tags: [], archived: false, createdBy, createdAt, updatedAt }`.
  - `pageCount`: count it in the browser for PDFs (or set 1 and let the backend count; the backend doesn't rely on it).
  - The library is **global** (no project scope).
- List with a first-page thumbnail (images directly; for PDFs a generic icon is fine for v1), filter by tag, archive / unarchive. **No hard delete**: configs may still point at the page, and the backend still renders archived pages.
- Hint in the upload dialog: "with header/footer overlay, keep the top 2 cm and bottom 2.5 cm of the page empty — the report header and footer are drawn over them".

**B. Explanation pages in the report editor (phase 2).** For `sensor` and `group` reports:
- "Intro pages (after the cover)" and "Closing pages (at the end)": pick from the library (non-archived), drag to reorder, and per selected page a 3-state overlay choice: library default / on / off.
- A master toggle `showExplanationPages` (default true).
- Fields on `ReportConfig`:
  `introPages: [{ pageId, overlayTemplate: null|true|false }]`, `closingPages: [same]`, `showExplanationPages: bool`.
- When loading a report, keep any ids the UI doesn't recognize (don't drop them silently).

**C. Merged reports (phase 4).** New `reportType: "merged"` in the report editor and list.
- **Fields:**
  ```
  reportType: "merged", reportName, active, schedule, recipients, coverImageUrl,
  introPages, closingPages, showExplanationPages,            // merged-level pages
  children: [{ configId, periodOverride: null | {type:"absolute", startDate, endDate} | {type:"relative", value, unit},
               coverImageUrl: null|"…", titleOverride: null|"…",
               includeExplanationPages: true, includeCover: true }]
  ```
  - **No `period` on a merged config.** A child without an override uses **its own config's period** (Hillel). Show that period next to the child as a hint.
- **Child picker:** existing `sensor`/`group` configs, filtered to the current project by default. Reorder; duplicates allowed; at most 10.
  - Children don't have to be `active`. Tooltip: an active child also keeps running and sending on its own schedule.
  - Disallow `health` and `merged` as children.
- **Per child:** a period override (date range picker, empty = own period), cover override (reuse the existing cover upload), title override, and `includeExplanationPages` / `includeCover` toggles.
- **Run now:** same `POST https://reports-orchestrator-…/run-report/{docId}`.
  - To **resume** a failed merged run (it redoes only the parts that didn't finish), send JSON body `{ "resume": true }`. Show a "Resume" button when `lastStatus == "failed"` and `lastStatusDetails.runId` is set.
  - The call can take many minutes for merged reports (it returns at the end). Keep relying on the snapshot listener, as you do today.
- **Live status** comes on the merged config doc, as for other reports:
  - `lastStatus`: the same values as today;
  - `progress: { stage: "parts"|"merging"|"sending", partsDone, partsTotal, currentParts: [names], percent }`;
  - `lastStatusDetails.runId`.
  - Per-part detail (optional to show): `ReportRuns/{runId}` = `{ mergedConfigId, status, parts: [{ index, configId, name, status: "pending"|"running"|"done"|"failed", pages, bytes, error }], createdAt, finishedAt }`.
- **Cancel:** same endpoint as today, using the merged config's id.

**D. Rules** (`firestore.rules` / `storage.rules`; check the deployed ones per handbook §2.1 before editing):
- `ReportPages`: the same read/write rules as `ReportConfig`.
- `ReportRuns`: authenticated read, no client write (written by the backend's admin SDK).
- Storage `report-pages/**`: the same as `report-covers/**` (auth read/write).
- Do **not** loosen `reports/**` (it stays backend-write-only).

Not in scope: a TOC page, per-project libraries, editing page content. The backend handles rendering, merging and delivery.

Done when:
- Hillel can upload a page, attach it to a report as intro (overlay on) and closing (overlay off), press "Run now", and get the pages in the PDF;
- Hillel can build a merged report with 2–3 children (one with a period override), run it, and see `partsDone/partsTotal` while it runs;
- rules are deployed.

Reply with a `kind: feedback` message to `scanin-svc-reports` (and `user`), listing commits and anything in the contract that didn't fit.
