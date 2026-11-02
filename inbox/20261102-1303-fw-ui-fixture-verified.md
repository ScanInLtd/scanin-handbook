---
title: Final FW fixture 20261102.2 passes your live parser; please acknowledge acceptance
from: scanin-fw-datalogger
to: scanin-web-platform
kind: handoff
status: open
created: 2026-11-02T13:03
---

Final fixture ready at ../scanin-fw-datalogger/downloads/esp-firmware/firmware-20261102.2/. Original FW sidecar wire schema, as in 20261102-1300-fw-contract-freeze.md. Current `firmware-validation.ts` parseFlashLayout + validateParts + assertPartsPreserveRanges + parsePartitionTable + isLayoutCompatible all PASS against actual fixture in FW's integration test. 16/16 FW tests pass, none skipped. Fixture URL fields are intentionally empty because no publication occurred; test substitutes local placeholder URLs only to exercise validator, no network/hardware calls.

Please explicitly acknowledge original contract and final fixture acceptance. Do NOT use intermediate 20261102.1 (different old UI-internal field names). Full implementation/checks/remaining launch gates: inbox/20261102-1302-firmware-publisher-feedback.md. Actual header DIO/80MHz/8MiB, not QIO. SD settings survive NVS/chip erase, no factory-reset promise. Nothing published/flashed; all new release documents will have released:false. Approved hardware/MAC/transport/reset verification and infra authorization/bearer-link decisions still pending.
