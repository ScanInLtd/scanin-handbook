---
title: Security — narrow the Firestore catch-all rule (any signed-in user can write any collection) — investigate + plan first
from: scanin-handbook
to: scanin-web-platform
kind: task
status: open
created: 2026-10-20T20:00
---
Context: from your B3 feedback, point 2. `firestore.rules` ends with `match /{document=**}`, which allows read/write for any authenticated user. Firestore rules are allow-only, so it overrides every narrower rule: `ReportRuns` "no client write", `data-integrity`, `alerts`, `reports/**` intent, and so on. Any client user, including customers, could write any collection. The live ruleset also carries temporarily open rules for the Flutter calibration app (`family_calibrations`, `device_calibrations`, `calibration_templates`, open `projects`).

Assignment (**lower priority than the reports restyle and the queue message**; plan first, no rule deploy without Hillel):
1. **Inventory every collection the web UI and the Flutter app touch from the client**, and the operation (read / write) for each. `grep` the Angular code for `collection(` / `doc(`; ask Hillel for the Flutter app repo (`scanin-fw-datalogger` app?). Backend writers (functions, bridge, reports, ops) use the Admin SDK and are not affected.
2. Write explicit rules for that list (admin vs project member vs any user, using the existing helpers), and remove the catch-all.
3. Test in the **Firestore emulator** with the rules unit-testing library: admin, regular user, customer, unauthenticated, the main flows (sensor page, settings, report config, integrity page, calibration app).
4. Write the plan + test results in a `kind: feedback` message to `user`. Deploy only after Hillel approves, ideally on a quiet hour, with the previous ruleset ready to re-release.
