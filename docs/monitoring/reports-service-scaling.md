# Reports Service — Big-Report Crashes: Root Cause & Scaling Plan

**Date:** 2026-09-24
**Repo:** [scanin-svc-reports](https://github.com/ScanInLtd/scanin-svc-reports)
**Status:** Tier 1 fixes implemented (see below). Tier 2 redesign pending decision.

---

## The Problem

Large reports (many sensors and/or long periods) crashed and never arrived.
Confirmed example: report `3UwnnJox5XTHWBp9DRVt` ("מטה האום ארמון הנציב"),
period 2023-05 → 2026-09 (~3.4 years). Crashes observed on 2026-09-17, 09-22, 09-23.

From Cloud Run logs (`reports-worker`):

```
FATAL ERROR: Ineffective mark-compacts near heap limit
Allocation failed - JavaScript heap out of memory
Mark-Compact 1023.5 (1041.7) MB
```

The worker instance died ~90s into data preparation. The orchestrator's HTTP
call then failed with Cloud Run's "malformed response" error → the report
silently vanished (status stuck at `data_preparing`).

---

## Architecture (as of this doc)

Two Cloud Run services in project `dataloggerdev` (us-central1):

| | reports-orchestrator | reports-worker |
|---|---|---|
| Memory | 512Mi | 2Gi → **4Gi** (Tier 1) |
| CPU | 1 | 2 |
| Request timeout | 600s | 3600s |
| Concurrency | 1 | 10 |
| Max instances | 3 | 10 |

Flow:

1. Cloud Scheduler `reports-orchestrator-daily` (01:00) → orchestrator `/trigger`
2. Orchestrator queries active `ReportConfig` docs, applies schedule logic,
   splits into batches (`BATCH_SIZE` env), and calls worker `/process-batch`
   via **plain HTTP** (axios, 30-min timeout, no queue, no retry)
3. Worker, per report: fetch Firestore sensor data → downsample → render
   Chart.js PNGs → build HTML (charts inlined as base64) → Puppeteer/Chrome
   → PDF → SendGrid email
4. "Run Now" in the UI hits orchestrator `/run-report/:id`

## Root Causes (ordered by impact)

1. **Node heap capped at ~1GB.** The container had 2Gi but
   `--max-old-space-size` was never set, so V8 crashed at its default ~1GB
   limit — half the paid memory was unusable.
2. **Downsampling happened too late.** `getSensorData()` fetched the *entire
   period* of raw docs in one Firestore `.get()` and only then downsampled to
   ~5000 samples. Downsampling helped chart size, not fetch memory. A 3.4-year
   multi-sensor report meant potentially millions of docs in RAM at once.
3. **Everything held in memory simultaneously.** All sensors' samples + every
   chart PNG duplicated as a base64 string + one giant HTML string for
   Puppeteer.
4. **Full base64 images leaked into Cloud Logging** (40KB+ log lines) via two
   `JSON.stringify(chart)` debug logs — memory, cost, and noise.
5. **Fragile orchestration.** Synchronous HTTP orchestrator→worker: if the
   worker instance dies, the report is simply lost.

---

## Tier 1 Fixes (implemented 2026-09-24)

All in `scanin-svc-reports`:

| Fix | File(s) |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=3072` (3GB heap, ~1GB left for Chrome) | `production/Dockerfile.worker` |
| Worker memory 2Gi → 4Gi | `deploy.sh` |
| Paginated Firestore fetch (20k docs/page, `orderBy(time)+startAfter`) with **in-flight downsampling**: buffer is compacted whenever it exceeds 4× the sample cap, so peak memory per sensor is bounded (~2 pages) regardless of period length | `scripts/services/firestoreService.js` |
| Initial-value adjustment applied per-doc during fetch (linear shift — commutes with min/max bucketing, identical output) | `scripts/services/firestoreService.js` |
| Removed full-base64 debug dumps from logs | `scripts/templates/renderTemplateDynamic.js` |
| Per-report perf instrumentation (see below) | `production/reports-worker.js`, `scripts/services/prepareReportData.js` |

### Deployment

The **only** deploy script for this service is `scanin-svc-reports/deploy.sh`
(repo root). It builds via `production/cloudbuild-worker.yaml` and deploys the
**reports-worker** Cloud Run service (canary tag, then routes traffic).
Requires gcloud login as `scanin.link@gmail.com`, project `dataloggerdev`.

```bash
cd scanin-svc-reports
./deploy.sh
```

The orchestrator was **not** changed in Tier 1 and does not need redeploying.
(If it ever does: `production/cloudbuild-orchestrator.yaml` +
`gcloud run deploy reports-orchestrator ...` — there is no script for it yet.)

### Performance instrumentation

Two structured log types (query in Cloud Logging with
`resource.labels.service_name="reports-worker"`):

- **`REPORT_PERF`** — one per report run (success, fail, or cancelled):
  `wallMs`, `cpuMs`, `peakRssMB`, `peakHeapMB`, `endRssMB`, `endHeapMB`,
  and `stages` (`data_ready` / `pdf_ready` / `email_done` elapsed ms).
  Memory is sampled every 3s during the run so peaks between stages are caught.
- **`REPORT_DATA_STATS`** — one per report during data prep:
  `totalRawDocs` (Firestore docs actually read), `totalAfterDownsample`,
  `totalFetchMs`, plus a `perSensor` breakdown.

Human-readable `📈 [perf] <stage>: +12.3s | rss=… heap=…` lines are also
emitted at each stage.

Useful queries:

```bash
# Per-report perf history
gcloud logging read 'resource.labels.service_name="reports-worker" AND textPayload:"REPORT_PERF"' \
  --freshness=7d --format="value(textPayload)"

# Fetch volume vs downsample effectiveness
gcloud logging read 'resource.labels.service_name="reports-worker" AND textPayload:"REPORT_DATA_STATS"' \
  --freshness=7d --format="value(textPayload)"
```

### Verifying the fix

1. Deploy (`./deploy.sh`)
2. Re-run the previously failing report (`3UwnnJox5XTHWBp9DRVt`) via the UI
   "Run Now" or `POST /run-report/3UwnnJox5XTHWBp9DRVt` on the orchestrator
3. Confirm: report status reaches `completed`, email arrives, and the
   `REPORT_PERF` log shows `peakHeapMB` well under 3072

---

## Tier 2 — Platform Redesign (not yet scheduled)

Remaining structural risks and the industry-standard fixes:

1. **Cloud Tasks instead of direct HTTP fan-out.** One task per report;
   automatic retries, rate limiting, dead-letter handling. A worker crash no
   longer loses the report.
2. **PDFs to GCS, email a link** (or attach only if small). Removes the giant
   base64-in-HTML memory spike and gives users a download history.
3. **Per-sensor pipelining.** Process one sensor at a time; write intermediate
   artifacts (charts, per-sensor JSON) to disk instead of holding everything
   in RAM until the end.
4. **Pre-aggregated rollups** (decision pending): write daily min/max/avg
   summaries at ingest time. A 3-year report then reads thousands of rollup
   docs instead of millions of raw ones — faster, cheaper (Firestore reads),
   and memory-safe by construction. Touches ingestion services
   (`scanin-svc-mqtt-bridge`, etc.), so scoped separately.
