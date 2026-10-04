# Task: Firestore rules — sync the deployed ruleset into git and remove the temporary open rules

_Status: TODO (planned for the week of 2026-10-04). Owner repo: `scanin-web-platform`. Found during Signal & Alerts Phase 1 review._

## Findings (2026-10-04, verified against the deployed ruleset)

| Date | What | Evidence |
|---|---|---|
| until 2026-01 | Production rules were open to the world (`allow read, write: if request.time < timestamp.date(2029, 12, 3)`) | web-platform `docs/refactoring/firestore.rules.production-current-backup` |
| 2026-01-19 | Mobile app got Google login; web UI got the authorization guard | fw-datalogger `ae6fcc0`, web-platform `4ec3aa1` |
| 2026-01-20 | Deployed: auth required everywhere, **except** `projects`, `family_calibrations`, `device_calibrations`, `calibration_templates` → `allow read, write: if true` ("TEMPORARY … TODO: Remove before production"). The proper PROJECTS block is commented out. Not committed to any repo. | ruleset `2451a414-b9d9-4a65-a7b2-ba9a153bb092` |
| 2026-03-15 | Mobile app login bypass removed; the app always signs in before Firestore access | fw-datalogger `3586c88`, `0e77aa4` |

So the open rules are a leftover workaround. Nothing in the code needs unauthenticated access anymore. The only thing that would break is an old mobile app build from Jan–Mar without login, and the app is rarely used.

## Message → `scanin-web-platform`

```
Task: Firestore rules — sync the deployed ruleset into git and remove the temporary open rules

Context
The deployed ruleset (projects/dataloggerdev/rulesets/2451a414-b9d9-4a65-a7b2-ba9a153bb092,
released 2026-01-20) = this repo's firestore.rules with two local, uncommitted changes:
  a) the PROJECTS block is commented out ("TEMPORARILY DISABLED - Using open access rule
     below for mobile app development")
  b) a "TEMPORARY: Mobile App Collections (No Auth Required)" section:
       family_calibrations, device_calibrations, calibration_templates, projects
       → allow read, write: if true;   ("TODO: Remove these rules ... before production")
These were a workaround while the mobile app ran without login. The app's login was
restored on 2026-03-15 (scanin-fw-datalogger 3586c88 / 0e77aa4): it always signs in
with Google before any Firestore access, so the open rules are no longer needed.
The working tree may have an uncommitted data-integrity block added by the functions team
— keep it.

Steps
1. Commit the deployed ruleset AS-IS as firestore.rules ("chore: sync deployed firestore
   rules (2026-01-20)"), with the data-integrity block on top of it.
2. Second commit: delete the whole "TEMPORARY: Mobile App Collections" section (all 4
   blocks). Those collections then fall under the existing catch-all
   (request.auth != null), like every other collection.
   Do NOT re-enable the commented-out PROJECTS block (assigned users / admin) — several UI
   pages list all projects without an array-contains filter (settings-project, ats-runs,
   multi-sensor-rules, report-config, data-handling-tools, …) and would break for
   non-admins. Leave it commented, and list in your summary which of those pages are
   reachable by non-admin users (input for a later task).
3. Test (emulator or Rules Playground): unauthenticated read/write of projects and of one
   calibration collection → denied; authenticated → allowed.
4. Check that nothing reads/writes these collections before login:
   - web-platform: public routes (login, unauthorized, /mute, /status, …)
   - ../scanin-fw-datalogger/mobile_app: confirm every Firestore call is behind AuthWrapper
   Report findings.

Constraints
- Production = dataloggerdev. Deploy ONLY rules, only after I approve:
  firebase deploy --only firestore:rules
  (never --only firestore and never indexes — this repo's firestore.indexes.json is empty
  while prod has 15 composite indexes).
- Don't touch storage rules.

Reply with a summary:
- Commit hashes (sync + change)
- Diff of step 2
- Test results
- Any pre-login access found (web or mobile)
- Non-admin-reachable pages that list all projects (for the later PROJECTS rule task)
- Deploy status
```

## Later (separate task)

- Narrow the catch-all `match /{document=**} { allow read, write: if request.auth != null; }`. Today any logged-in user, including a client, can read and write almost every collection, including `data-integrity`.
- Re-enable a PROJECTS rule (assigned users or admin) once the UI's project queries are filtered.
