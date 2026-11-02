---
title: ATS gateway prefix enforced, site rename, resend rewrite — shipped in 1.3.21
from: scanin-fw-ats-monitoring
to: scanin-handbook
kind: feedback
status: done
created: 2026-11-02T19:00
ref-task: inbox/20261102-1728-ats-gateway-id-prefix-site-rename-and-resend.md
---

Released as **v1.3.21** (commit `01e3b82`, main → `ats-release`). The station shows
"Update available" within ~3 h, or immediately via "Check now" in the sidebar.

## 1. `ats-` prefix — enforced

- `CloudConfig.device_id_error()` (`sync/publisher.py`) validates fleet ids: must start
  with `ats-`, then only `[A-Za-z0-9_-]` (the id lands in cloud sensor/doc names).
  The integration scheme is untouched (different routing rules).
- When the id is invalid, **publishing is refused**: `drain_outbox` /
  `publish_rows_now` return early with `device_id_error` and leave rows pending —
  nothing is marked sent, so a resend works the moment the id is fixed.
- Loud warnings: `[cloud] ERROR … Publishing is REFUSED` at startup, red "Refused" /
  "bad gateway id" on the Cloud tab and in the status bar.
- The id is **editable on the Cloud tab**: fixed `ats-` prefix + suffix field →
  `POST /api/cloud/device-id` → validated, written to `.env` (line updated in place)
  and applied immediately — no restart, no manual `.env` edit needed over RDP.

## 2. Site rename

- Setup → Site → **Rename…** → `POST /api/sites/rename`. Validation on both create and
  rename: ASCII `[A-Za-z0-9_-]` starting with a letter/digit, no spaces (`site_name_error`,
  `store/db.py`). The dialog spells out the consequences: local history stays linked
  (everything keys on the integer site id), but **cloud records under the old siteId are
  not merged** — downstream it reads as a new site. A `site-renamed` `ats-event` is
  emitted for traceability (`previousSiteId` → `siteId`).
- Existing sites with invalid names are left alone until renamed; creating/switching to
  them by exact name still works (only *new* names are validated).

## 3. Resend / backfill — already existed, now fixes ids too

- The resend path already existed: Cloud tab "Resend already-sent in range",
  `POST /api/outbox/resend {ids|since_ts,until_ts|all}`, and `resend_all.bat` /
  `scripts/resend_all.ps1`. It re-queues sent rows and republishes **the stored
  topic/payload** — important: before this release that meant a resent `ats7` message
  would still land on `scanin/ats7-*/…` and get dropped again.
- New options on the same endpoint/UI:
  - `retopic` — rewrites the gateway id inside each topic (and `deviceId` /
    `sensorData.gateway_id` in payloads) to the current id. Old ids are auto-detected
    from gateway-level topics (status/ats-health/ats-event/ats-log); `retopic_from`
    overrides. UI: a warning line appears when sent rows carry other ids and the
    "Rewrite gateway id…" checkbox is pre-ticked.
  - `update_site_id` — rewrites payload `siteId` to the current site name (for resend
    after a rename).
  - `GET /api/outbox/gateway-ids` reports `{current, others[]}` for the UI notice.
  - `resend_all.ps1 -Retopic [-RetopicFrom ats7] [-UpdateSiteId]`.

**Recovery procedure for the Savyon PC:** update → Cloud tab → set gateway id to
`ats-7` (auto-saved) → Setup → Site → Rename… (e.g. `savyon-office`) → Cloud tab →
pick the Oct 30 → now range → leave "rewrite gateway id" ticked, tick "write current
site id" → Resend. Samples then reach `work-sensors` under the new ids for the
`ats-device-map` mapping step.

Tests: `tests/test_gateway_id.py` (+82 total all green); smoke-verified end-to-end
against the TestClient (bad id refused, `.env` persisted, all three rewrite paths).
