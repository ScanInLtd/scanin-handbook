---
title: Raw line follows baseline events — committed + live; checked on f13p6 / f4p11 by data (not visually)
from: scanin-web-platform
to: user
kind: feedback
status: open
created: 2026-10-20T19:50
---
Reply to `20261020-1915-raw-follows-baselines.md`.

**Commit:** `46af0ef` fix(sensor-chart): raw line adjusted per baseline event (piecewise), matches the MA. These are the handbook session's 3 files, reviewed and unchanged. I committed them on their own, separately from B3 (`84f6142` and `ad91b92`).

**Live:** https://new-scanin-ui.web.app, bundle `main-es2015.a974e9fec51cc429b615.js`.
- The production build used Node 12 and passed. The deploy came from a clean tree at `46af0ef`.
- B3 had already been deployed earlier (bundle `91e3010…`). This deploy contains B3 and the raw fix.
- No hard feelings about the killed build. I re-ran it before both deploys.

**Check:** I can't open an admin browser session, so I checked with the data instead of visually.
- **How:** a read-only Firestore query over 08.10–16.10 (Israel time) for both sensors.
- **Method:** apply the same `initialAt` rule to the raw samples, then compare them with the stored `smooth` (MA). The table shows the |raw − MA| gap in mm on non-suspect samples.
- **Result:**

| sensor | axis | single initial (old): median / p90 | piecewise (new): median / p90 |
|---|---|---|---|
| f13p6 | E | 4.35 / 6.15 | **0.27 / 2.46** |
| f13p6 | N | 5.48 / 8.26 | **0.21 / 1.04** |
| f13p6 | H | 5.44 / 15.60 | **0.63 / 4.35** |
| f4p11 | E | 4.27 / 5.87 | **0.21 / 0.87** |
| f4p11 | N | 5.47 / 6.49 | **0.34 / 0.63** |
| f4p11 | H | 3.52 / 13.81 | **0.41 / 1.23** |

- With piecewise baselines the raw points sit on the MA line. The old −3…−15 mm offsets are gone.
- **Remaining single points:** a few individual readings are still 5–8.5 mm from the MA, mostly height (f13p6 H max 8.5, f4p11 H max 8.3). They are single raw readings that the MA smooths over, not steps.
- "Unadjusted" isn't affected; it still shows true raw.
- **Please take a quick look in the UI:** open `/s/Hrm0tH08Pto0UVJLzVaW` and `/s/77eMf4CHjLSYUHkuscLK` with Points on.

**Not covered by this fix** (these places still subtract one constant `initial-value`):
- **Group view:** `pages/sensor-groups/sensor-group-view.component.ts:533` (`sensor.initialValues?.[axisKey]`). Group charts of ironed prisms will still show the steps in raw.
- **Legacy line chart / compare:** `charts/line-chart/line-chart.component.ts`. I didn't trace it further.
- **Settings → Sensor Status:** `pages/settings-sensor-status/settings-sensor-status.component.ts:141,240`. It uses the current initial for the latest value only, which is correct, since the latest event is the current one.
- If you want the group view fixed, `initialAt` can be reused there once each sensor's baseline events are loaded. That's a small follow-up.
