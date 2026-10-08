# ScanIn — Agent Guide (cross-repo)

Entry point for AI agents working across the ScanIn platform. This repo (`scanin-handbook`) holds docs only — no runtime code. All other repos are cloned side by side under the parent folder:

```
~/dev/clients/scanin/
├── scanin-handbook/              ← you are here (docs, design, task specs)
├── scanin-web-platform/          ← web UI (Angular)
├── scanin-svc-mqtt-bridge/       ← MQTT ↔ Firestore bridge (+ broker compose)
├── scanin-svc-firebase-functions/← alerts, thresholds, scheduled jobs
├── scanin-svc-reports/           ← PDF report generation (Cloud Run)
└── ...                           ← see "Other repos" below
```

Reference repos with relative paths (`../scanin-svc-mqtt-bridge/...`). Each repo has its own git — run git commands inside the specific repo, never from the parent folder.

---

## 1. System in one picture

```
 Field devices (ESP dataloggers, Beanair, ICL, Photon, ATS, partners)
        │  MQTT (TLS 8883)
        ▼
 MQTT broker ──► scanin-svc-mqtt-bridge (Docker on GCE VM)
        ▲             │ writes samples / device status
        │ downlink    ▼
        │       Firestore (project: dataloggerdev)  ◄──── scanin-web-platform (Angular, reads/writes directly)
        │             │ triggers                              ▲
        │             ▼                                       │
        │   scanin-svc-firebase-functions                     │
        │     checkThresholds → alerts/{id} → handleAlerts ──► WhatsApp / email
        │                                                     │
        │   scanin-svc-reports (Cloud Run: orchestrator → worker) ──► PDF + SendGrid email
        │   scanin-worker-prism-daily (Cloud Run, daily)       │
        │                                                     │
        └── scanin-svc-watchdog (Cloud Run + Scheduler) reads system-heartbeats → WhatsApp + incidents
```

**Single shared datastore:** everything goes through **one Firebase/GCP project, `dataloggerdev`**, which is production despite the name. Deploys use the `scanin.link@gmail.com` account, and deploy scripts check for it.

---

## 2. Core components

### 2.1 Web UI — `scanin-web-platform`
- **Stack:** Angular 9, Angular Material, `@angular/fire` 6 / Firebase JS SDK 8, amCharts 4 + Chart.js, ngx-mqtt.
- **Talks to Firestore directly** (no backend API layer). Callable functions are used for privileged operations (`deleteUser`, `recalcEma`, `deleteAtsRun`, `runVibrationReportNow`).
- **Where things are:**
  - `src/app/pages/` — main pages (site, sensors, alerts, compare, settings-*)
  - `src/app/settings/` — admin tools: `system-monitoring` (route `/status` + `settings/system-monitoring`), `report-config`, `multi-sensor-rules`, `ats-live-*`, `sensor-data-replay`, `vibration-reports`, `esp-dataloggers`, `calculated-sensors`
  - `src/app/app-routing.module.ts` — full route map
  - `src/app/shared/shared-status-types/` — sensor status/threshold types (mirrored in functions & reports — keep in sync)
  - `firestore.rules`, `firestore.indexes.json`, `storage.rules` — **Firestore rules/indexes live here as well as in functions repo; check which one is deployed before editing**
  - `docs/` — UI feature docs, handoff notes
  - `scripts/` — backfill / diagnostic node scripts
- **Run:** `npm start` (`ng serve`, http://localhost:4200). Needs **Node 12** for build.
- **Deploy:** `./deploy.sh` → builds with Node 12, deploys `firebase deploy --only hosting` with Node 20 (hosting target `new-scanin-ui`).

### 2.2 MQTT broker + bridge — `scanin-svc-mqtt-bridge`
- **The broker** is Eclipse Mosquitto, a separate process from the bridge. The `hivemq` service in `docker-compose.yml` is **obsolete**; ignore it.
- **The bridge** is Node.js (`mqtt`, `firebase-admin`, `winston`). It runs in Docker on the GCE VM `monitoring-bridge-vm` (user `scanin.link`, dir `~/monitoring-bridge`).
- **Entry:** `src/main.js`. Handlers are auto-registered: any `src/handlers/*Handler.js` exporting `{ name, topics, processMessage }`.

| Handler | Topics |
|---|---|
| `scaninHandler` | `scanin/+/uplink/#` (ESP dataloggers); publishes `scanin/{deviceId}/downlink/{settings,settings_ack,commands,firmware,sync_complete,hash_response}` |
| `integrationHandler` | `scanin/integration/+/+/uplink/#` (partners — see `docs/partner-integration-guide.md`) |
| `beanairTiltHandler` | `+/SENSOR/3`, `+/SENSOR/4`, `beanair/tilt/+/{x,y}` |
| `beanairVibrationHandler` | `ScaninVibration`, `beanair/vibration/+`, `beanair/vibration/notif/+` |
| `iclHandler` | `ICL_Datalogger/sensor_data` |
| `photonHandler` | `PhotonMsg`, `photon-get-status` (legacy) |
| `targetsHandler` | `HubMsg`, `Hub_connected`, `HubResetReq` (Targets training app — not monitoring) |

- **Services:** `src/services/firestoreService.js` handles sample writes, device lookup, and the firmware listener. `mqttService.js`, `heartbeatService.js` (→ `system-heartbeats/mqtt-bridge` every 5 min, plus `system-metrics/mqtt-bridge/daily/{date}`), `targetsService.js`.
- **Config:** `src/config/config.js` reads `.env` (`MQTT_BROKER`, `MQTT_PORT`, `MQTT_USER/PASSWORD`, `MQTT_CA_CERT_PATH`, `BASE_PATH`, `FIREBASE_KEY_PATH`). Keys are mounted from `~/.firebase-keys` and `~/.mqtt-keys`.
- **Protocol docs:** `docs/esp_server_protocol.md`, `docs/settings_synchronization_protocol.md` (device side: `../scanin-fw-datalogger/PROTOCOL.md`).
- **Deploy:** on the VM, `./deploy.sh`. Alternatives are described in `DEPLOYMENT.md` and `MODERN_DEPLOYMENT.md`. Logs: `docker logs -f monitoring-bridge` (alias `bridge-log`).
- **No tests** (`npm test` is a stub).

### 2.3 Firebase Functions — `scanin-svc-firebase-functions`
- **Stack:** TypeScript, Node 20, a mix of `firebase-functions` v1 and v2 APIs. Uses SendGrid, a WhatsApp sender (`alerts/whatsappService.ts`), and Puppeteer/chartjs for vibration reports.
- **Exports** (`src/index.ts`):

| Function | Trigger | Purpose |
|---|---|---|
| `checkThresholds` | Firestore `work-sensors/{sensorId}/data-log/{entryId}` onWrite | Evaluates thresholds and creates `alerts/{id}` docs |
| `handleAlerts` | Firestore `alerts/{alertId}` onCreate (540s timeout) | Sends WhatsApp and email to subscribed users |
| `evaluateMultiSensorRules` | Firestore `alerts/{alertId}` onCreate | Rules from `multi-sensor-rules` |
| `handleMuteOrUnsubscribe` | HTTPS | Mute links in alert messages (UI page `/mute`) |
| `scheduleCalcSensors` / `processCalcSensor` | every 30 min / Pub/Sub | Virtual (calculated) sensors (`calcSensors`) |
| `generateSensorReports` | hourly at :01 | Vibration sensor reports |
| `distributeReportsScheduled` | Pub/Sub schedule | Sends the `auto-report-sensors` outbox |
| `cleanUnconfirmedSensors` | daily 00:00 | Cleanup |
| `deleteUser`, `recalcEma`, `deleteAtsRun`, `runVibrationReportNow` | callable | Admin actions from the UI |

- **Build/run:** `npm run build`, `npm run serve` (emulator), `npm run logs`.
- **Deploy:** `./DEPLOY.sh`, or `npm run deploy` (lint + build + `firebase deploy --only functions`).
- **`scripts/`** holds many one-off diagnostic and fix scripts (WhatsApp stats, prism status, user/project sync). Check here before writing a new one.
- **`docs/`** holds alert metrics, multi-sensor alerts, vibration reports, and daily prism processing specs.

### 2.4 Reports service — `scanin-svc-reports`
- **Stack:** Node.js, Express 5, Handlebars, Puppeteer (PDF), chartjs-node-canvas, SendGrid/nodemailer.
- **Production** (`production/`) is two Cloud Run services (us-central1):
  - `reports-orchestrator.js`: triggered by Cloud Scheduler. It reads `ReportConfig`, applies the schedule (daily/weekly/monthly/manual), and POSTs batches to the worker.
  - `reports-worker.js`: HTTP on port 8081 (`/process-batch`, `/health`). Pipeline: `prepareReportData` → `renderTemplateDynamic` → PDF → email. Writes `GeneratedReports` and live progress for the UI.
  - Heartbeat goes to `system-heartbeats/reports-orchestrator`.
- **Code:** `scripts/services/` (data, charts, pdf, email, health reports), `scripts/templates/` (rendering plus `dataFormatConverter.js`), `templates/` (Handlebars pages, partials, styles), `scripts/utils/firestorePaths.js` (collection names).
- **Local:** `node scripts/entry-points/index-new.js` (full run) or `index-web.js` (web UI with logs).
- **Deploy:** `./deploy.sh` (gcloud, Cloud Build files in `production/`). See `DEPLOYMENT.md`.
- **Docs:** `docs/REPORT_CONFIG_SPECIFICATION.md`, `docs/PRODUCTION_FLOW_ANALYSIS.md`, `docs/reports-service-scaling.md` (OOM history), `docs/health-report-implementation-plan.md`.

---

## 3. Key Firestore collections

| Collection | Written by | Read by |
|---|---|---|
| `work-sensors/{id}` | UI, bridge (status), functions | everyone |
| `work-sensors/{id}/data-log/{sample}` | bridge, ATS ingestion, prism-daily, data-replay | UI, functions (`checkThresholds`), reports |
| `photon-otac` | UI | bridge (datalogger/gateway → sensor mapping, field `photon-id`) |
| `esp_datalogger_firmware` | UI | bridge (onSnapshot, OTA) |
| `projects`, `sections`, `users` | UI | everyone |
| `alerts/{id}` | functions (`checkThresholds`) | functions (`handleAlerts`, multi-sensor), UI |
| `multi-sensor-rules`, `calcSensors` | UI | functions |
| `ReportConfig`, `GeneratedReports` | UI / reports | reports / UI |
| `auto-report-sensors`, `data-requests` | UI / functions | functions |
| `ats-runs`, `ats_raw_payloads` | ATS ingestion / bridge | UI, functions |
| `TARGETS_*` | Targets app / bridge | **not monitoring, ignore** |

**Monitoring (watchdog) collections.** These are the paths the watchdog code actually uses (`../scanin-svc-watchdog/src/constants.ts`). The `system-health/...` paths in `docs/monitoring/tasks/_context.md` are outdated.
`system-heartbeats/{service}`, `system-checks/{checkId}`, `system-incidents/{id}` (+ `/events`), `system-metrics/{component}/daily/{date}`, `system-maintenance/{component}`.

Heartbeat rules: `schemaVersion: 1`, `lastSeenAt = FieldValue.serverTimestamp()`, one doc per service overwritten in place, and a failed heartbeat write must never crash the service.

---

## 4. Other repos (supporting)

| Repo | What | Runtime |
|---|---|---|
| `scanin-svc-watchdog` | Health checks over heartbeats + GCP APIs, WhatsApp alerts, incidents (`src/checks/*`) | Cloud Run + Cloud Scheduler (TS) |
| `scanin-worker-prism-daily` | Daily prism smoothing → `daily2Ddisplacement`, `dailySettlement` axes | Cloud Run orchestrator + Pub/Sub worker, 00:05 Asia/Jerusalem |
| `scanin-svc-hexagon-ats-ingestion` | Hexagon/Leica ATS reports from email → Firestore | C#/.NET, Windows on-prem |
| `scanin-svc-beanair-vibration-processor` | Beanair vibration processing → MQTT | C#/.NET Windows service |
| `scanin-fw-ats-monitoring` | Live ATS station PC software (Python) | Windows on-site PC |
| `scanin-fw-datalogger` | ESP32 firmware + Flutter BLE app; `PROTOCOL.md` | Devices |
| `scanin-tool-data-replay` | Fills prism data gaps (`sensor-data-replay` Cloud Run) | Cloud Run |
| `scanin-maintenance` | Ad-hoc Firestore/auth scripts (`npm run query <script>`) | local |
| `scanin-tool-firestore-data-export`, `scanin-tool-sensor-clone`, `scanin-tool-esp-flasher`, `scanin-worker-firestore-adjustments` | Ops tools | local / Windows |
| `scanin-web-targets`, `archive-TargetsHubPhoton` | Military Targets training app (shares Firebase project + bridge) | **not monitoring** |
| `scanin-intel-pilot`, `scanin-lorawan-*`, `scanin-fw-lora-e5-test`, `*inclinorobot*`, `DataLoggerUnited`, `ScaninEspDatalogger` | Separate pilots / legacy | unrelated to core flow |

---

## 5. Handbook docs (this repo)

- `readme.md`: platform overview. `docs/inventory.md`: repository list. `docs/naming-conventions.md`: repo naming.
- `docs/monitoring/`: the system-monitoring (watchdog/heartbeat) program:
  - `system-monitoring-design.md`: architecture
  - `monitoring-checks.md`: per-component check specs
  - `monitoring-progress.md`: **status tracker; update it when a task is completed**
  - `tasks/*.md`: per-repo task specs (`_context.md` is the shared preamble that gets copied into each repo)
  - `feedbacks/*.md`: implementation summaries returned from each repo
- `docs/data-smoothing-and-alerts-plan.md` plus `docs/data-smoothing-rollout-messages/`: the smoothing rollout.
- `repo-data/`: snapshots of each repo's metadata files (README, package.json, …). May be stale, so prefer the live repo.

---

## 6. Operations (maintenance & investigation)

This repo is the home base for operating the whole system.

- **`./go.sh`:** an interactive console. Preflight checks Node 20, the gcloud account and project, ADC, a test Firestore read, and the firebase CLI. The menu covers health, alerts, sensor and project inspection, metrics, function and Cloud Run logs, running scripts, and opening consoles.
  - `./go.sh run src/queries/<x>.ts …` runs a script non-interactively with the right env. Agents should use this form.
  - gcloud state is isolated in `~/.config/gcloud-scanin`, so it doesn't touch the user's global gcloud account.
- **`ops/`:** a TypeScript toolkit (`firebase-admin` + `tsx`, ADC only, pinned to `dataloggerdev`).
  - `src/lib/`: `firebase.ts` (the single init), `cli.ts` (args, `confirmApply`, `BatchWriter`, time formatting), `sensors.ts` (sensor/project resolution).
  - `src/queries/`: read-only investigations.
  - `src/oneoff/YYYY-MM-DD-<what>.ts`: committed records of maintenance runs. Start from `_template-write.ts`.
  - `out/`: CSV exports (gitignored).
- **Docs:** `docs/ops/firestore-access.md` covers auth, queries, logs, the write protocol, and a data-model cheat sheet. `docs/ops/runbook-index.md` lists the runbooks that live in other repos.
- **Agent protocol:** read-only queries are fine to run. For writes, write a `oneoff` script, show the dry-run output to the user, and let the user run it with `--apply`. It requires typing `yes` in a terminal, so agents can't apply it themselves. If auth fails, ask the user to run `./go.sh preflight`, because browser login is interactive.

---

## 7. Working rules for agents

1. **Production by default.** `dataloggerdev` is the live project. Don't write to Firestore, deploy, run `fix-*`/`backfill-*`/`delete-*` scripts, or send WhatsApp/email without explicit user approval. Read-only queries are fine.
2. **Trace a sensor end-to-end:** device topic (bridge handler) → `photon-otac`/gateway mapping → `work-sensors/{id}/data-log` → `checkThresholds` → `alerts` → `handleAlerts` → UI page `sites/:siteId/:sectionId/:sensorId` and reports.
3. **Shared types are duplicated.** `shared-status-types` exists in web-platform, functions, and reports. A schema change means updating all three, plus any bridge writers.
4. **Cross-repo tasks:** write the spec in `docs/monitoring/tasks/` (or a new `docs/<topic>/`), implement in each repo, then record the outcome in `feedbacks/` and the progress tracker.
5. **Secrets:** `.env`, `serviceAccountKey.json`, `service-account.json`, and `~/.firebase-keys` exist locally and are gitignored. Never print, copy, or commit them.
6. **Node versions:** web-platform builds on Node 12 and deploys on Node 20. Functions use Node 20. Use `nvm`.
7. **Tests are sparse.** Most repos have no automated tests. Verify with builds (`ng build`, `npm run build`/`tsc`), the emulator, or dry-run scripts.

## 8. Google identity on this Mac (several clients side by side)

- Run gcloud / Firestore / deploy commands from inside `~/dev/clients/scanin/**` (direnv loads `CLOUDSDK_CONFIG=~/.config/gcloud-scanin`) or via the repo scripts (`./go.sh`, `DEPLOY.sh`, `deploy.sh`), which set it themselves. Otherwise prefix `CLOUDSDK_CONFIG=$HOME/.config/gcloud-scanin`.
- Never run `gcloud auth login`, `gcloud config set account` or `firebase login/logout` without that — it would switch the account used by other clients' windows.
- Firebase CLI: always `--account scanin.link@gmail.com` (the `.bin/firebase` shim adds it for plain `firebase …`; `npx firebase-tools` doesn't go through the shim).
- Ports: ScanIn slot 20 (web 3020, reports 8021, watchdog 8022). Details: `docs/DEV-ENV-ISOLATION.md` §8, §11.
