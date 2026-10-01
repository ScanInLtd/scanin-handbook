# Ops — Accessing Firestore & GCP from the handbook

How to investigate and maintain production (`dataloggerdev`) from this repo.

## 1. Setup (once per machine)

```bash
./go.sh preflight
```

Preflight checks, and fixes interactively (opening the browser when needed):

| Check | Why |
|---|---|
| Node 20 via nvm | ops scripts use `tsx` + `firebase-admin` 13 |
| `ops/node_modules` | runs `npm ci` if missing |
| gcloud CLI account = `scanin.link@gmail.com`, project = `dataloggerdev` | `gcloud logging`, Cloud Run, etc. |
| Application Default Credentials (ADC) = `scanin.link@gmail.com`, quota project `dataloggerdev` | what the Node scripts authenticate with |
| Test Firestore read (`ops/src/queries/whoami.ts`) | catches `PERMISSION_DENIED` early |
| firebase CLI has access to `dataloggerdev` (optional) | only for `firebase …` commands |

**Isolated gcloud config:** `go.sh` sets `CLOUDSDK_CONFIG=~/.config/gcloud-scanin`. ScanIn logins (CLI + ADC) live there and never replace your global gcloud account, so work for other clients is unaffected. To use the same environment in a plain shell:

```bash
export CLOUDSDK_CONFIG=~/.config/gcloud-scanin
export GOOGLE_APPLICATION_CREDENTIALS=$CLOUDSDK_CONFIG/application_default_credentials.json
```

The firebase CLI has its own **global** login and can't be isolated this way. Preflight only checks it and warns if it's wrong.

**No key files.** Other repos use `serviceAccountKey.json` / `service-account.json` key files. Ops in the handbook uses ADC only. Never add key files here.

## 2. Running things

```bash
./go.sh                                        # menu
./go.sh run src/queries/health.ts              # any script, with the ops env + preflight
cd ops && npx tsx src/queries/sensor.ts R11    # direct, if your shell already has the env above
```

### Built-in queries (all read-only)

| Script | Purpose |
|---|---|
| `queries/whoami.ts` | Connection test |
| `queries/health.ts [--all-incidents]` | Heartbeats, watchdog checks, open incidents, maintenance windows |
| `queries/alerts.ts [--since=1d] [--project=] [--sensor=]` | Threshold alerts plus a count per site |
| `queries/sensor.ts <docId\|scanin-id\|MAC\|name> [--n=10] [--full] [--daily]` | Sensor metadata, status, thresholds, latest samples |
| `queries/project.ts [<project>] [--type=prism] [--stale=24h]` / `--list` | Sensors in a project with last-sample age (finds silent sensors) |
| `queries/data-log.ts <docId> [--from=7d] [--to=] [--csv] [--raw\|--daily]` | Dump a time window; `--csv` writes to `ops/out/` (doubles as a backup) |
| `queries/metrics.ts [component] [--days=7]` | `system-metrics/{component}/daily/*` |

### Logs (Cloud Logging, not Firestore)

Alert delivery results (WhatsApp/email), function errors, and Cloud Run output only exist in Cloud Logging. Use the `go.sh` menu → *Firebase Function logs* or *Cloud Run service logs*, or run directly:

```bash
gcloud logging read 'resource.type="cloud_function" AND resource.labels.function_name="handleAlerts" AND severity>=ERROR' \
  --project=dataloggerdev --freshness=1d --limit=100
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="reports-worker"' \
  --project=dataloggerdev --freshness=6h
```

Functions on the v1 API log as `cloud_function`. Functions on v2 (`onSchedule`, `onCall`, `onMessagePublished`) log as `cloud_run_revision` with the lowercase function name. More log query examples are in `../scanin-svc-watchdog/scripts/*.py`.

## 3. Writing to production

Every script that writes follows the same pattern (see `ops/src/oneoff/_template-write.ts`):

1. **Read and plan.** Compute every change in memory first.
2. **Show it.** Print the count and a few before/after examples.
3. **Dry run by default.** Writes happen only with `--apply`, and then you must type `yes` in a terminal (`confirmApply`).
4. **Batch.** Use `BatchWriter` (commits every 400 ops).
5. **Make it undoable.** Keep old values (e.g. `x` → `x-old`) or take a CSV backup first (`queries/data-log.ts --csv`).
6. **Verify.** Re-run a read query afterwards.

Name scripts `ops/src/oneoff/YYYY-MM-DD-<what>.ts` and commit them, so there's a record of what was changed and why.

**Do not touch without a specific runbook:** raw `data-log` samples (other than docs you marked yourself, like `isReplay`), `daily::*` docs (rebuild them through the prism-daily worker instead), `users` / Auth, `alerts` (creating one triggers real WhatsApp and email via `handleAlerts`).

## 4. Data model cheat sheet

| Path | Notes |
|---|---|
| `projects/{id}` | name in `name` (sometimes `title`) |
| `work-sensors/{id}` | `scanin-id`, `name`, `type`, `location.site` (= project id), `location.section`, `thresholds`, `status`, `gateway` |
| `work-sensors/{id}/data-log/{autoId}` | raw sample, `time` = epoch **ms** |
| `work-sensors/{id}/data-log/daily::{YYYY-MM-DD}::{axis}` | daily aggregate written by prism-daily, `source: 'derived:daily'` |
| `work-sensors/{id}/status-history` | device status (bridge) |
| `photon-otac/{id}` | datalogger/gateway → sensor mapping (`photon-id`), calibration |
| `alerts/{id}` | `type`, `sensor` (scanin-id), `sensorDocId`, `axis`, `severity` warn/alarm, `prev_level`/`new_level`, `time` ms, `location`, `siteName` |
| `ReportConfig`, `GeneratedReports` | reports service |
| `system-heartbeats/{service}` | `mqtt-bridge`, `ats-ingestion`, `vibration-processor`, `reports-orchestrator`, `daily-prism-calc`, `firebase-functions`, `firestore-backups`, `alerts` |
| `system-checks/{checkId}`, `system-incidents/{id}` (+ `/events`), `system-maintenance/{component}` | watchdog (`../scanin-svc-watchdog/src/constants.ts`) |
| `system-metrics/{component}/daily/{YYYY-MM-DD}` | daily counters (e.g. `alerts.alertsCreated`) |

Sensors link to a project **only** through `location.site`; the project doc has no list of its sensors. Some sensor fleets leave `name` empty, so fall back to `scanin-id` or `MAC`.

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `7 PERMISSION_DENIED` | ADC is the wrong account. Run `./go.sh preflight` |
| `Could not load the default credentials` | Running outside `go.sh` without the env vars from §1 |
| `invalid_grant` / `reauth related error` | Token expired. Run `./go.sh preflight` and re-login |
| `FAILED_PRECONDITION: The query requires an index` | Remove a filter and apply it in memory instead (ops shouldn't add prod indexes casually) |
| Query is slow or huge | Add `.limit()`, use `.select(fields…)`, or narrow the `time` range |
