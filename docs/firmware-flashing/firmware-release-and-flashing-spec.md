# Datalogger Firmware: Releases & Browser Flashing

**Status:** implementation handoff; review clarifications and launch gates in §10 take precedence · **Owner:** Hillel · **Created:** 2026-11-01 · **Reviewed:** 2026-11-01
**Teams:** Datalogger FW team (`scanin-fw-datalogger`, publishing side) · UI team (`scanin-web-platform`, flashing side)
**Replaces:** `scanin-tool-esp-flasher` (WinForms app + Google Drive folder). It is retired once this ships.

---

## 1. Summary

Every firmware build becomes a **release** in the cloud. A release is the binaries in Firebase Storage plus one Firestore document with a version, title, release notes and channel.

- **FW team:** publishes a release with one command, `./dl-release`.
- **Admins:** in the monitoring web app, go to **Settings → Firmware & Flashing**. They plug a datalogger into USB, pick a release from a readable list and click **Flash**.
- **No install:** flashing runs in the browser (Chrome or Edge) through Web Serial and Espressif's official `esptool-js`. No exe, no Python, no service-account key on anyone's PC.
- **No buttons:** the board enters download mode automatically. Nobody presses BOOT or RESET, on both the new USB-JTAG boards and CP210x boards.

### Decisions already taken

| Topic | Decision |
|---|---|
| Where the flasher lives | Inside `scanin-web-platform`, as a new admin settings page. No new app. |
| Who can flash and publish | Admins only (`users/{uid}.admin == true`) |
| Prior art | Reuse the proven release format and flashing rules of `scanin-intel-pilot` (`firmware/release.sh`, `mac-tool/fw_flash.py`, `mac-tool/web/js/pages/firmware.js`): 4 parts at their own offsets, sha256 manifest, no merged image, automatic reset. See §2.1. |
| OTA | **Out of scope.** There is no working OTA mechanism today. It's planned for the future, and the firmware will be adapted to it then. USB flashing only for now. The release format is designed so OTA can reuse it later (§8). The UI never sets `released` (see §3.3). |
| Firmware registry | Reuse the existing `esp_datalogger_firmware` collection, which the bridge already reads, and extend its schema. |
| Binary storage | Firebase Storage, `firmware/datalogger/{version}/` |

---

## 2. Why: problems with the current setup

| Problem | Today |
|---|---|
| Nobody knows what a version contains | A release is just `scanin-datalogger-YYYYMMDD.N.bin` plus `build-info.txt`. There is no title or notes. |
| Distribution is fragile | The WinForms app scrapes the HTML of a public Google Drive folder to find versions. |
| Bootloader and partitions drift | Drive holds only the app binary. The bootloader and partition table are a copy from January 2026, bundled separately, while the app flasher **erases the whole chip** every time. |
| Install friction | It needs a Windows exe, a SmartScreen warning, a driver, and .NET or a 170 MB bundle. |
| UX | Small, dated UI with two "Refresh" buttons. Instructions still mention holding BOOT and pressing EN. |
| Registry unused | `esp_datalogger_firmware` exists, but holds a single test document from 2025. The build script never writes to it. |

### 2.1 Prior art: `scanin-intel-pilot` installer (copy these patterns)

The pilot datalogger (same ESP32-S3, same `esp32-s3-devkitm-1` env) already has field-tested firmware updates from its installer:

| Pattern | Where | Reuse here |
|---|---|---|
| Release = `bootloader.bin` @0x0, `partitions.bin` @0x8000, `boot_app0.bin` @0xE000, `firmware.bin` @0x10000, plus `manifest.json` (version, commit, date, chip, baud, files[name, offset, size, sha256]) | `firmware/release.sh` | `dl-release` produces the **same manifest**, and §3.2's `parts` is the same data. The UI should accept the pilot manifest as-is, so both products can share the flasher later. |
| Version string compiled into the image and checked after the build (`grep -q "$ver" firmware.bin`) | `release.sh` | `dl-release` step 4 (§4.2) |
| Version carries the commit and a `-dirty` suffix | `release.sh` | `gitCommit` / `gitDirty` fields; the UI warns on dirty builds |
| Never `erase_flash` and never a merged image on update, so NVS (setup and keys) survives | `fw_flash.py` | Update mode (§5.2) |
| **Probe before flashing:** `read_mac` gives the chip and MAC. Reading 16 bytes at 0x10000 shows whether the board is empty (all `0xFF`), has an app (`0xE9` image magic) or is unknown | `fw_flash.py: probe()` | Step 1 auto-detect (§5.2) |
| **First install over other firmware:** erase only the NVS region (0x9000, 0x5000), then write the 4 parts | `fw_flash.py: _run(erase_settings)` | "Install over other firmware" mode (§5.2) |
| Plain-language error mapping ("Failed to connect" → put in update mode; "port busy" → close other serial tools) | `fw_flash.py: _plain()` | Failure screen (§5.2) |
| Named steps ("Writing the boot loader / partition table / boot selector / firmware", "Restarting the datalogger") with one overall % weighted by part size | `fw_flash.py: _run()` | Progress view (§5.2) |
| Board reports its fw version over serial; the UI compares it to the release ("The datalogger runs X") | `firmware.js` | Future: needs a version banner or command in the monitoring firmware (§4.3) |

Difference: the pilot ships one release inside the installer (via git and installer auto-update) and flashes with Python esptool. Here, releases are many and live in the cloud, and flashing happens in the browser with `esptool-js`. The rules above don't change.

---

## 3. Architecture

```
 FW developer                     Firebase (dataloggerdev)                   Admin in browser
 ────────────                     ────────────────────────                   ─────────────────
 ./dl-release                     Storage                                     Settings → Firmware & Flashing
   build (PlatformIO)   ──────►   firmware/datalogger/{version}/              ┌ Releases tab (edit metadata)
   collect 4 images               bootloader.bin  partitions.bin              └ Flash tab
   sha256 + metadata              boot_app0.bin   firmware.bin                    │ Web Serial + esptool-js
   upload               ──────►   Firestore                                      ▼
                                  esp_datalogger_firmware/{version}  ◄──read── USB ── datalogger
                                  firmware-flash-log/{id}            ◄──write─ (audit of every flash)
```

### 3.1 Storage layout

```
firmware/datalogger/20261102.1/bootloader.bin
firmware/datalogger/20261102.1/partitions.bin
firmware/datalogger/20261102.1/boot_app0.bin
firmware/datalogger/20261102.1/firmware.bin
firmware/datalogger/20261102.1/manifest.json       (same format as scanin-intel-pilot firmware/release/manifest.json)
```

Releases are **immutable**: a version folder is never overwritten. To fix a bad build, publish a new version and withdraw the bad one.

### 3.2 Firestore: `esp_datalogger_firmware/{version}`

The document ID is the version string.

```ts
interface FirmwareRelease {
  // identity
  version: string;             // "20261102.1"  (YYYYMMDD.N, from firmware/esp32/VERSION)
  chip: "esp32s3";
  board: "esp32-s3-devkitm-1"; // PlatformIO env the build came from

  // human-facing (editable in the UI)
  title: string;               // short, one line: "Camera CS fix + SD mount retry"
  notes: string;               // Markdown release notes (what changed, what to watch)
  channel: "stable" | "beta" | "dev";
  recommended: boolean;        // at most ONE release has recommended == true
  withdrawn: boolean;          // hidden from the flash list, kept for history
  withdrawnReason?: string;

  // images to write (UI must use these offsets, never hard-code)
  parts: Array<{
    name: "bootloader" | "partitions" | "boot_app0" | "app";
    offset: number;            // 0x0, 0x8000, 0xE000, 0x10000 for the current layout
    path: string;              // Storage path
    url: string;               // download URL (with token)
    size: number;              // bytes
    sha256: string;            // hex
  }>;
  totalSize: number;

  // provenance
  gitCommit: string;           // short hash
  gitBranch: string;
  gitDirty: boolean;           // true = built from uncommitted changes (UI shows a warning badge)
  buildDate: Timestamp;
  createdAt: Timestamp;        // server timestamp at publish
  createdBy: string;           // email of the publisher
  updatedAt?: Timestamp;
  updatedBy?: string;

  // legacy fields read by scanin-svc-mqtt-bridge (OTA). Keep, do not change semantics.
  url: string;                 // = the "app" part URL
  timestamp: Timestamp;        // = createdAt
  released: false;             // OTA switch. ALWAYS false from this project (see 3.3)
}
```

### 3.3 Critical: do not trigger OTA by accident

`scanin-svc-mqtt-bridge` (`src/services/firestoreService.js → setupFirmwareListener`) listens for:

```
esp_datalogger_firmware where released == true orderBy version desc limit 1
```

It then sends that firmware's `url` to **every ESP datalogger in the fleet** on its next status message. OTA isn't a working mechanism today, but this listener is live, and we don't want any half-working update attempt on field devices. Therefore:

- `dl-release` always writes `released: false`.
- The UI **never shows, edits or writes** `released`. OTA rollout is a separate future project.
- The existing test document `001.000.003` (`released: false`) can stay. The UI hides documents without `parts`.

### 3.4 Firestore: `firmware-flash-log/{autoId}` (audit)

The UI writes one document per flash attempt:

```ts
interface FlashLogEntry {
  deviceId: string;        // MAC "AA:BB:CC:DD:EE:FF". It's the same ID the firmware uses (retrieveDeviceId()).
  version: string;
  mode: "update" | "replace" | "clean";
  boardBefore: "empty" | "present" | "unknown";   // probe result
  result: "success" | "failed" | "cancelled";
  error?: string;          // short message + last esptool lines
  chip: string;            // as reported by esptool-js, e.g. "ESP32-S3 (QFN56) rev v0.2"
  usbType: "usb-jtag" | "cp210x" | "ch340" | "other";
  durationMs: number;
  userUid: string;
  userEmail: string;
  userAgent: string;
  startedAt: Timestamp;
}
```

---

## 4. FW team: publishing (`scanin-fw-datalogger`)

### 4.1 Deliverable

Start from `scanin-intel-pilot/firmware/release.sh`. It already builds the 4 parts, checks the version and writes the manifest. Add the cloud upload and metadata on top.

A new `./dl-release` command at the repo root, with a Node script `scripts/publish-firmware.js`. `firebase-admin` is already in the root `package.json`. It replaces `./dl-version`, which can be kept as a local-only build.

### 4.2 Flow

1. **Preflight.**
   - Check that `pio` and `node` exist, and that ADC is available. Use the same identity setup as the rest of ScanIn (`CLOUDSDK_CONFIG=~/.config/gcloud-scanin`, `scanin.link@gmail.com`; see handbook AGENTS.md §8).
   - Warn, but don't block, if the git tree is dirty or the branch is not `main`. Record this as `gitDirty` and `gitBranch`.
2. **Version.** Bump `firmware/esp32/VERSION` and regenerate `src/version.h`, using the same logic as `dl-version`.
3. **Build.** Run `pio run -e esp32-s3-devkitm-1`. Then check that the version string is inside `firmware.bin` (`grep -q "$ver"`), as the pilot's `release.sh` does. A mismatch aborts.
4. **Collect images:**

   | part | source | offset |
   |---|---|---|
   | bootloader | `.pio/build/esp32-s3-devkitm-1/bootloader.bin` | `0x0` |
   | partitions | `.pio/build/esp32-s3-devkitm-1/partitions.bin` | `0x8000` |
   | boot_app0 | `~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin` | `0xE000` |
   | app | `.pio/build/esp32-s3-devkitm-1/firmware.bin` | `0x10000` |

   - Take the offsets from what PlatformIO actually uses (`pio run -t upload -v` prints them; the source is `FLASH_EXTRA_IMAGES` in the build env). Don't trust this table blindly.
   - If the project ever gets a custom `partitions.csv`, the offsets must come from it.
5. **Metadata prompt.** This can also be passed as flags (`--title`, `--channel`, `--notes-file`, `--yes`) for non-interactive use.
   - **Title:** required, one line.
   - **Channel:** `stable`, `beta` or `dev`. Default `dev`.
   - **Notes:** open `$EDITOR`, pre-filled with `git log --oneline <previous release gitCommit>..HEAD -- firmware/esp32`. Lines starting with `#` are stripped.
   - **Recommended?** Only allowed for `stable`. If yes, the script clears `recommended` on all other releases in the same batch.
6. **Summary and confirm.** Print version, title, channel, part sizes and sha256, then ask "Publish to dataloggerdev? (y/N)".
7. **Upload.**
   - Use `contentType: application/octet-stream` and set `metadata.firebaseStorageDownloadTokens` to a fresh UUID, so the download `url` works (this is how the bridge OTA URLs work today).
   - Upload `manifest.json` too (pilot format, §2.1).
   - **Fail if the version folder or document already exists.** Never overwrite.
8. **Write the Firestore document** per §3.2, with `released: false` and server timestamps.
9. **Local copy and git.**
   - Still copy the files into `downloads/esp-firmware/firmware-{version}/` for offline use.
   - Commit `VERSION` and `version.h` with message `Release firmware {version}: {title}`, and tag `fw-{version}`. Ask before pushing.

### 4.3 Notes for the FW team

- **`VERSION` drift.** `firmware/esp32/VERSION` currently says `20260324.1`, but `20260716.1` exists in `downloads/` and on Drive. The VERSION bump wasn't committed after that build. `dl-release` must commit it (step 9).
- **Version sorting.** `YYYYMMDD.N` sorts wrongly as a string once N ≥ 10 (`.10` < `.9`). The UI sorts by `createdAt`. Either keep N ≤ 9 per day, or switch to a zero-padded `YYYYMMDD.NN`. The bridge sorts by `version` string, which matters only for future OTA.
- **First real release.** Once `dl-release` works, publish the current production firmware with channel `stable` and `recommended: true`, so the flasher has something useful from day one. Optionally backfill the last 2–3 versions from Drive as `beta` with titles written after the fact. That needs their bootloader and partition files too, so rebuild them from their commits or skip the backfill.
- **Boot log banner.** The first serial lines after boot should print `ScanIn datalogger fw {version} id {MAC}`. The flasher's boot-log view highlights that line as confirmation. If this already exists, document the exact format for the UI team.

### 4.4 Done when

- `./dl-release` publishes a new version end-to-end: Storage files, Firestore document, git tag.
- Re-running with the same version fails cleanly.
- `released` is `false` on every document written.
- The current production firmware is published as `stable` + `recommended`.
- The `README` explains how to publish, in 10 lines or fewer.

---

## 5. UI team: Firmware & Flashing page (`scanin-web-platform`)

### 5.1 Placement

- **Settings card:**
  ```ts
  { index: 22, icon: 'system_update_alt', title: 'Firmware & Flashing',
    description: 'Flash dataloggers over USB and manage firmware releases', adminOnly: true, featured: true }
  ```
- **Route:** `settings/firmware`. Register it in `app-routing.module.ts` and `settings.component.ts` (route ↔ index mapping), like `system-monitoring`.
- **Folder:** `src/app/settings/firmware/`.
- **Components:**
  - `firmware.component` (tab host)
  - `flash-device/`
  - `firmware-releases/`
  - `release-edit-dialog/`
- **Services:**
  - `firmware-release.service.ts` (Firestore + Storage)
  - `esp-flasher.service.ts` (wraps esptool-js)
- **Two tabs:** **Flash device** (default) and **Releases**.

### 5.2 Flash device tab: UX

A guided, single-column flow with three steps. Use generous spacing, large touch targets, and Angular Material cards and steppers consistent with the rest of settings.

**Step 1: Connect**
- A large "Connect datalogger" button opens the browser's serial port picker, filtered to ESP-relevant USB chips (§5.4).
- After connecting, show a device card:
  - chip (e.g. "ESP32-S3")
  - **Device ID** (the MAC, which is the datalogger's ScanIn ID), with a copy button
  - USB type badge: "USB-JTAG (built-in)" or "CP210x"
  - flash size
  - **What's on the board** (probe, as in the pilot's `fw_flash.py: probe()`: read 16 bytes at 0x10000):
    - "Empty": all `0xFF`
    - "Has firmware": first byte `0xE9`
    - "Unknown"
  - a link: **Open in ESP Dataloggers →** `/settings/esp-dataloggers?deviceId={MAC}` (the query param is already supported)
- **Not an ESP32-S3:** stop with "This is not a datalogger board (chip: X)".
- **No port in the picker:** an inline help panel:
  > **Datalogger not listed?**
  > 1. Use a data USB cable (some cables are charge-only).
  > 2. Boards with a **CP210x** USB chip need the Silicon Labs driver once: https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers?tab=downloads (Windows: "CP210x Universal Windows Driver"). Unplug and replug after installing.
  > 3. Boards with the built-in **USB-JTAG** port need no driver.
  > 4. Close other programs using the port (Arduino IDE, PlatformIO monitor, PuTTY).
- **Unsupported browser** (`!('serial' in navigator)`): replace the step with a clear notice: "Flashing needs Chrome or Edge on a computer."

**Step 2: Choose firmware**
- Show releases as **cards**, newest first.
- **The recommended release is pinned on top and pre-selected.**
- Each card shows:
  - **version** (monospace)
  - **title** (prominent)
  - channel chip (stable green, beta amber, dev grey)
  - "Recommended" badge
  - relative date with the exact date on hover
  - published by
  - a `gitDirty` warning badge when relevant
- **Notes:** collapsed to 2 lines, expandable, rendered as Markdown. Sanitize the HTML: Angular's `[innerHTML]` sanitizes, but use a small markdown lib with HTML disabled.
- **Filter:** "Show beta & dev" toggle, off by default. Withdrawn releases are never listed here.
- **Mode selector** (segmented control). The default is picked from the probe result:

  | Mode | Writes | Default when | Text |
  |---|---|---|---|
  | **Update** | 4 parts, nothing erased | the board has firmware | "Installs the firmware. Keeps the device's settings stored on the chip." |
  | **Install over other firmware** | erase NVS region only (offset/size from the partition table; 0x9000 / 0x5000 today), then 4 parts | (offered as an option; the pilot uses it for foreign firmware) | "Replaces the firmware and clears its old settings." |
  | **Clean install** | erase the whole chip, then 4 parts | the board is empty | "Erases the whole chip first. Use for new boards or when a device misbehaves." Needs a confirm dialog unless the board is empty. |

**Step 3: Flash**
- **Primary button:** "Flash {version} to {MAC}".
- **Progress view** with named stages and one overall progress bar, weighted by part size (as in the pilot):
  `Putting the datalogger into update mode → Downloading firmware → Checking files → (Clearing settings / Erasing chip) → Writing the boot loader / partition table / boot selector / firmware → Verifying → Restarting the datalogger`
- **Success screen:** check icon, "Datalogger {MAC} is running {version}", and buttons:
  - **Show boot log**: an embedded serial monitor at 115200 for about 30 s, auto-scrolling, with a copy button. It highlights the fw banner line (§4.3).
  - **Flash another device**: resets to Step 1.
- **Failure screen:** a human message, plus an expandable "Technical details" box with the last 50 esptool lines and a "Copy details" button. Map raw errors to plain language, as in the pilot's `_plain()`:
  - "Failed to connect", "No serial data received", "Wrong boot mode": "Could not put the datalogger into update mode."
  - "port is busy", "Access is denied", "Failed to open": "The port is busy. Close other serial tools (serial monitor, Arduino, PuTTY) and try again."
  - sha256 mismatch: "The downloaded firmware is damaged. Try again."
  - device lost mid-write: "The cable was disconnected. Reconnect and flash again. The board may not boot until you do."
  - **Automatic reset failed:** only then show the fallback "Hold BOOT, tap RESET, release BOOT, then Retry".
- **Logging:** write a `firmware-flash-log` document (§3.4) on success, failure and cancel.

**Page-level rules**
- Warn on `beforeunload` while flashing ("Leaving will interrupt flashing").
- Only one flash at a time. Disable navigation inside settings during the write.
- Always close the serial port on finish, error, or component destroy.

### 5.3 Releases tab: UX

- **Table:**
  - version
  - title
  - channel
  - recommended (star)
  - status (Active or Withdrawn)
  - created (date, by)
  - git commit, linked to `https://github.com/ScanInLtd/scanin-fw-datalogger/commit/{gitCommit}`
  - size
- **Row actions:**
  - **Edit**: a dialog for title, notes (Markdown editor with preview), channel.
  - **Set as recommended**: a batched write that clears the flag on all others.
  - **Withdraw / Restore**, with a reason when withdrawing.
  - **Copy download links**.
- **The UI does not create releases or upload binaries.** Publishing is `dl-release`'s job, which guarantees every release is built and recorded the same way.
- **Empty state:** "No releases yet. Publish one from scanin-fw-datalogger with ./dl-release".
- Every edit sets `updatedAt` and `updatedBy`. The UI never writes `released`, `parts`, `version`, `url`, or the git fields.

### 5.4 Technical notes

**esptool-js inside Angular 9**

The app runs Angular 9 with webpack 4 and TypeScript 3.8. Modern ESM packages using `?.` and `??` may fail to build when imported from `node_modules`. Recommended approach:

1. Pin a specific `esptool-js` release. Use one that is at least a few weeks old, and record the version in the service.
2. Vendor its prebuilt ESM bundle into `src/assets/vendor/esptool-js/bundle.js`.
3. Load it at runtime, only on this page:
   ```ts
   const esptool = await import(/* webpackIgnore: true */ '/assets/vendor/esptool-js/bundle.js');
   const { ESPLoader, Transport } = esptool;
   ```
4. Declare minimal local typings in `esp-flasher.service.ts`. Type `navigator.serial` as `any`.

If a plain `npm install esptool-js` plus a normal import builds cleanly, that is fine too. Verify with `ng build --prod` on Node 12.

**Flash sequence** (pseudo-code; check the exact API of the pinned esptool-js version, e.g. binary string vs `Uint8Array`):

```ts
const port = await navigator.serial.requestPort({ filters: [
  { usbVendorId: 0x303A },  // Espressif native USB-JTAG/Serial (new boards)
  { usbVendorId: 0x10C4 },  // Silicon Labs CP210x
  { usbVendorId: 0x1A86 },  // WCH CH340/CH9102
]});
const transport = new Transport(port, true);
const loader = new ESPLoader({ transport, baudrate: 921600, terminal });   // terminal → our log buffer
const chipName = await loader.main();          // auto reset into download mode (DTR/RTS or USB-JTAG sequence)
const mac = await loader.chip.readMac(loader); // = datalogger deviceId

// parts: downloaded via release.parts[].url, sha256 verified with crypto.subtle BEFORE flashing
await loader.writeFlash({
  fileArray: release.parts.map(p => ({ data: p.data, address: p.offset })),
  flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep',
  eraseAll: mode === 'clean',
  compress: true,
  reportProgress: (fileIndex, written, total) => { /* map to overall % */ },
  calculateMD5Hash: (image) => md5(image),     // enables on-device verify
});
await loader.after('hard_reset');              // reboot into the new firmware
await transport.disconnect();
```

**Why all four parts in Update mode too**
- **`partitions`** keeps the table consistent with the app.
- **`boot_app0` at 0xE000** resets `otadata`. Without it, a device that once took an OTA update keeps booting the **other** app slot (app1), and the freshly written app0 is silently ignored.
- **NVS** (0x9000–0xDFFF) and the data partitions are not touched in Update mode. "Install over other firmware" erases NVS only. Clean install erases everything on the chip. The SD card is never affected.
- **Never a merged image.** It would pad the gap over NVS and wipe the settings. The pilot learned this the hard way.

**Probe with esptool-js** (equivalent of the pilot's `probe()`): after `loader.main()`, call `loader.readFlash(0x10000, 16)`. Check the API name in the pinned version. All `0xFF` means empty; first byte `0xE9` means an app is present.

**Downloading binaries**
- Fetch `parts[].url` with `fetch()` and read the result as `ArrayBuffer`.
- Verify `sha256` with `crypto.subtle.digest('SHA-256', …)`. Abort with a clear error on mismatch.
- **CORS:** browser fetches of Storage download URLs require a CORS config on the bucket. This is a one-time setup (§6.3).

**Other**
- Web Serial requires a secure context. HTTPS production hosting and `http://localhost:4200` both qualify.
- Mobile browsers are not supported. Hide the Flash tab content on mobile and show the notice.

### 5.5 Done when

- An admin on Windows (Chrome/Edge) can connect a CP210x board and a USB-JTAG board, see the device ID, pick the recommended release, flash in Update mode, and see the boot log, without pressing any board buttons.
- The probe shows Empty / Has firmware correctly and picks the default mode.
- Clean install works and asks for confirmation. A board flashed with "Install over other firmware" boots with fresh settings.
- A hash mismatch, an unplugged cable mid-flash and a cancel each produce a clear message and a `firmware-flash-log` entry.
- The Releases tab edits title, notes, channel, recommended and withdrawn. It never writes `released`.
- Non-admins can't see the card. A direct URL is blocked for non-admins.
- `ng build --prod` passes on Node 12.

---

## 6. Security, rules and one-time setup

### 6.1 Firestore rules

**Which file is deployed:** both `scanin-web-platform/firestore.rules` and `scanin-svc-firebase-functions/firestore.rules` declare Firestore rules in their `firebase.json`. Confirm which one is the deployed source of truth before editing, and keep them in sync.

Add:

```
match /esp_datalogger_firmware/{version} {
  allow read: if request.auth != null;
  allow write: if isAdmin();
}
match /firmware-flash-log/{id} {
  allow read: if isAdmin();
  allow create: if isAdmin();
  allow update, delete: if false;
}
```

The catch-all `match /{document=**} { allow read, write: if request.auth != null; }` still grants any signed-in user write access until it is narrowed (a known follow-up already noted in the rules file). The UI guard (admin-only card) is the effective protection meanwhile.

### 6.2 Storage rules (`scanin-web-platform/storage.rules`)

Add, above the default-deny block:

```
match /firmware/{allPaths=**} {
  allow read: if request.auth != null;
  allow write: if false;     // only dl-release (Admin SDK) writes
}
```

Tokenized download URLs keep working for the bridge regardless of rules.

### 6.3 Storage CORS (one time, infra; Hillel or an agent with approval)

Check the current config first: `gsutil cors get gs://dataloggerdev.appspot.com`. Then merge, so existing entries aren't dropped:

```json
[{ "origin": ["https://<production UI domain(s)>", "http://localhost:4200"],
   "method": ["GET"], "responseHeader": ["Content-Type"], "maxAgeSeconds": 3600 }]
```

### 6.4 Secrets

- No keys ship anywhere.
- `dl-release` uses the developer's ADC.
- The browser uses the signed-in admin's Firebase Auth session.

---

## 7. Rollout

| # | Step | Owner |
|---|---|---|
| 1 | Rules (§6.1, §6.2) and CORS (§6.3) | Hillel / infra |
| 2 | `dl-release` + first `stable` release | FW team |
| 3 | Firmware & Flashing page behind the admin card | UI team |
| 4 | Test on Windows: one CP210x board, one USB-JTAG board, Update + Clean | Hillel + Lidor |
| 5 | Make Lidor and Nathan admins (approved), send them the page link | Hillel |
| 6 | Archive `scanin-tool-esp-flasher`, delete GitHub release v2.0.0, keep the Drive folder read-only for history | Hillel |

## 8. Out of scope (later)

- **OTA (future).** No working OTA exists today. The bridge has a listener and a `downlink/firmware` message, but the firmware doesn't act on it reliably. When OTA is built, the firmware will be adapted to it, and it should reuse this release registry:
  - the `app` part (plus `sha256`, `size`) is exactly what an OTA client downloads into the inactive slot
  - add targeting fields then (e.g. `rollout: { channel, siteIds[], deviceIds[], percent }`) instead of the single global `released` flag
  - add a "Roll out via OTA" action on the Releases page
  - change the bridge to pick per-device targets, not "newest released"
  - devices report `firmwareVersion` in status already, so the Releases page can show "N devices on this version"
- Until then, `released` stays `false` (§3.3), because the bridge listener still exists.
- **Hardware variants:** a `board`/`hwRevision` filter if a second hardware variant appears.
- **Non-admin "technician" role:** a role that can flash but not edit releases.
- **Reading the current firmware version from a connected device before flashing:** needs a serial command in the firmware.

## 9. Open questions

1. ~~Admin accounts for Lidor and Nathan~~: **resolved.** Both become admins.
2. **Firestore rules:** which repo's rules file is the deployed one (§6.1)?
3. **Shared flasher with the pilot:** should the pilot installer later flash from this same cloud registry (e.g. a `product: "datalogger" | "pilot"` field), or keep shipping its release inside the installer? This doesn't block v1.
4. **Settings storage on the chip:** does any device setting live in NVS? Update mode preserves it only with a compatible partition layout (§10.2), but Clean install wipes it. The FW team should confirm what a device loses on Clean install, so the UI text is accurate.

## 10. Implementation review — clarifications and launch gates (2026-11-01)

**This section overrides conflicting instructions above.** The two-team architecture, separate flash images, cloud registry, and USB-only scope stay unchanged. These refinements close safety and coordination gaps; they do not authorize production writes, deployments, hardware flashing, account changes, or retirement of the old tool.

### 10.1 Enforce the boundary; a hidden settings card is not authorization

- §6.1's example is insufficient. The local web rules contain both an authenticated catch-all and self-profile create/update rules that do not protect `admin`. A non-admin must not be able to bypass firmware restrictions through either path. Confirm the deployed rules independently; local files do not prove production state.
- Infra/security owns the rules plan, in coordination with the web and functions repositories. At minimum, exclude `esp_datalogger_firmware`, `firmware-release-settings`, `firmware-flash-log`, and `users` from any permissive fallback, protect admin/role fields on profile creation and update, and examine overlapping matches. Preserve unrelated client flows; coordinate with the existing catch-all hardening task rather than silently doing a platform-wide rewrite.
- Firmware registry and recommendation reads are admin-only. Browser release creation/deletion is forbidden. Metadata updates allow only `title`, `notes`, `channel`, `withdrawn`, `withdrawnReason`, `updatedAt`, and `updatedBy`, with types, length limits, caller identity, and server timestamp validation. All build identity, binaries, provenance, and legacy OTA fields are immutable to browser clients, including for admins. `released` cannot be changed by this feature.
- Admin SDK publishing bypasses Firebase rules: ADC availability alone is not an admin check. The publisher must explicitly pin project and bucket, verify its active principal against the approved publishing identity, and fail closed when identity cannot be verified. Do not infer the ADC principal from `gcloud auth list` alone. Infra must document the actual IAM permissions/identity; `users/{uid}.admin` does not authorize ADC.
- Tokenized URLs are bearer links: anyone possessing one can download, regardless of Auth or Storage rules. Keeping them is acceptable only with Hillel's explicit acceptance of that distribution model. Otherwise use authenticated Storage downloads for USB flashing and revisit the legacy `url` contract separately; do not invent a working OTA requirement.
- Launch gate: emulator tests demonstrate denied unauthenticated/non-admin access, denied self-promotion, immutable build/OTA fields, allowed admin metadata edits, and audit lifecycle constraints. Deploy rules only after Hillel approves the tested plan.

### 10.2 Partition compatibility and destructive modes

- An ESP image magic byte proves only that an image is present, not that it is ScanIn firmware, uses the same partition layout, or is safe to update. All-`0xFF` at the app offset means **no image at that offset**, not that the entire flash is empty. Do not automatically choose a destructive mode from that probe.
- FW must publish an additional versioned `flash-layout.json`, with its Storage path, size, and SHA-256 referenced by a new `flashLayout` field on the release. It describes flash capacity requirements, partition-table location, parsed partition entries (name/type/subtype/offset/size), app slot, and exact permitted NVS erase ranges. Keep the pilot-format `manifest.json` unchanged; the sidecar is the datalogger-specific safety contract.
- Before erasing or writing, UI verifies all downloaded sizes and SHA-256 values, validates the manifest/sidecar mapping to `parts`, and checks chip, flash capacity, integer/aligned offsets, unique expected parts, non-overlap, partition bounds, and that no image write overlaps preserved settings/data. Reject malformed metadata, not just corrupt downloads.
- Read and parse the installed partition table before offering Update. Enable it only for a known compatible layout that preserves existing settings/data ranges; otherwise explain the incompatibility and require explicit replacement/clean-install selection. An unreadable or unknown board must never silently default to erasure. Legacy registry documents without the sidecar are not flashable in v1.
- Every NVS erase and every whole-chip erase requires a destructive-action confirmation, even when the app probe reports no image. State exactly what is lost. Derive erase ranges from the validated release layout and account for old-layout settings; fail closed on ambiguity rather than erasing a hard-coded `0x9000/0x5000` range.
- Writing four parts does erase the sectors occupied by those parts; say **no whole-chip erase / preserves compatible settings partitions**, not "nothing erased". FW must verify `boot_app0`/otadata behavior for this actual build. Check for secure-boot/flash-encryption restrictions where supported by the pinned tool and stop on unsupported secured devices; do not change eFuses.

### 10.3 Publish immutable artifacts without pretending Storage and Firestore are atomic

- Obtain PlatformIO flash metadata using a build-only introspection/export step. **Do not run `pio run -t upload -v` to discover offsets**: that target may flash connected hardware. Resolve `boot_app0.bin` from the actual build framework package, not an assumed global install path.
- Update both generated headers: `firmware/esp32/src/version.h` **and** `firmware/esp32/src/App/Common/version.h`; `dl-version` currently writes both. Verify the embedded version and identical headers before publication.
- Capture full source commit, branch, and dirty state before generated version edits; distinguish script-generated changes from pre-existing source dirtiness. Do not accidentally report every release as dirty merely because VERSION was bumped. A dirty build must not silently become the recommended production release. Include all generated version files in the release commit, never unrelated staged changes. Record the source commit separately from the subsequent release/tag commit.
- Reserve uniqueness with per-object create-only generation preconditions and Firestore document `create`, not existence-check-then-overwrite. Upload and verify all artifacts first; create the discoverable release document last. Never publish a document referring to incomplete files.
- On upload, Firestore, commit, or tag failure, report exactly which phases completed and the immutable artifact identifiers. A partial prefix blocks ordinary reuse; provide a documented verification/resume procedure for identical artifacts, or use a new version. Never automatically delete existing cloud objects or overwrite them to recover. A git/tag failure after publication must not cause a second publication or silently change provenance.
- Keep `YYYYMMDD.N` for compatibility; sort by `createdAt` with a deterministic version tie-breaker. No artificial nine-build daily limit. Future OTA must use a numeric/date ordering contract, not lexicographic version comparison.
- Implement dry-run/local validation and failure-injection tests first. First stable publication is an explicit human-approved operation after a hardware smoke test; do not publish automatically as part of coding. Rebuilding an old commit creates a newly built artifact, not proof of binary equivalence to an old production image.

### 10.4 One authoritative recommendation, including under concurrency

- Replace the "clear all flags in a batch" mechanism with one authoritative document: `firmware-release-settings/datalogger` containing `recommendedVersion: string | null`, `updatedAt`, and `updatedBy`.
- UI and publisher update that pointer transactionally after reading the target release. Only stable, non-withdrawn releases qualify. Withdrawal or demotion of the currently recommended release must clear the pointer in the same transaction; rules validate the post-write state with `getAfter`.
- `FirmwareRelease.recommended` is deprecated, not authoritative, and is not browser-editable. The flasher derives the badge/preselection from the pointer. If it points to a missing or ineligible release, show no recommendation and report the inconsistency; never preselect an unsafe fallback. This avoids scans, batch-size limits, and two admins leaving two recommended flags.
- Re-fetch release eligibility immediately before any destructive command. If withdrawal or metadata availability changes before writing starts, abort; after writing begins, do not intentionally abandon a partially written board merely because a listener changed.

### 10.5 Honest device identity, boot confirmation, and audit lifecycle

- The actual monitoring firmware's `SystemManager::retrieveDeviceId()` uses the Wi-Fi station MAC (`WiFi.macAddress`). Validate that the pinned esptool chip API returns that same MAC, with uppercase colon-separated formatting, on both board types. Do not assume a USB serial number, Bluetooth MAC, or arbitrary base MAC is the ScanIn ID.
- Automatic entry/reset is a tested goal, not a universal property of CP210x/CH340 adapters: it depends on board wiring and tool support. Prove the exact sequence on the actual monitoring boards. Retain a manual fallback, and do not infer capability solely from VID/PID. Hardware test failures are a release blocker for the no-buttons promise.
- Begin capture around reset, before the earliest boot banner can be lost. Show "Firmware written and verified; boot not confirmed" until the expected version **and station MAC** banner is observed. Only then say "running {version}". Timeout/re-enumeration must not masquerade as confirmed success or necessarily as failed writing. FW owns the exact banner format; UI owns parsing and timeout behavior.
- Revise §3.4: create a log with `result: "started"` before the first erase/write. Add `finishedAt`, `bootVerification: "confirmed" | "unconfirmed" | "not-attempted"`, and optional `observedVersion`; permit `result` to transition once to `success`, `failed`, or `cancelled`. Define `success` as verified writing, separately from boot confirmation. Device identity/chip may be absent for cancellation before a successful probe; never fabricate a MAC.
- Rules allow only the creating admin to finalize an in-progress attempt once, with immutable caller/device/release/start fields, bounded errors, and a server completion timestamp. Deny deletion and later edits. This supersedes the create-only audit rule in §6.1. Interrupted tabs can leave `started` records; report these as incomplete attempts, not proven successes. Browser audit is best-effort evidence, not tamper-proof attestation of physical flashing.
- If initial logging fails, block destructive work and allow retry. If finalization fails after flashing, preserve the truthful flash result, show "audit not saved", and offer retry without reflashing. Do not persist raw serial output that could contain credentials; redact technical details before saving/copying, and never log bearer download tokens.
- Define cancellation by phase: before writing, release the port and log cancellation where identity is available; during erase/write, request a safe stop supported by the pinned library and warn that recovery flashing may be required. Always release locks/streams/transport; allow the boot monitor to reacquire the port explicitly after flashing cleanup.

### 10.6 Ownership and rollout gates

- **FW:** publisher, build/layout artifacts, identity/settings-loss confirmation, banner, local tests. Share a local release fixture (including sidecar) with UI before either side finalizes its implementation.
- **UI:** Angular compatibility spike first, release/settings contract, guided flashing and logging, mocked failure tests, build verification. Own application changes only; coordinate rule requirements with infra.
- **Infra/security (Hillel coordinating web + functions):** deployed-rules source-of-truth investigation, synchronized rules/tests, publishing IAM, bearer-link decision, actual bucket/CORS origins and approval plan. Include the configured local ScanIn origin (`http://localhost:3020`) as needed, not only Angular's default port. Inspect and merge existing CORS entries; never replace them blindly.
- No changes to the pilot, MQTT bridge, or the legacy flasher are required for v1. All new release documents remain `released: false`; no fleet-wide update path is enabled.
- Production publication, rules/CORS deployment, admin grants, and hardware tests are separately approved steps. Keep the old installer usable until both board types pass Update, replacement, clean install, unplug/retry, settings preservation/loss, and boot verification tests. Archive/retire only after sign-off; deleting GitHub releases is not required and needs separate explicit approval.

