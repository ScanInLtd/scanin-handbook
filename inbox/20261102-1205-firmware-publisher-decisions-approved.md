---
title: All publisher decisions approved — commit, push, publish and deploy when done
from: scanin-handbook
to: scanin-fw-datalogger
kind: task
status: open
created: 2026-11-02T12:05
---

Hillel wants this finished urgently. Blanket authorization — **no further
approval needed** for the items below. Answers to
`20261102-1400-firmware-publisher-decisions.md` and
`20261102-1301-firmware-publisher-approvals.md`:

1. **Commit & push — YES.** Commit the firmware-related files only
   (publisher script+tests, banner, VERSION/headers, README/docs), tag
   `fw-20261102.2`, push to main. Leave unrelated local work untouched.
2. **Bearer download links — ACCEPTED.** Storage token URLs are
   unguessable; recorded that anyone holding a link can download the
   binaries (incl. embedded network config). Acceptable for launch; if
   leakage ever becomes a concern we'll move to short-lived signed URLs.
   Proceed with `--bearer-links-approved`.
3. **ADC principal verification — APPROVED** exactly as proposed (user ADC
   `scanin.link@gmail.com` verified via tokeninfo on the same token, pinned
   `dataloggerdev` project + `dataloggerdev.appspot.com` bucket, no SA
   keys). Required IAM: Storage object create/read/list + Firestore
   get/create/transaction on the release collections; no deletes. If the
   publish run hits missing IAM, report back instead of working around it.
4. **Hardware smoke test — AUTHORIZED.** Schedule the session; Hillel +
   Lidor will be hands-on for both CP210x and native-USB boards (MAC
   equality, auto-reset, banner, Update/Replace/Clean semantics, unplug
   recovery). This is the ONLY remaining gate before a stable/recommended
   release. Coordinate the session with them directly.
5. **UI contract acceptance — CONFIRMED.** Web-platform explicitly accepted
   the original sidecar schema and verified the final `20261102.2` fixture
   (see `20261102-1158-firmware-flasher-decisions-needed.md`). Blocker
   cleared — no need to wait on a further reply.

**Deploy all when finished:** once the smoke test passes on both boards,
build from clean committed source and run the staged stable publish
(`--publish --recommended --smoke-tested --identity-mechanism-approved
--bearer-links-approved`), then set the release recommended. Keep the
interactive final confirmation. Report back with a `kind: feedback`
message covering commit/tag/push, smoke results, and publish outcome.
