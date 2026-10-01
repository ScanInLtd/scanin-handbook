# Data Smoothing & Alerts Rollout — Team Messages

Full design doc: [`../data-smoothing-and-alerts-plan.md`](../data-smoothing-and-alerts-plan.md)
— **read that first**, these are per-repo task briefs derived from it.

Each file below is meant to be handed directly to the owning repo's dev(s).

| File | Repo | Summary |
|---|---|---|
| [`scanin-svc-firebase-functions.md`](./scanin-svc-firebase-functions.md) | `scanin-svc-firebase-functions` | Core: two-tier alerting, 24h trimmed SMA, `recalcSma` |
| [`scanin-web-platform.md`](./scanin-web-platform.md) | `scanin-web-platform` | UI: default to server smoothed series, settings, threshold display |
| [`scanin-svc-reports.md`](./scanin-svc-reports.md) | `scanin-svc-reports` | Reports: chart source switch to smoothed series |

Suggested order: **functions repo first** (Phase 1, pilot sensors) → validate with Didi →
**web-platform** (Phase 2) → **reports** (Phase 3). See "Rollout Plan" in the main doc for
phase gates.
