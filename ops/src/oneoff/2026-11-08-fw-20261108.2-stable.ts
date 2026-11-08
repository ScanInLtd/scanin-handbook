/**
 * Promote datalogger firmware 20261108.2 (dev) to stable + recommended.
 * Smoke-tested by Hillel on 2026-11-08 on analog_tilt unit 68:EE:8F:52:62:D8:
 * flashed from the web UI, device setup (type/site/Wi-Fi) over USB,
 * restart-sync uploaded samples that provisioned sensors on the new site.
 *
 * Same binary that was tested — only release metadata changes:
 *   esp_datalogger_firmware/20261108.2: channel dev → stable
 *   firmware-release-settings/datalogger.recommendedVersion: 20261105.1 → 20261108.2
 * Mirrors what the firmware Releases UI does (metadata update + pointer, one transaction).
 *
 * Usage: ./go.sh run src/oneoff/2026-11-08-fw-20261108.2-stable.ts [--apply]
 * Undo: recommendedVersion back to 20261105.1; channel back to dev.
 */
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { confirmApply, parseArgs, run } from "../lib/cli";

const VERSION = "20261108.2";
const PREVIOUS = "20261105.1";
const BY = "scanin.link@gmail.com";

run(async () => {
  const args = parseArgs();
  const relRef = db.doc(`esp_datalogger_firmware/${VERSION}`);
  const setRef = db.doc("firmware-release-settings/datalogger");
  const [rel, set] = await Promise.all([relRef.get(), setRef.get()]);
  const r = rel.data();
  if (!r) throw new Error(`release ${VERSION} missing`);
  if (r.withdrawn) throw new Error(`release ${VERSION} is withdrawn`);
  if (r.gitDirty) throw new Error(`release ${VERSION} is a dirty build — not eligible for stable`);
  const current = set.data()?.recommendedVersion;
  console.log(`release ${VERSION}: channel ${r.channel} → stable  (commit ${r.gitCommit}, dirty=${r.gitDirty})`);
  console.log(`recommendedVersion: ${current} → ${VERSION}`);
  if (current !== PREVIOUS) console.log(`  note: pointer was ${current}, expected ${PREVIOUS}`);

  if (!(await confirmApply(args, `promote ${VERSION} to stable and make it recommended`))) return;
  await db.runTransaction(async (tx) => {
    tx.update(relRef, { channel: "stable", updatedAt: FieldValue.serverTimestamp(), updatedBy: BY });
    tx.set(setRef, { recommendedVersion: VERSION, updatedAt: FieldValue.serverTimestamp(), updatedBy: BY });
  });
  console.log("✅ done");
});
