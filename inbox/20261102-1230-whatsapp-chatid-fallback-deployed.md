---
title: WhatsApp chatId fallback DEPLOYED — plus forced nodejs22 runtime + chartjs-node-canvas upgrades
from: scanin-svc-firebase-functions
to: scanin-handbook
kind: feedback
status: done
created: 2026-11-02T12:30
---

## Deployed (user approved)

Commits pushed to `master`; all three affected functions updated in production
(project `dataloggerdev`, verified ACTIVE + scheduled runs clean post-deploy):

| Function | Revision | Notes |
|---|---|---|
| `handleAlerts` | nodejs22 | chatId fallback + lastError flagging live |
| `sendWhatsappAlerts` | `sendwhatsappalerts-00004-nan`, nodejs22 | scheduler job updated; ticks clean |
| `evaluateMultiSensorRules` | nodejs22 | same resolver, legacy fields |

Commits: `581a97a` (the fix), `eff248c` (runtime), `b5661a3` (dep bump).

## Two forced infra upgrades along the way — affects ALL functions repos

1. **`nodejs20` runtime decommissioned 2026-10-30.** First deploy attempt was
   rejected outright ("must first upgrade your runtime version"). Pinned
   `firebase.json runtime: nodejs22`, `package.json engines: "22"`, `DEPLOY.sh`
   nvm 20→22. Any other function in this repo (or any sibling repo still on
   nodejs20 — check `scanin-svc-watchdog`, `scanin-worker-prism-daily`,
   `scanin-tool-data-replay`, reports service) will hit the same wall on its
   next deploy. Handbook `AGENTS.md` §6 updated accordingly.
2. **`chartjs-node-canvas` 4.1.6 → 5.0.0** — v4 nested `canvas@2.11.2`, which
   has no node22 (ABI v127) prebuild and can't compile in the Cloud Functions
   build image (no pangocairo), failing `npm install` for EVERY function
   deploy. v5 dedupes to `canvas@3.2.1` (prebuilds). Only usage is
   `ChartJSNodeCanvas` + `renderToBuffer` in `vibrationReports/helpers.ts` —
   API-identical, peer `chart.js ^4.4.8` already satisfied. Vibration report
   functions are still on nodejs20 (not redeployed) but will need the same
   treatment — already in this commit, so a plain redeploy suffices.

## Watch items

- The 4 whatsapp-enabled users with no recipient (`refael eng`,
  `ברוך עיר דוד`, `jtcs control`, `בקרה תחנת רכבת ירושלים מרכז`) will start
  accumulating `notifications.whatsapp.lastError` — that's the intended
  visibility, not a new problem.
- First real alert through `handleAlerts` will exercise the fallback; if a
  send 422s permanently, check `users/{id}.notifications.whatsapp.lastError`.
