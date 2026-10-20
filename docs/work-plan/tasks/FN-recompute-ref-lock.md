# Task — recomputeSmoothing must not lock onto bad history (functions)

_From: Hillel, 2026-10-20. Repo: `scanin-svc-firebase-functions`. Needed **before** any fleet-wide full-history backfill (plan A1). Not needed for the DeVinci ironing (A4), which is covered by baseline events._

## Problem (found in a dry-run, 2026-10-20)
`node scripts/recompute-smoothing.js --project=e2NemfiQGhgKTW2FgJtu --days=all` (JAFFA_68, dry-run):
- Prisms **"3" `p8lLBLV4G5UPqZWE2f95`** and **"4" `goGPs88egjdkXvbsMrnp`**: **2,191 of ~2,600 samples would be flagged `suspect`** (84% of their history hidden from charts and reports).
- History of "4" (raw − initial, monthly medians): Dec 2024–Feb 2025 installation junk (East −18 → −47 → −104 mm), then **18 months calm** (±2 mm, March 2025 → now).
- With `--days=365` (starting after the junk) the same prisms get 90% smooth and 18 suspects. So the history itself is fine; the recompute just never recovers from the junk.

**Cause** (`src/recomputeSmoothing.ts`): the running `ref` per axis is seeded at the chain start and **updated only from non-suspect samples** (≈ line 323). When the chain starts inside junk (or crosses a real level change without a baseline event), every later sample is > `limits.jump` from the stale `ref`, gets flagged, so `ref` never updates, and the flags last forever. The live evaluator escalates this case to a data-integrity notice (a human decides: release / baseline / ignore). Recompute **never raises notices**, so nobody ever resolves it.

## What to change
1. **Recover from a stale ref in recompute.** If an axis has been suspect continuously for a whole window (e.g. ≥ 2 × the smoothing window **and** ≥ N samples) and those samples agree with each other (spread ≤ jump/2), **re-seed `ref`** from their median, un-flag the samples that are consistent with the new level (evaluator flags only; never clear ingestion flags), and continue.
   - Count every re-seed in the stats (`refReseeds`, with sensor / axis / time) and print them in the script summary, so we can see where history had steps without baseline events.
2. **Same rule for the chain start:** when the very first window is inconsistent (junk at installation), don't seed `ref` from it. Seed from the first stable window.
3. **Live evaluator:** leave as is (it raises notices). Just confirm in the feedback that it's unaffected.
4. **Emulator tests:**
   - junk-then-calm history → calm era fully smoothed, not suspect;
   - a real step without an event → one re-seed reported, the post-step era smoothed;
   - isolated spikes are still flagged;
   - ingestion suspects preserved;
   - `wouldChange = 0` on a second run.
5. **Re-run the dry-runs** (read-only) and report: JAFFA_68 `--days=all`, then `--all-active --days=365 --type=prism`. List the sensors with re-seeds; those are the ones that need a baseline event at a real historical step (e.g. JAFFA_68 "1" `xmXaS7p7cjlRTkoRZhrs`: ~+1,831 mm offset Feb 2025–Jan 2026, back to ~0 in Feb 2026, a zero change without an event).

## Delivery
Commit, **don't deploy and don't run `--apply`**. Feedback in `../scanin-handbook/docs/signal-and-alerts/feedbacks/functions-recompute-ref-lock.md` with the dry-run tables. Hillel approves the deploy and any backfill.
