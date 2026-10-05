# Signal, Smoothing & Alerts — Progress

Plan: [`plan.md`](./plan.md) · Tasks: [`tasks.md`](./tasks.md) · Feedbacks: [`feedbacks/`](./feedbacks/)

| Task | Repo | Status | Notes |
|---|---|---|---|
| FN-0.1 … FN-0.5 | functions | ✅ deployed 2026-10-04 13:41Z (`f75b52b`) · ⏳ 24h log review, 7d `alert-landscape` | [feedback](./feedbacks/functions-phase0.md) |
| FN-1.1 … FN-1.6, FN-2.1, FN-2.4 | functions | ✅ deployed 2026-10-04 15:24Z (`26c99a5`) | [feedback](./feedbacks/functions-phase1.md) |
| FN-1.3 migration | handbook / Hillel | ✅ applied 2026-10-04 (728 events; re-run → 0) | |
| FN-2.2, FN-2.3, FN-2.5 | functions | ✅ deployed 2026-10-04 16:55Z (`ec335e3`); 90-day backfill applied (pilot + all) | recomputeSmoothing, 90-day backfill, prism TwoD derived |
| UI-1.1/1.2/1.4, UI-3.x | web-platform | 🟡 on preview, awaiting Didi | Baseline action + markers, suspect fields, smoothed default chart. Round 2 (`1149c38`): one axis at a time, alert + suspect markers. Review round 2 (`611be8b`): baselines only via setBaseline (Auto Fix View, storage, install-sensor), chart shows tiered alerts only, alert query by sensorDocId. [feedback](./feedbacks/web-platform-ui.md). Not on production yet. |
| Legacy alert archive | handbook / Hillel | ✅ applied 2026-10-05 10:13 | 13,947 untiered, non-DIN threshold alerts (raw-evaluated) moved to `alerts-archive` (`archiveReason: pre-smoothing-raw`), verified. Decision: keep the archive and let alerts accumulate from now on. Pre-cutoff history lives only in `alerts-archive`. Undo: oneoff `--undo`. Don't re-run casually. |
| Axis registry X1 | handbook / Hillel | ✅ applied 2026-10-05 08:10Z | `axes` on 15 devices-types docs; cracktemp temperature thresholds cleared (31 sensors); probe retyped. [axes.md](./axes.md) |
| Axis registry X2 / X3 | web-platform / functions | ⏳ sent | UI reads the registry; functions loader + prism flag (E/N/H) in shadow |
| BR-0.1, BR-0.2 | bridge | ✅ investigated | [findings](./findings-2026-09-23.md): A station frame (ongoing), B station point identity, C device-map errors |
| ATS mapping (BR-1.x, BR-R.x, ATS-*, FN-0.6) | bridge, station, functions | ⏸ parked | Merged into the ATS IDs & naming work ([`../ats/ids-and-naming.md`](../ats/ids-and-naming.md) §6). Not urgent: raw data is kept on the ATS PCs. Known: ATS-6 bad frames since 09-23 (153 client alerts on 5 projects since 09-08); `cleanUnconfirmedSensors` would delete the 11 `ATS-5-f*` sensors around 10-11 (orphaned data, recoverable). |

## Regression runs

| Date | Script | Result |
|---|---|---|
| 2026-10-04 | `ingest-lag.ts --days=30` | 50,361 samples; 12% arrive >48h late (bulk catch-ups after outages + צייטלין tilt 4/5 slow drain, ~5 days behind); ATS live max lag 0.6h; 33 out-of-order |
