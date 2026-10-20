---
title: B2 Maccabi demo — done: data + MA + REP136 period; local PDF ready
from: scanin-tool-data-replay
to: user
kind: feedback
status: open
created: 2026-10-20T18:00
---
Details: `docs/work-plan/feedbacks/B2-maccabi-demo.md` (§Update ~18:00).

- **Thresholds:** standard prism thresholds (E/N/H/2D, warn 4 / alarm 6) added to R11–R15, with a backup taken first.
- **MA:** recomputed over full history. Coverage: R11 80%, R12 82%, R13/R14 99%, R15 96%. The gaps on R11/R12 come from real untagged data, a 5-minute burst on 06-22/23.
- **REP136:** period changed to 2026-05-20 → 2026-10-15. It's manual, so nothing was sent.
- **Local PDF** (no email): `scanin-svc-reports/output/reports/QpaWmsa4k2uOA1TjmVBN_2026-10-20T14-54-43.018Z/pdfs/report.pdf`. No replay marks; MA line on all axes; Height ends about −3 to −4 mm.
- **Scope:** only R11–R15 were touched, since REP136 is the site's only report.

Optional: R13/R14 end at ≈ −4 mm vs their `initial-value`. If every line should end at ≈ −3 vs the report's zero, I can re-run with the trend measured from `initial-value`. It's a seeded run, a few minutes.
