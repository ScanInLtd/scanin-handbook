# Task B3 — Explanation pages + merged reports

_From: Hillel, 2026-10-20 (item #5). Plan: [`../2026-10-20-reports-and-data.md`](../2026-10-20-reports-and-data.md) §3 B3. Repos: `scanin-svc-reports` (backend, main), `scanin-web-platform` (UI, rules). Status: **spec v2, Hillel's answers folded in (2026-10-20)**. Nothing implemented yet._

## Goal (Hillel's words, translated)
1. **Explanation pages:** a page after the cover and a page at the end, chosen from a **reusable page library**.
2. **Merged report:** several **existing** reports in one PDF, each with **its own cover image**. In the UI: a **date range per sub-report (override)**, and toggles for the explanation pages **per sub-report** and **for the merged report**.
3. **Mind performance and job chaining.** A single report is already slow and heavy.

## Decisions (Hillel, 2026-10-20)
| # | Question | Answer |
|---|---|---|
| 1 | Sub-report period when there's no override | **The sub-report's own config period.** |
| 2 | Page editing | **No editor. Pages are uploaded** (ready-made files). Option: **overlay the report template's header/footer** on the uploaded page. |
| 3 | Download link | **7-day signed URL.** |
| 4 | Storage / retention | **Single reports are not stored.** Retention is the agent's choice; see Part 4. |
| 5 | Table of contents | **Not now.** Kept as a future option. |
| 6 | Library scope | **Global only.** |

## Current state (read from the code, 2026-10-20)
- **Flow:** `reports-orchestrator` (Cloud Run) → HTTP `POST /process-batch` to `reports-worker`, then **waits for the response** (axios timeout 30 min). The worker runs `prepareReportData` → `renderReport` (Handlebars → one HTML → Puppeteer → `pdfs/report.pdf` on local disk) → `sendReportEmail` (SendGrid attachment). It all happens inside one request.
- **Worker:** 4 GiB, 2 CPU, `--timeout 3600`, max 10 instances. Per-report "timeout" (5 min) only logs; it doesn't abort.
- **Status / progress / cancel:** all written on the `ReportConfig` doc (`lastStatus`, `progress`, `cancelRequested`) plus `StatusHistory`. **The status is keyed by configId.**
- **The PDF is never stored.** It lives in the container's `/output` only. `GeneratedReports` is declared in `firestorePaths.js` but **nothing writes it**.
- **Page layout:** fixed A4 `.a4-page` divs. The cover is always physical page 1. Page numbers come from the Handlebars `pageNumber` helper (reset on the cover), not from Puppeteer (`displayHeaderFooter: false`).
- **Page order today:** cover → [summary] → [events] → group pages → sensor pages. `ReportConfig.prefacePdfUrl` is documented but **not implemented**. This task replaces it.
- **Email:** over 30 MB the worker logs `Email too large` and **sends nothing** (B1 fixed the size; the link fallback is still open).
- **`prepareReportData(..., { configOverrides })`** already merges in-memory overrides over a loaded config without persisting them. That's exactly what a per-child period override needs.
- **UI** (`settings/report-config`): `reportType` ∈ `sensor | group | health`. It already uploads cover images to Storage and triggers `run-report/:id` on the orchestrator.

## Design

### Part 1 — Explanation page library (uploaded pages)

**Collection `ReportPages/{pageId}`** (new, global):
```js
{
  title: "הסבר על מדידות פריזמות",   // library list label only (not printed)
  fileUrl: "https://…",             // Storage: report-pages/{pageId}/{file}
  storagePath: "report-pages/…",
  fileType: "pdf" | "image",        // PDF (1+ A4 pages) or PNG/JPG (one page)
  pageCount: 1,                     // set at upload (PDF) / 1 for images
  overlayTemplate: false,           // default for configs that use this page (see below)
  tags: ["intro", "prism"],
  archived: false,                  // soft delete; configs that point to it still render it
  createdBy, createdAt, updatedAt
}
```

**`ReportConfig` additions** (all optional; old configs stay unchanged):
```js
introPages:   [{ pageId: "pageA", overlayTemplate: null }],  // after the cover, in order
closingPages: [{ pageId: "pageC", overlayTemplate: null }],  // after the last report page
showExplanationPages: true          // master toggle (default true when the lists are non-empty)
// overlayTemplate: null = use the library page's default; true/false = override per config
```

**How uploaded pages enter the PDF** (as built, `scripts/services/explanationPages.js`):
1. `renderReport` loads the pages from `report-data.json`'s `config`, normalizes each upload to A4 PDF pages and counts them.
   - **Images:** fitted and centered on one A4 page, ≤1600 px JPEG.
   - **PDFs:** every page is scaled to fit A4.
2. The HTML render emits **one placeholder page per uploaded page** (`templates/pages/explanation/`: the real header section, an empty body, the brand footer). They go right after the cover and after the last sensor page. Page numbers come out right on their own, with no offset logic.
3. After Puppeteer, `pdf-lib` rebuilds the PDF and swaps each placeholder for its upload. Intro placeholders are pages 2…; closing placeholders are the last N pages.
4. **`overlayTemplate: true`:** the placeholder's **top 2 cm (header, with its page number) and bottom 2.5 cm (brand footer)** are clipped (`embedPages` with bounding boxes) and drawn over the upload.
   - The upload is **covered** in those bands, not shrunk, so uploaders should keep those margins empty. A "fit between header and footer" mode is a possible later option.
   - With `overlayTemplate: false`, the page is inserted as is: it counts in the numbering but shows no number.
5. A missing or broken page is skipped with a warning. `localPath` refs (local testing) are honored only when `render-only.js` sets `REPORTS_ALLOW_LOCAL_PAGES=1`.

**Size guard:** an uploaded PDF over 5 MB or an image over 20 MB is rejected at upload (UI). An uploaded PDF isn't recompressed, so it must arrive reasonably sized.

### Part 2 — Merged report

**A merged report is a `ReportConfig` with `reportType: "merged"`.** That way scheduling, recipients, "Run now", status, progress, cancel and the UI list keep working with no new plumbing.
```js
{
  reportType: "merged",
  reportName: "דוח מאוחד — אתר X — אוקטובר",
  active, schedule, recipients, coverImageUrl,        // same meaning as today
  introPages, closingPages, showExplanationPages,     // merged-level explanation pages
  children: [
    {
      configId: "QpaWmsa4k2uOA1TjmVBN",               // an existing sensor/group ReportConfig
      periodOverride: null | { type: "absolute", startDate, endDate } | { type: "relative", … },
      coverImageUrl: null | "…",                      // null = the child config's own cover
      titleOverride: null | "…",
      includeExplanationPages: true,                  // the child config's own intro/closing pages
      includeCover: true
    }
  ]
}
```

**Child period:** `children[i].periodOverride`, else **the child config's own `period`** (decision 1). The merged config has no `period`. Its cover shows the span from the earliest child start to the latest child end.

**Validation (UI + worker):**
- A child must exist and be `sensor` or `group`. No `health` and no nested `merged` in v1.
- At most 10 children. Duplicates are allowed, e.g. the same report for two periods.
- A child **does not need to be `active`**. Inactive configs can serve as templates that exist only as parts.

**A child run must not touch the child config.** It writes no `lastStatus`/`progress` on the child doc, sends no email to the child's recipients, and doesn't update the child's `lastRunTime`. All status goes to the merged config.

**Final document:**
```
[merged cover]  [merged intro pages]
  part 1: [child cover] [child intro] [group/sensor pages] [child closing]
  part 2: …
[merged closing pages]
```

### Part 3 — Execution, chaining, performance

A merged report with 5 children is 5 × today's work, which runs ~1–5 min and up to ~3–4 GB peak per report. Running it in one worker request means a long request, accumulated memory and no resume. So we fan out:

```
orchestrator (merged config due / Run now)
  1. create run doc   ReportRuns/{runId}   { mergedConfigId, parts:[{i, configId, status:"pending"}], … }
  2. fan out:  POST worker /render-part  {runId, partIndex}   × N   (bounded concurrency, default 3)
        worker: resolve child config + overrides → prepareReportData(configOverrides)
                → renderReport(partMode: no page numbers, child explanation pages spliced)
                → upload  reports/runs/{runId}/part-{i}.pdf
                → ReportRuns.parts[i] = {status:"done", pages, bytes, storagePath}
  3. when all parts are done:  POST worker /merge-run {runId}
        worker: render merged cover + header/footer bands (one small Puppeteer pass)
                → splice merged intro/closing pages → pdf-lib concat parts
                → stamp global page numbers → upload reports/runs/{runId}/merged.pdf
                → deliver (attachment, or 7-day link if too big) → delete part PDFs
```

- **New worker endpoints:** `/render-part` and `/merge-run`. `/process-batch` routes `reportType: "merged"` configs to the orchestrator flow above. The orchestrator owns the fan-out, so the worker stays stateless per request.
- **Resume:** re-running a failed run only redoes parts whose status ≠ `done`, since the part PDFs are already in Storage. "Run now" on a merged config that has a failed run less than 24 h old offers "resume" vs "new run" (UI).
- **Progress** on the merged config: `progress: { stage: "parts"|"merging"|"sending", partsDone, partsTotal, currentParts: [names], percent }`. Per-part detail goes in `ReportRuns`.
- **Cancel:** parts check the **merged** config's `cancelRequested` (passed in by id) at the existing checkpoints. The orchestrator stops dispatching new parts.
- **Memory:** each part runs in its own request on its own instance (Cloud Run scales up to 10), so the peak stays the same as a single report. The merge step only holds PDFs that are already shrunk (≈3–10 MB each after B1). That's fine at 4 GiB.
- **Timeouts:** each part has its own 60-min worker budget. The orchestrator's wait moves from one 30-min axios call to per-part calls plus the merge. **The orchestrator's Cloud Run timeout is 600 s** (checked 2026-10-20), while it waits up to 30 min on the worker. Cloud Run already cuts a long "Run now" or `/trigger` at 10 min today. Phase 3 must raise it to 3600 (deploy change, approval). **Later:** Cloud Tasks, if orchestrator-held fan-out proves fragile. Not needed for v1.
- **New dependency:** `pdf-lib` (MIT, pure JS, no native build), needed from Phase 1. Pin a version that's at least 7 days old.

**Page numbers (merged):** parts render with page numbers hidden, and `/merge-run` stamps `עמוד X מתוך Y` on every page with pdf-lib, in the same position and font as today's footer. Uploaded pages without the overlay are counted but not stamped.

### Part 4 — Delivery and storage (Phase 0, shared with B1's open item)
- **Single reports aren't stored** (decision 4). When a single report's email would exceed ~25 MB, its PDF is uploaded to `reports/links/{configId}/{ts}.pdf` **only so it can be linked**, and the email carries a **7-day V4 signed URL** (decision 3) instead of the attachment.
- **Merged reports:** same rule. Attach the PDF if it's under ~25 MB, otherwise send a link.
- **Retention (agent's choice):**
  - Part PDFs are deleted by `/merge-run` right after a successful merge. If the merge fails, they stay for resume.
  - A bucket lifecycle rule deletes objects under **`reports/links/` and `reports/runs/`** after **8 days**. That's the link's 7 days plus a margin, and it also covers orphaned parts and merged PDFs.
  - **Never `reports/` as a whole.** Functions' vibration reports store their PDFs (1,433 objects since 2024-09) and `reports/templates/report-template.html` there. **Applied 2026-10-20** (Hillel approved).
- **Signing prerequisite:** the worker's Cloud Run service account needs `iam.serviceAccounts.signBlob` on itself (role *Service Account Token Creator*) to create V4 signed URLs under ADC. This is a one-time IAM grant (approval).
- The email template gets a link variant. The same `generateEmailBody` is reused, with the "attached" box replaced by a download button that states "the link is valid for 7 days".

### Part 5 — UI (`scanin-web-platform`)
- **Settings → "Report pages" library:**
  - upload a PDF or an image, with the title, tags and default `overlayTemplate` toggle;
  - a thumbnail preview of the first page;
  - a hint to keep the top and bottom margins empty when overlaying;
  - the upload size limits;
  - archive.

  There's no editor.
- **Report editor, all types:** "Intro pages" / "Closing pages" multi-selects from the library, with drag-to-reorder and an overlay override per selected page, plus a `showExplanationPages` toggle.
- **Report editor, new type "merged":**
  - pick child reports (filtered to the current project by default);
  - reorder them;
  - per child: a period override (absolute range picker, empty = the child's own period, which is shown), cover override (reuses the existing upload), title override, and `includeExplanationPages` / `includeCover` toggles;
  - merged-level cover, explanation pages, recipients and schedule as today.
- **Status:** the merged row shows `partsDone/partsTotal` from `progress`.
- **Firestore rules:** `ReportPages` uses the same read/write rules as `ReportConfig`. `ReportRuns` is read-only for clients and written by the service account. **Storage rules:** `report-pages/**` uses the same rules as the existing `report-covers/**`. First check which repo's rules are actually deployed (handbook §2.1).

## Phases (each one is independently shippable)
| Phase | Repo | Scope | Done when |
|---|---|---|---|
| **0** | reports | Link fallback above ~25 MB (upload + 7-day signed URL + email variant); IAM grant + bucket lifecycle (approval) | REP142 rendered at full size (pre-B1 images, local test) produces a link email with a working link. **Code committed 2026-10-20** (`5b49b70` + lifecycle fix). Stubbed test passes. IAM grant + lifecycle **applied**. Waiting on the canary deploy test. Worker SA = `568942189829-compute@`. |
| **1** | reports | `ReportPages` + `introPages`/`closingPages`: placeholder pages + pdf-lib splice, image → A4, header/footer overlay; `render-only.js --intro/--closing` | A test config renders with a PDF intro page (overlay on) and an image closing page (overlay off). Page numbers are correct. **Done 2026-10-20** (`f556b5c`, `pdf-lib` 1.17.1): REP142 with 2 intro + 2 closing pages → 10 pages, numbering continuous, 2.9 → 3.1 MB, 15 s. |
| **2** | web-platform | Page library upload UI + pickers in the report editor; Firestore + Storage rules | Hillel uploads a page in the UI and sees it in a "Run now" PDF |
| **3** | reports | `merged` type: `ReportRuns`, `/render-part`, `/merge-run`, fan-out, resume, cancel, progress, merge + global page numbers; `render-only.js --merged <id>` for local runs | A 3-child merged report renders locally and on a canary revision; killing one part mid-run and resuming finishes it. **Done + deployed 2026-10-20** (`2b27c43`).<br>• Worker `reports-worker-00114-piq` (**concurrency 1**, so each part/report gets its own 4 GiB instance); orchestrator `reports-orchestrator-00006-m4s` (**timeout 3600**, `PARTS_CONCURRENCY=3`). Rollback: worker `00112-vek`, orchestrator `00005-c62`.<br>• Results: local e2e 46 s; kill-and-resume redid only the failed part (27 s); canary container: 3 parts in 50 s + merge 14 s; production "Run now" 55 s, 18 pages, 7.3 MB.<br>• Global page numbers come from header bands rendered with the real `header-content` partial and drawn over each page. `merged.pdf` isn't stored separately: delivery uses the Phase 0 link path when it's large.<br>• Test data left for the joint test: `ReportConfig/B3-MERGED-TEST` (manual, no recipients), `ReportPages/b3-test-intro`, `ReportPages/b3-test-closing` (archived). |
| **4** | web-platform | Merged editor + status display | Hillel builds a merged report in the UI end to end |

Order: 0 → 1 → (2 ∥ 3) → 4. Phase 1 is useful on its own, for single reports.

## Testing
- Local, via `render-only.js` (no status writes, no email): a single report with pages, then a merged report with children REP136, REP142 and one more.
- Page checks: the cover is still page 1, intro pages follow it, and closing pages are last. The overlay bands are aligned on both a PDF and an image upload. A non-A4 PDF (Letter) is scaled correctly.
- Merged-run checks: correct page order, global page numbers continuous, each child's period in its cover/header matches the override (or its own period), child configs' `lastStatus`/`lastRunTime` **unchanged**, part PDFs deleted after the merge.
- Perf: log the `REPORT_PERF` lines per part plus a `MERGE_PERF` line. Compare a merged report's total wall time against the sum of its children run alone.
- Deploy to a **canary tag with no traffic** (as `deploy.sh` already does), then trigger it with a test config whose only recipient is Hillel.

## Future options (not in v1)
- **Table of contents page** for merged reports (decision 5). It would be rendered in `/merge-run` once the part page counts are known, and inserted after the merged intro pages.
- A "fit between header and footer" overlay mode (shrink the upload instead of covering it).
- Per-project page library.
- `health` / nested `merged` children; Cloud Tasks for the fan-out; storing single-report PDFs.
