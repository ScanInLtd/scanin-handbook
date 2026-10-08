# Improving how we work with AI agents across the ScanIn repos

_Status: ideas, not started (written 2026-10-08, after the signal & alerts rollout, 2026-10-04 → 10-06). Owner: Hillel._

## Summary

The tool (Devin Desktop or Claude Code) matters less than the structure around it. Both support the same building blocks: a rules file (`AGENTS.md` / `CLAUDE.md`), skills, subagents and multi-folder workspaces. Most of the friction in the rollout came from three things a tool switch wouldn't fix:

1. Hillel acted as the message bus between agents.
2. Infrastructure facts weren't written down anywhere.
3. The data model lived in people's heads, with duplicated copies across repos.

Fix those first. Then trying another tool is cheap, because the same docs and skills carry over.

## What worked (keep it)

- **The handbook as the hub:** spec in `docs/<topic>/`, then one message per repo, then the repo writes `feedbacks/<repo>-<topic>.md`, then `progress.md` is updated. Every agent shares the same memory, and the work stayed coherent across many sessions.
- **`ops/` writes to production via `oneoff/` scripts:** dry run, then `--apply` with a typed `yes`, a backup, and `--undo`. Every production write was reviewable and reversible.
- **Feedback files written by the implementing agent:** commits, test results, deploy plan, rollback, open questions. That's the right contract between agents.

## Where time was lost

| Problem | Examples from the rollout |
|---|---|
| **The human as router.** Messages copy-pasted between agent windows, then "read the feedback". | Functions deployed links before the UI page existed. The UI team didn't know their mapping screen was redesigned. Round trips for every step. |
| **Undocumented infrastructure.** | About 10 round trips to query the MQTT broker: which VM, which `.env`, the ACL, port 1883 vs 8883, users with read-only access. The Windows host for the Beanair processor (needs the VS Developer Prompt). `signBlob` permission missing for callable tokens. Deploy commands rediscovered per service. |
| **Data model not written down; types duplicated in 3 repos.** | The wrong assumption that sample doc IDs come from the timestamp (only live ATS does). Station-2 sensors outside the project were missed by a remap. Wrong claims about backfill coverage. `freqeuncy` / `frequency`. Notifications stored as samples. |
| **Almost no tests outside functions.** | Every bridge, reports and Beanair change was verified with throwaway `/tmp` scripts. The Beanair change wasn't even compiled before deploy. |
| **Long sessions.** | Context was lost and summarised. Decisions had to be re-explained. |

## Recommendations (in order of value)

### 1. One orchestrator session across all repos
- Open `~/dev/clients/scanin` as the workspace, or add every repo to it.
- The orchestrator dispatches per-repo work to **subagents** (in parallel, in the background), reads their feedback files, and reports **one** combined summary to Hillel.
- Hillel only approves decisions, writes to production, and deploys. He doesn't carry messages.
- The handbook stays the shared memory (spec → feedback → `progress.md`).
- Rule: agents never deploy something whose dependency isn't live yet. The orchestrator enforces the order, for example "UI page live → then functions links".

### 2. `docs/ops/infra.md` (most urgent)
For each runtime:
- **Where it runs:** `monitoring-bridge-vm`, `mqtt-broker` VM, the Windows host (Beanair processor, `C:\Users\user\Documents\GitHub\ScaninVibrationService`), Cloud Run (reports orchestrator/worker, watchdog, prism-daily), Cloud Functions, Hosting (`new-scanin-ui`).
- **Deploy and rollback:** the exact commands, the Node version, and who is allowed to deploy.
- **Credentials:** where they live (location only, never values). For example: the bridge MQTT creds are in `~/monitoring-bridge/.env` on the bridge VM; the broker only has hashes in `/etc/mosquitto/passwd`; the ACL is at `/etc/mosquitto/acl`.
- **How to get read-only access safely:** for example, a temporary broker user with an ACL line, removed afterwards; `mosquitto_sub --retained-only`.
- **Known permission gaps:** for example, `iam.serviceAccounts.signBlob` for the ops account, so callables can only be run via the compiled functions `lib/` with ADC.

### 3. `docs/data-model.md`
- The canonical shape of each collection:
  - `work-sensors`, and its `data-log`: fields, how doc IDs are built **per writer**, and `smooth`, `eval`, `suspect`, `daily::*`;
  - `baseline-events`;
  - `ats-device-map`;
  - `alerts` (tiers, `whatsapp` outbox fields);
  - `data-integrity` (kinds, dedupe);
  - `devices-types/.../{type}` (the axis registry);
  - `projects/{id}` flags (`alerting`, `prismAxes`, `isActive`);
  - `system-config/*`.
- For each collection: **which repo writes it, which repo reads it.**
- Later: one shared types package to replace the 3 copies of `shared-status-types` (web-platform, functions, reports).

### 4. A short `AGENTS.md` in every repo (about 30 lines)
- How to build, how to verify, how to deploy, how to roll back.
- Gotchas:
  - web-platform builds on Node 12 and deploys on Node 20; hosting only, never `firestore.rules` from a feature branch.
  - Beanair builds only from the VS Developer Prompt.
  - The bridge has no tests.
  - Production is `dataloggerdev`.
- A link back to the handbook (`AGENTS.md`, `infra.md`, `data-model.md`).

### 5. Skills (`scanin-handbook/.devin/skills/`)
Write down the repeated patterns so agents reuse them instead of reinventing them:

| Skill | What it covers |
|---|---|
| `prod-oneoff` | Script template with dry run, backup, `--undo` and typed-`yes` apply, plus the approval protocol (show the dry run, then the user approves). |
| `cross-repo-task` | Spec, then per-repo messages, then subagents, then feedback files, then `progress.md`. Deploy ordering. |
| `deploy-<service>` | Exact commands and post-deploy checks for functions, hosting, reports, the bridge VM and the Beanair host. |
| `investigate-sensor` | Trace a sensor end to end: device topic, bridge handler, mapping, `data-log`, `checkThresholds`, alerts and notices, UI and reports. |
| `ats-debug` | Station point, `ats-device-map`, sensor; station renames; retained messages; baselines (`ats-setup`); splitting mixed sensors by station coordinates. |

### 6. A verification command per repo
- `./go.sh verify` or `npm run verify`: build, lint, and tests or an emulator suite where one exists.
- Add minimal smoke tests for the bridge (handler dispatch against a local broker) and reports (render one config read-only, like `render-signal-compare.js`).
- Goal: agents verify their own work, and feedback files report real results.

### 7. Shorter sessions with checkpoints
- One session per topic or phase. Start each from `progress.md` plus the topic's spec, not from a long chat history.
- End each session with the feedback or progress update.

## Tool choice (Devin Desktop vs Claude Code)

- Either works with the structure above. The handbook, the `AGENTS.md` files and the skills carry over almost directly (`CLAUDE.md` ⇄ `AGENTS.md`, skills ⇄ skills).
- Worth trying Claude Code only **after** items 1–5 exist, on one well-scoped cross-repo task, so the comparison is fair.
- Whichever tool is used: one orchestrator, subagents per repo, and production writes and deploys gated by Hillel.

## Next steps (when picking this up)

1. Write `docs/ops/infra.md`. Most of it can be filled from the rollout. Leave TODOs for what only Hillel knows.
2. Write `docs/data-model.md`.
3. Make the per-repo `AGENTS.md` files consistent.
4. Add the `prod-oneoff` and `cross-repo-task` skills.
5. Run the next cross-repo task (e.g. Phase 6 cleanup, or BR-1.1 / ATS-1.3) with the orchestrator + subagents model, and compare.
