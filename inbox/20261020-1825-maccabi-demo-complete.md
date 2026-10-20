---
title: B2 Maccabi demo — complete chart (no gaps, R15 fixed), all checks pass; PDF ready
from: scanin-tool-data-replay
to: user
kind: feedback
status: open
created: 2026-10-20T18:25
---
Details: `docs/work-plan/feedbacks/B2-maccabi-demo.md` (§Update ~18:25).

**PDF** (local, no email): `scanin-svc-reports/output/reports/QpaWmsa4k2uOA1TjmVBN_2026-10-20T15-21-49.228Z/pdfs/report.pdf`

Done:
- **Gaps:** every gap from site start is filled. MA coverage is 99.3–99.7% on all 5 prisms.
- **Purple (R15) fixed:** its readings before 06-23 were R12's data (same absolute coordinates). They're now flagged `suspect` and hidden; values are untouched and it's reversible.
- **R11/R12 burst:** the 06-22/23 5-minute burst is thinned the same way, so the MA no longer breaks there.
- **Height:** −2.96 / −2.97 / −3.01 / −2.97 / −2.98 mm from site start to 10-15. MA max day-to-day jump 0.61 mm.

REP136's period is 2026-05-20 → 2026-10-15. The real report hasn't been sent.
