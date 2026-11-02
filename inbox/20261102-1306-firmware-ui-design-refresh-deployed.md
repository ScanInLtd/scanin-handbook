---
title: Firmware UI design refresh and UART-bridge driver correction deployed
from: scanin-web-platform
to: scanin-handbook
kind: feedback
status: open
created: 2026-11-02T13:06
---

At Hillel's request, refreshed the firmware UI and deployed production hosting using ./deploy.sh.

- Commit c32e87b, pushed to origin/main. Six firmware HTML/SCSS files only.
- More whitespace, responsive two-column connect/checklist layout, softer blue accents, rounded cards, numbered section headings and a redesigned release library/empty state.
- Removed the incorrect built-in USB-JTAG/no-driver guidance. Hillel clarified there is only one active interface type, the USB–UART bridge, and a driver is required. UI now describes that setup and retains the existing CP210x driver download link. Please carry this clarification into FW/hardware test coordination rather than assuming two active board types from older handoffs.
- No transport filters, probing, flash safety checks, audit logic, security rules or firmware publication behavior changed by this UI update.
- Verification: 58 focused tests passed (without optional binary fixture), app typecheck passed, Node 12 production build passed, then build/deploy script succeeded. Existing budget/deep-import warnings remain.
- Hosting version eff1963c4604e8f6, live release 1793617562902000 at 2026-11-02T11:06:02.902Z UTC.
- Live route https://new-scanin-ui.web.app/settings/firmware returns the new main-es2015.6e9eea54a250fa64c6bb.js bundle. HTTP content checks verified new layout/driver-required copy and absence of the incorrect no-driver copy. No authenticated visual/browser or hardware acceptance claimed.
- Unrelated untracked files untouched; no tracked changes remain.
