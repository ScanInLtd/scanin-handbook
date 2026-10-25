---
title: Done — report editor chart display toggles deployed (b591492, main pushed)
from: scanin-web-platform
to: user
kind: feedback
status: open
created: 2026-10-23T13:10
---
Re: `inbox/20261023-1300-report-display-options-ui.md`. Implemented, built, deployed, pushed.

- **Commit:** `b591492` `feat(report-config): chart display toggles (connectGaps, markers, UI scale)` — `main` pushed (`eaaaeba..b591492`; this also pushed the 5 previously-local commits `84f6142…b7f2636`, closing queue item 1 of `20261020-2000-web-platform-queue.md`).
- **Bundle:** `main-es2015.59be260399b0daeb5cb8.js` (build hash `33dd7fb2a4ba47af0284`, Node 12). Deployed to hosting `new-scanin-ui` version `028c4be6f5b9bbb3`; https://new-scanin-ui.web.app returns 200.
- **Section:** inside the "Advanced options" panel (now also shown for merged reports), a "תצוגת גרפים" group of 5 `mat-slide-toggle`s with Hebrew titles and short English help text: חבר קו מעל פערים בנתונים (off) · הצג אירועי קו בסיס (on) · הצג סימוני התראות (on) · סקאלה כמו בממשק (off) · קבע סקאלה גם אם יש ערכים מחוץ לטווח (on, disabled unless UI scale is on). The uiScale fallback note ("a sensor without uiScale falls back to the automatic scale") is in the tooltip. The panel description counts deviations from defaults, including these 5.
- **Data:** all 5 fields are written explicitly on save for sensor/group/merged reports (allowed per spec — explicit default doesn't flip behavior). For merged they are also stamped onto each `children[i]` spec so they reach `childOverrides` per part; merged level applies to all parts.
- **REP141 check** (`ReportConfig/Nn5D8EIN9shaaSvhCqPO`, sensor report): doc has `connectGaps:true`, `showBaselineMarkers:false`, `showAlertMarkers:false`, `useUiScale:true`, `forceUiScale` missing → editor shows connectGaps on, both markers off, UI scale on, force on. Save without changes writes `forceUiScale:true` (the default — behavior identical); fields already set keep their values.

**Heads-up — one gap in scanin-svc-reports:** the worker's `childOverrides()` (`scripts/services/mergedReport.js`) currently passes only `periodOverride` / `coverImageUrl` / `titleOverride` / `includeExplanationPages`. The 5 fields now stamped on `children[i]` are ignored until `childOverrides` forwards them — a ~5-line pass-through plus a worker deploy. Sensor/group reports already work with the live worker (`reports-worker-00120-yux`). Want me to send a task to scanin-svc-reports for the pass-through?

**Also open from the queue** (`20261020-2000-web-platform-queue.md`), not started: item 2 group-view raw per baseline event, item 3 image downscale on upload.
