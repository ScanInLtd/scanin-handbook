---
title: Compact firmware picker, startup feedback and reversible archiving deployed
from: scanin-web-platform
to: scanin-handbook
kind: feedback
status: open
created: 2026-11-02T17:17
---

Completed Hillel's requested firmware UX changes and production hosting deployment.

- Commit `d7d6764`, pushed to origin/main. Eight firmware UI/test files only; unrelated untracked work untouched.
- Flashing page now uses an Angular Material version dropdown instead of one large card per release. Stable filtering and recommended-first ordering remain; beta/dev toggle is retained. Only the selected version summary is shown, with expandable, height-bounded release notes. Device details are collapsed by default. Install controls now sit beside the mode controls rather than below a long version list.
- Preparation, writing and startup verification now use a focused operation panel, automatically scrolled into view with keyboard focus. During startup capture, the UI explicitly says firmware has already been written and verified, explains the version/MAC confirmation and 30-second capture window, and shows an activity bar plus real elapsed seconds rather than a misleading completed percentage. Result panel is also brought into view. Boot success still requires the expected version AND MAC; timeout/error remains written/verified but boot unconfirmed. Timer cleanup is covered.
- Releases tab now includes Archive in the actions menu. It asks for confirmation, hides the version from the default library and flash picker, preserves artifacts/history, and clears a recommendation transactionally when applicable. Enable “Show archived & withdrawn” to inspect old versions and Restore to make them available again.
- Archive deliberately reuses the existing `setWithdrawn` transaction with `withdrawn:true` and `withdrawnReason:'Archived: deprecated release'`. The UI displays this prefix as Archived, while other withdrawal reasons remain Withdrawn. No new schema fields/rules/IAM changes or binary deletion. Existing Withdraw action remains available. No production versions were archived/restored by this session; those are administrator actions in the deployed UI.

Verification: **71 focused tests including the read-only final FW fixture passed**, app and focused spec typechecks passed, Node 12 production build passed inside ./deploy.sh (existing budget/deep-import warnings only). New tests cover long-list filtering/selection, stale selection downloads, default mode after connection, focus/scroll, startup timing/error cleanup, archive visibility/confirmation/cancellation and restoration. No new physical flashing or authenticated browser acceptance claimed.

Deployment: Firebase Hosting `new-scanin-ui`, production project `dataloggerdev`, account `scanin.link@gmail.com`, hosting version `90ccedd2683f9011`, live release `1793632650803000`, UTC release time `2026-11-02T15:17:30.803Z`.

Live route https://new-scanin-ui.web.app/settings/firmware and main-es2015.58ffe1a822a49427360e.js return successfully. HTTP content checks verified the picker, startup explanation and archive controls in the live bundle.

Hillel separately raised a possible future sleep-only shipping firmware. Explained that erasing the application does not guarantee low power and neither approach clears SD settings. No erase-only action or shipping firmware was added; that requires a separate FW task to define wake/recovery and verify actual board power consumption.
