/**
 * cracktemp default thresholds in the sensor-type registry: crack opening (x)
 * warn 2 mm / alarm 3 mm. Decided by Hillel 2026-11-08. Temperature axes are
 * not alertable in the registry and get no default. Follows
 * 2026-11-08-default-thresholds.ts (tilt, prism).
 *
 * Usage: ./go.sh run src/oneoff/2026-11-08-cracktemp-default-thresholds.ts [--apply]
 * Undo: delete field defaultThresholds on devices-types/sensors/devices/cracktemp.
 */
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { confirmApply, parseArgs, run } from "../lib/cli";

const DEFAULTS = { x: { warn: { gap: 2 }, alarm: { gap: 3 } } };

run(async () => {
  const args = parseArgs();
  const ref = db.doc("devices-types/sensors/devices/cracktemp");
  const reg = (await ref.get()).data();
  if (!reg) throw new Error("registry type cracktemp missing");
  if (reg.axes?.x?.alertable !== true) throw new Error("cracktemp axis x is not alertable in the registry");
  console.log(`cracktemp.defaultThresholds ${JSON.stringify(reg.defaultThresholds ?? null)} → ${JSON.stringify(DEFAULTS)}`);
  if (!(await confirmApply(args, "set cracktemp.defaultThresholds x = 2/3 mm"))) return;
  await ref.set({ defaultThresholds: DEFAULTS, defaultThresholdsUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log("✅ done");
});
