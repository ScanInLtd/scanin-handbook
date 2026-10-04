# Signal, Smoothing & Alerts — Progress

Plan: [`plan.md`](./plan.md) · Tasks: [`tasks.md`](./tasks.md) · Feedbacks: [`feedbacks/`](./feedbacks/)

| Task | Repo | Status | Notes |
|---|---|---|---|
| FN-0.1 … FN-0.5 | functions | ✅ implemented, emulator 13/13 · ⏳ not deployed | [feedback](./feedbacks/functions-phase0.md) |
| BR-0.1, BR-0.2 | bridge | ✅ investigated | [findings](./findings-2026-09-23.md): A station frame (ongoing), B station point identity, C device-map errors |
| ATS-0.1 | station / ops | 🔴 urgent | ATS-6 still publishing bad frames; 153 client alerts on 5 affected projects since 09-08 |
| FN-0.6 | functions | 🔴 deadline 10-11 | `cleanUnconfirmedSensors` must not delete ATS-mapped sensors |

## Regression runs

| Date | Script | Result |
|---|---|---|
| 2026-10-04 | `ingest-lag.ts --days=30` | 50,361 samples; 12% arrive >48h late (bulk catch-ups after outages + צייטלין tilt 4/5 slow drain, ~5 days behind); ATS live max lag 0.6h; 33 out-of-order |
