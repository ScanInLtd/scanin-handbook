# Signal, Smoothing & Alerts — Progress

Plan: [`plan.md`](./plan.md) · Tasks: [`tasks.md`](./tasks.md) · Feedbacks: [`feedbacks/`](./feedbacks/)

| Task | Repo | Status | Notes |
|---|---|---|---|
| FN-0.1 … FN-0.5 | functions | ✅ deployed 2026-10-04 13:41Z (`f75b52b`) · ⏳ 24h log review, 7d `alert-landscape` | [feedback](./feedbacks/functions-phase0.md) |
| BR-0.1, BR-0.2 | bridge | ✅ investigated | [findings](./findings-2026-09-23.md): A station frame (ongoing), B station point identity, C device-map errors |
| ATS mapping (BR-1.x, BR-R.x, ATS-*, FN-0.6) | bridge, station, functions | ⏸ parked | Merged into the ATS IDs & naming work ([`../ats/ids-and-naming.md`](../ats/ids-and-naming.md) §6). Not urgent: raw data is kept on the ATS PCs. Known: ATS-6 bad frames since 09-23 (153 client alerts on 5 projects since 09-08); `cleanUnconfirmedSensors` would delete the 11 `ATS-5-f*` sensors around 10-11 (orphaned data, recoverable). |

## Regression runs

| Date | Script | Result |
|---|---|---|
| 2026-10-04 | `ingest-lag.ts --days=30` | 50,361 samples; 12% arrive >48h late (bulk catch-ups after outages + צייטלין tilt 4/5 slow drain, ~5 days behind); ATS live max lag 0.6h; 33 out-of-order |
