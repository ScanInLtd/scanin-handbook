/**
 * Retire the `analog_tilt` sensor type — unify it into standard `tilt`.
 * Asked by Hillel (WhatsApp/DevBot, 2026-11-06): analog_tilt is the firmware
 * SAMPLER name (datalogger config.deviceType stays), but the sensor data type
 * is plain tilt — duplicating it as a sensor type forked charts/axes/thresholds.
 *
 * Companion code changes:
 *   - scanin-svc-mqtt-bridge: findOrCreateScaninSensor maps datalogger type
 *     analog_tilt → sensor type "tilt" (new sensors are never created mistyped).
 *   - scanin-svc-firebase-functions: analog_tilt case removed from
 *     defaultSuspectLimits (dead code once sensors are type "tilt").
 *
 * This script (dry-run by default):
 *   1. work-sensors type=="analog_tilt" → type="tilt"
 *      (title auto-prefix "analog_tilt.<mac>.Ch<n>" → "tilt.<mac>.Ch<n>";
 *       any other title is left untouched)
 *   2. alerts sensorType=="analog_tilt" → "tilt" (denormalized field on history)
 *   3. devices-types/sensors/devices/analog_tilt → delete (was cloned from tilt
 *      by 2026-11-05-analog-tilt-setup.ts; tilt registry covers it now)
 *   4. report-only: photon-otac docs with config.deviceType=="analog_tilt" are
 *      NOT changed — that is the sampler name the firmware needs.
 *
 * Usage:
 *   ./go.sh run src/oneoff/2026-11-06-analog-tilt-to-tilt.ts           # dry run
 *   ./go.sh run src/oneoff/2026-11-06-analog-tilt-to-tilt.ts --apply   # writes (asks "yes")
 *
 * Undo: flip type back to "analog_tilt" on the listed sensor/alert doc ids and
 * recreate devices-types/sensors/devices/analog_tilt as a copy of .../tilt.
 */
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run } from "../lib/cli";

const OLD = "analog_tilt";
const NEW = "tilt";
const AUTO_TITLE = new RegExp(`^${OLD}\\.`); // auto-generated "analog_tilt.<mac>.Ch<n>"

run(async () => {
  const args = parseArgs();
  const summary: string[] = [];

  // ── 1. work-sensors ─────────────────────────────────────────────────────
  const sensors = await db.collection("work-sensors").where("type", "==", OLD).get();
  console.log(`1) work-sensors type "${OLD}" → "${NEW}": ${sensors.size} doc(s)`);
  const renames: { id: string; from: string; to: string }[] = [];
  for (const d of sensors.docs) {
    const s = d.data();
    const title = s.title ?? "";
    const newTitle = AUTO_TITLE.test(title) ? title.replace(AUTO_TITLE, `${NEW}.`) : title;
    console.log(
      `   ${d.id}  site=${s.location?.site}  gateway=${JSON.stringify(s.gateway)}` +
      `\n      title: ${title}` + (newTitle !== title ? `  →  "${newTitle}"` : "  (kept)")
    );
    if (newTitle !== title) renames.push({ id: d.id, from: title, to: newTitle });
  }
  if (sensors.size) summary.push(`retype ${sensors.size} work-sensors to "${NEW}"${renames.length ? ` (+${renames.length} title prefixes)` : ""}`);

  // ── 2. alerts (denormalized sensorType on alert history) ────────────────
  const alerts = await db.collection("alerts").where("sensorType", "==", OLD).get();
  console.log(`\n2) alerts sensorType "${OLD}" → "${NEW}": ${alerts.size} doc(s)`);
  if (alerts.size) summary.push(`retype ${alerts.size} alerts sensorType`);

  // ── 3. devices-types doc ────────────────────────────────────────────────
  const typeRef = db.doc(`devices-types/sensors/devices/${OLD}`);
  const typeDoc = await typeRef.get();
  console.log(`\n3) devices-types/sensors/devices/${OLD}: ${typeDoc.exists ? "DELETE" : "already absent"}`);
  if (typeDoc.exists) summary.push("delete devices-types analog_tilt doc");

  // ── 4. report-only: datalogger sampler config (must keep analog_tilt) ────
  const dls = await db.collection("photon-otac").get();
  const analogDls = dls.docs.filter(
    (d) => (d.data()?.config?.deviceType || d.data()?.type) === OLD
  );
  console.log(`\n4) photon-otac with deviceType "${OLD}": ${analogDls.length} — UNCHANGED (firmware sampler name)`);
  analogDls.forEach((d) =>
    console.log(`   ${d.id}  photon-id=${d.data()?.["photon-id"]}  title=${d.data()?.title}`)
  );

  if (!summary.length) {
    console.log("\nNothing to do — migration already complete.");
    return;
  }
  console.log("\n── PLAN ──");
  summary.forEach((s) => console.log(`  ${s}`));

  if (!(await confirmApply(args, summary.join("; ")))) return;

  const w = new BatchWriter();
  for (const d of sensors.docs) {
    const update: Record<string, string> = { type: NEW };
    const r = renames.find((x) => x.id === d.id);
    if (r) update.title = r.to;
    await w.update(d.ref, update);
  }
  for (const d of alerts.docs) await w.update(d.ref, { sensorType: NEW });
  if (typeDoc.exists) await w.delete(typeRef);
  await w.flush();
  console.log(`✅ done: ${w.committed} write(s) committed`);
});
