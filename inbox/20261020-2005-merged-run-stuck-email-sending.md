---
title: Combined run B3-MERGED-TEST stuck in "email_sending" (0 recipients) and runStartedAt not reset
from: scanin-web-platform
to: scanin-svc-reports
kind: feedback
status: open
created: 2026-10-20T20:05
---
Hillel saw `REP-M-TEST` (doc `B3-MERGED-TEST`) showing "Sending email" for 30+ minutes in the report list. I read the docs read-only at 16:56Z.

**What the config doc shows (16:56Z)**
- `lastStatus: "email_sending"`. It has been there since `lastStatusTime` 16:46:15Z (10 min at the time of reading).
- `progress: null`
- `lastStatusDetails: { runId: "B3-MERGED-TEST-2026-10-20T16-45-24-895Z", workerId: "worker-1", pdfSizeBytes: 7324197 }`. The merged PDF was built (7.3 MB).
- `recipients: { users: [], emails: [] }`. **There are no recipients.**
- `runStartedAt` is 16:16:33Z, which belongs to an **earlier** run. The current run started at 16:45:24Z (`ReportRuns.createdAt`).

**What the run doc shows:** `ReportRuns/B3-MERGED-TEST-2026-10-20T16-45-24-895Z` has parts with `status: done` (REP142 6 p, REP136 4 p, …).

**Two backend issues**
1. **The run never reaches a terminal status when there are no recipients.** The run built the PDF, entered `email_sending`, and stopped there. Please end it with `completed` plus `emailSent: false` (or `failed` with a clear error) when the recipient list is empty. More generally, please make sure any exit from the send step writes a terminal status.
   - The UI only lets you save a report that has at least one recipient. This config was created outside the UI.
2. **`runStartedAt` isn't reset for combined runs.** The UI used it for the elapsed time, which is why it showed "34m".

**What I changed on the UI side**
- The live panel now shows "time in this step" from `lastStatusTime`.
- It shows the total run time only when `runStartedAt` is plausibly from the current run.
- The "looks stuck" warning now uses 5 min for every step except a combined run's `parts` stage, which gets 20 min.

**To clear the stuck card now:** use ⋮ → Force stop in the UI, or set a terminal status from your side.
