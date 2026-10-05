# Signal, Smoothing & Alerts — Progress

Plan: [`plan.md`](./plan.md) · Tasks: [`tasks.md`](./tasks.md) · Feedbacks: [`feedbacks/`](./feedbacks/)

| Task | Repo | Status | Notes |
|---|---|---|---|
| FN-0.1 … FN-0.5 | functions | ✅ deployed 2026-10-04 13:41Z (`f75b52b`) · ⏳ 24h log review, 7d `alert-landscape` | [feedback](./feedbacks/functions-phase0.md) |
| FN-1.1 … FN-1.6, FN-2.1, FN-2.4 | functions | ✅ deployed 2026-10-04 15:24Z (`26c99a5`) | [feedback](./feedbacks/functions-phase1.md) |
| FN-1.3 migration | handbook / Hillel | ✅ applied 2026-10-04 (728 events; re-run → 0) | |
| FN-2.2, FN-2.3, FN-2.5 | functions | ✅ deployed 2026-10-04 16:55Z (`ec335e3`); 90-day backfill applied (pilot + all) | recomputeSmoothing, 90-day backfill, prism TwoD derived |
| UI-1.1/1.2/1.4, UI-3.x | web-platform | ✅ **LIVE 2026-10-05 10:03Z** (Didi approved; preview channel `signal-ui` cloned to live, bundle `main-es2015.b726b3bd`; rollback = clone version `070ffaf9eb5e1013` back to live) | Baseline action + markers, suspect fields, smoothed default chart. Round 2 (`1149c38`): one axis at a time, alert + suspect markers. Review round 2 (`611be8b`): baselines only via setBaseline (Auto Fix View, storage, install-sensor), chart shows tiered alerts only, alert query by sensorDocId. [feedback](./feedbacks/web-platform-ui.md). `main` pushed (`f116a70`). |
| Legacy alert archive | handbook / Hillel | ✅ applied 2026-10-05 10:13 | 13,947 untiered, non-DIN threshold alerts (raw-evaluated) moved to `alerts-archive` (`archiveReason: pre-smoothing-raw`), verified. Decision: keep the archive and let alerts accumulate from now on. Pre-cutoff history lives only in `alerts-archive`. Undo: oneoff `--undo`. Don't re-run casually. |
| Axis registry X1 | handbook / Hillel | ✅ applied 2026-10-05 08:10Z | `axes` on 15 devices-types docs; cracktemp temperature thresholds cleared (31 sensors); probe retyped. [axes.md](./axes.md) |
| Axis registry X2 | web-platform | ✅ LIVE 2026-10-05 10:03Z (`80bf2f4`, `f116a70`) | Sensor page reads the registry: tabs (chart + thresholded axes), labels/units everywhere, editor מתריע / לא מתריע, suspect defaults, chartLayout / alertRule branching. Prism labels follow `projects/{id}.prismAxes` (missing → E/N "יתריע לאחר המעבר", TwoD מתריע read-only; 'registry' → E/N מתריע, TwoD "ספים ישנים"). Verified with `axis-ui-preview.ts`. [feedback](./feedbacks/web-platform-ui.md) |
| Axis registry X3 | functions | ✅ deployed 2026-10-05 08:46Z (`675d76d`) | Registry loader; per-project `prismAxes`; DIN routing via `alertRule`; Hebrew labels in alert texts. [feedback](./feedbacks/functions-axes.md) |
| Phase 4 flip — צייטלין 12 | handbook | ✅ `alerting: v2` set 2026-10-05 08:57Z | `ops/src/oneoff/2026-10-05-project-flags.ts`; flip report clean (0 alerts / 0 silent drops). Undo: backup in `ops/out/` or delete the field. |
| Phase 4 + X4 flip — מגדל דה וינצי דרום | handbook | ✅ `alerting: v2` + `prismAxes: registry` set 2026-10-05 08:57Z | Flip report: 0 escalation alerts, 4 silent de-escalations (raw-noise statuses → ok), 77 no-smooth held. TwoD status cleared on 60 prisms (no longer evaluated). |
| Phase 4 flip — all active sites | handbook | ✅ `alerting: v2` on all 22 active projects 2026-10-05 10:02Z | Flip reports per project: 0 escalation alerts anywhere; 1 silent de-escalation (NAVON prism "5", raw-noise alarm). Undo: `ops/out/project-flags-backup-22-projects-…json` or delete the field per project. |
| X4 prism axes — all active sites | handbook | ✅ `prismAxes: registry` on all 22 active projects (SAVYON ×2 at 10:02Z, the rest at 10:14Z, Hillel: no further tests) | Prisms alert on E/N/H; TwoD status cleared on 135 prisms. Known: NAVON 4/6 and JAFFA_68 "9" 3/5 E/N gaps are tight (backtest: NAVON 13→24 alerts / 60d) — review with Nathan. Undo: `ops/out/project-flags-backup-22-projects-2026-10-05T10-14-25-122Z.json`. |
| Questions for Nathan | handbook | ⏳ sent | [questions-for-nathan.md](./questions-for-nathan.md): hold list, NAVON/JAFFA E/N gaps, DeVinci `ATS.DeVinci-1.*` (48), ATS-6 frame/identity/mapping, late-data loggers, units, defaults |
| Edge QC in datalogger firmware (DL-*) | scanin-fw-datalogger | 💡 planned (later) | plan §4.7, tasks §11 — re-measure on implausible readings at the edge |
| BR-0.1, BR-0.2 | bridge | ✅ investigated | [findings](./findings-2026-09-23.md): A station frame (ongoing), B station point identity, C device-map errors |
| ATS mapping (BR-1.x, BR-R.x, ATS-*, FN-0.6) | bridge, station, functions | ⏸ parked | Merged into the ATS IDs & naming work ([`../ats/ids-and-naming.md`](../ats/ids-and-naming.md) §6). Not urgent: raw data is kept on the ATS PCs. Known: ATS-6 bad frames since 09-23 (153 client alerts on 5 projects since 09-08); `cleanUnconfirmedSensors` would delete the 11 `ATS-5-f*` sensors around 10-11 (orphaned data, recoverable). |

## Regression runs

| Date | Script | Result |
|---|---|---|
| 2026-10-04 | `ingest-lag.ts --days=30` | 50,361 samples; 12% arrive >48h late (bulk catch-ups after outages + צייטלין tilt 4/5 slow drain, ~5 days behind); ATS live max lag 0.6h; 33 out-of-order |
