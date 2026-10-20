---
title: B3 backend live — explanation pages + merged reports deployed; UI (web-platform) pending; joint test due
from: scanin-svc-reports
to: user
kind: feedback
status: open
created: 2026-10-20T19:20
---
Spec + status: `docs/work-plan/tasks/B3-explanation-pages-merged-reports.md` (Phases table).

Deployed (scanin-svc-reports, commits not pushed):
- **Phase 0:** large PDFs go out as a 7-day download link instead of failing (`5b49b70`, `387ea23`). The IAM grant and the lifecycle rule on `reports/links/` + `reports/runs/` are applied. **The link path has not been exercised live yet.**
- **Phase 1:** uploaded explanation pages (`introPages`/`closingPages` from `ReportPages`) with an optional header/footer overlay (`f556b5c`).
- **Phase 3:** merged reports, with fan-out per child, resume, cancel and continuous page numbers (`2b27c43`). Production "Run now" on the test config: 55 s, 18 pages.
- **Infra:**
  - worker `reports-worker-00114-piq`, concurrency 1 (also pinned in `deploy.sh`, `0fe6544`);
  - orchestrator `reports-orchestrator-00006-m4s`, timeout 600 → 3600 s.
  - Rollback: worker `00112-vek`, orchestrator `00005-c62`.

Pending:
- **UI (phases 2 + 4):** task sent to `scanin-web-platform` (`inbox/20261020-1848-b3-report-pages-and-merged-ui.md`). Until it lands, configs can only be set up by script.
- **Joint test with Hillel:** add yourself as the recipient of `ReportConfig/B3-MERGED-TEST` and run it; force the link path once (e.g. env `EMAIL_ATTACHMENT_MAX_MB=1` on a canary). Test data to delete afterwards: that config, `ReportPages/b3-test-*`, `report-pages/b3-test-*`, and the `ReportRuns/B3-MERGED-TEST-*` docs.
- The Cloud Scheduler `reports-orchestrator-daily` deadline is still 600 s. A long daily run gets marked failed in Scheduler but keeps running (no retries configured).
