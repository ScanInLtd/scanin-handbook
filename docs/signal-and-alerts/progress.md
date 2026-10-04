# Signal, Smoothing & Alerts — Progress

Plan: [`plan.md`](./plan.md) · Tasks: [`tasks.md`](./tasks.md) · Feedbacks: [`feedbacks/`](./feedbacks/)

| Task | Repo | Status | Notes |
|---|---|---|---|
| FN-0.1 … FN-0.5 | functions | ✅ implemented, emulator 13/13 · ⏳ not deployed | [feedback](./feedbacks/functions-phase0.md) |
| BR-0.1, BR-0.2 | bridge | ⏳ sent | 09-23 prism event, 8.9 m flip-flops |

## Regression runs

| Date | Script | Result |
|---|---|---|
| 2026-10-04 | `ingest-lag.ts --days=30` | 50,361 samples; 12% arrive >48h late (bulk catch-ups after outages + צייטלין tilt 4/5 slow drain, ~5 days behind); ATS live max lag 0.6h; 33 out-of-order |
