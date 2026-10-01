# Ops — Runbook index

Runbooks stay in the repo whose scripts they drive; this index points to them.
Paths are relative to the parent `scanin/` folder. Before running anything that writes, read the runbook's prerequisites and auth section. Most runbooks expect ADC as `scanin.link@gmail.com`, so run `./go.sh preflight` here first and reuse the same shell env (see `firestore-access.md` §1).

| When | Runbook | Repo tooling |
|---|---|---|
| Prism sensors have data gaps / need daily series rebuilt | `scanin-tool-data-replay/docs/prism-gap-fill-runbook.md` | `scripts/gap-report.js`, `gap-backup.js`, `gap-fill.js`, `gap-verify.js`, `audit-daily-docs.js` |
| Re-run / backfill daily prism aggregates | `scanin-worker-prism-daily/BACKFILL_GUIDE.md`, `BACKFILL_STRATEGY.md`, `DEPLOYMENT.md` | orchestrator `/rerunRange` (see gap-fill runbook step 4) |
| Recalibrate sensor values (photon-otac a/b, data-log `x`) | `scanin-maintenance/README.md` | `src/scripts/recalibrate-preview.ts` → `recalibrate-run.ts`, `update-photon-otac-calibration.ts` |
| User ↔ project access arrays out of sync | `scanin-web-platform/scripts/README-backfill.md` | `scripts/backfill-user-projects.js --dry-run` |
| Sensor status/threshold schema migration | `scanin-svc-firebase-functions/src/shared-status-types/migration/RUN_MIGRATION.md`, `QUICK_START.md` | `01-analyze-sensors.ts`, `02-migrate-sensors.ts` |
| Alert / WhatsApp delivery investigation | — (scripts only) | `scanin-svc-watchdog/scripts/check-*.py`, `diagnose-alerts.py`; `scanin-svc-firebase-functions/scripts/check-wa-stats.ts`, `check-who-got-wa.ts` |
| Prism / DIN sensor status audit | — | `scanin-svc-firebase-functions`: `npm run check-prism-status`, `npm run check-din-status` |
| Report generation failing / OOM | `scanin-svc-reports/docs/reports-service-scaling.md`, `DEPLOYMENT.md`, `docs/PRODUCTION_FLOW_ANALYSIS.md` | `scripts/debug/*.js` |
| MQTT bridge down / redeploy | `scanin-svc-mqtt-bridge/DEPLOYMENT.md` (troubleshooting section) | `deploy.sh` on `monitoring-bridge-vm` |
| Watchdog deploy / scheduler | `scanin-svc-watchdog/deploy.sh`, `scanin-handbook/docs/monitoring/tasks/watchdog-deploy-task.md` | |
| ATS station / ingestion issues | `scanin-fw-ats-monitoring/STATUS.md`, `scanin-svc-hexagon-ats-ingestion/USAGE.md`, `LOGGING.md` | |
| Vibration processor backfill | `scanin-svc-beanair-vibration-processor/BACKFILL_USAGE.md`, `DEPLOYMENT.md` | `run-backfill.bat` (Windows) |

## Before reusing a script from another repo

- Many scripts have **hard-coded sensor ids and constants** (e.g. `recalibrate-run.ts`, `*-r11-r15.js`). These are records of a past run, not reusable tools. Copy the approach into `ops/src/oneoff/` and parametrise it.
- Check how the script authenticates: key file (`serviceAccountKey.json`) or ADC. ADC needs the `go.sh` env.
- `scanin-tool-data-replay/scripts/cleanup-9-sensors.js` deletes **all** `isReplay` docs in its range. Read the runbook's Gotchas section before running it.

## Adding a new runbook

If the runbook is generic and cross-system, put it in `docs/ops/<topic>-runbook.md` with its scripts in `ops/src/`. If it drives one repo's tooling, keep it in that repo and add a row here.
