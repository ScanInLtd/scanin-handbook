/**
 * Default thresholds live in the sensor-type registry. Asked by Hillel
 * (2026-11-08): new sensors (bridge-provisioned ESP + ATS, UI installs) take
 * their initial thresholds from devices-types/sensors/devices/{type}.defaultThresholds,
 * in the same schema as work-sensors.thresholds.axes:
 *   { <axis>: { warn: { gap }, alarm: { gap } } }   (alertable axes only)
 * The legacy `defaultThreshold` (singular, normal/high/low min/max) is left untouched.
 *
 * Values = most common active production setting (2026-11-08):
 *   tilt  x,y      0.2° / 0.3°   (38 of 86 active axis settings)
 *   prism E,N,H    4 / 6 mm      (what the bridge's ATS fallback already applies)
 * cracktemp / loadcell / straingauge: no default yet (no consensus).
 *
 * Also gives the two new analog-tilt sensors on site Si-01 (בית בדיקות) the tilt
 * defaults, only where they have no thresholds.axes yet.
 *
 * Usage: ./go.sh run src/oneoff/2026-11-08-default-thresholds.ts [--apply]
 * Undo: delete field defaultThresholds on devices-types tilt/prism; delete
 *       thresholds on the two sensors (they had none before).
 */
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run } from "../lib/cli";

const t = (warn: number, alarm: number) => ({ warn: { gap: warn }, alarm: { gap: alarm } });

const DEFAULTS: Record<string, Record<string, ReturnType<typeof t>>> = {
  tilt: { x: t(0.2, 0.3), y: t(0.2, 0.3) },
  prism: { EastingDisplacement: t(4, 6), NorthingDisplacement: t(4, 6), HeightDisplacement: t(4, 6) },
};
const NEW_SENSORS = ["Yk0cbhNrMn5qbREZrOeU", "IhNmt6BBNbERwpZtdpdb"]; // tilt.62:D8.Ch1/Ch2 @ Si-01

run(async () => {
  const args = parseArgs();
  const plan: { ref: FirebaseFirestore.DocumentReference; data: any; what: string }[] = [];

  for (const [type, axes] of Object.entries(DEFAULTS)) {
    const ref = db.doc(`devices-types/sensors/devices/${type}`);
    const doc = await ref.get();
    if (!doc.exists) throw new Error(`registry type ${type} missing`);
    const reg = doc.data()!;
    const notAlertable = Object.keys(axes).filter((a) => reg.axes?.[a]?.alertable !== true);
    if (notAlertable.length) throw new Error(`${type}: axes not alertable in registry: ${notAlertable.join(",")}`);
    console.log(`registry ${type}: defaultThresholds ${JSON.stringify(reg.defaultThresholds ?? null)} → ${JSON.stringify(axes)}`);
    plan.push({ ref, data: { defaultThresholds: axes, defaultThresholdsUpdatedAt: FieldValue.serverTimestamp() }, what: `set ${type}.defaultThresholds` });
  }

  for (const id of NEW_SENSORS) {
    const ref = db.doc(`work-sensors/${id}`);
    const s = (await ref.get()).data();
    if (!s) throw new Error(`sensor ${id} missing`);
    const has = s.thresholds?.axes && Object.keys(s.thresholds.axes).length > 0;
    console.log(`sensor ${id} (${s.title}, type=${s.type}, site=${s.location?.site}): thresholds ${has ? "already set — skip" : "none → tilt defaults"}`);
    if (!has && s.type === "tilt") plan.push({ ref, data: { thresholds: { axes: DEFAULTS.tilt } }, what: `set thresholds on ${id}` });
  }

  if (!(await confirmApply(args, plan.map((p) => p.what).join("; ")))) return;
  const w = new BatchWriter();
  for (const p of plan) await w.set(p.ref, p.data, true);
  await w.flush();
  console.log(`✅ done: ${w.committed} write(s)`);
});
