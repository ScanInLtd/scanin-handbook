/**
 * Bring the new `analog_tilt` datalogger (68:EE:8F:52:62:D8, fw 20261105.1)
 * online for site j7prfbs8Mord8g4cgNb5. Asked by Hillel (WhatsApp/DevBot):
 * charts show no points.
 *
 * Diagnosis (see ops/src/queries/analog-tilt-flow.ts output 2026-11-05):
 *   - devices-types has no `analog_tilt` doc → UI chartAxes=[] → chart never draws.
 *   - Device config has no siteId → newest samples land on site="default" sensors.
 *   - Ch2 samples go to a mis-typed `cracktemp` sensor; junk raw-count samples
 *     (y=-127) were written before the fw fix; stale ch0/ch3/ch4 sensors exist.
 *
 * This script (dry-run by default):
 *   1. creates devices-types/sensors/devices/analog_tilt as a copy of `tilt`
 *   2. sets config.siteId (+ site fields) on the photon-otac datalogger doc
 *   3. fixes the Ch2 sensor: type analog_tilt, confirmed, location.site=<site>, title
 *   4. migrates the 2 good Ch1@default samples into the site Ch1 sensor, then
 *      deletes the default-site Ch1 sensor
 *   5. deletes junk samples (y === -127) on the two kept sensors
 *   6. deletes stale sensors (Ch0 tilt, Ch3/Ch4 cracktemp) incl. their data-log
 *
 * Usage:
 *   npx tsx src/oneoff/2026-11-05-analog-tilt-setup.ts           # dry run
 *   npx tsx src/oneoff/2026-11-05-analog-tilt-setup.ts --apply   # writes (asks "yes")
 *
 * Undo: sensors/doc ids are printed before delete; recreate via bridge auto-create
 *       (config/siteId change) or restore from Firestore export. Type doc delete:
 *       db.doc('devices-types/sensors/devices/analog_tilt').delete().
 */
import { db } from "../lib/firebase";
import { confirmApply, parseArgs, run } from "../lib/cli";

const SITE = "j7prfbs8Mord8g4cgNb5";
const DEVICE = "68:EE:8F:52:62:D8";
const DATALOGGER_DOC = "1hXDHCAYofGiCRLgnXRT";

const KEEP_CH1 = "o7IzJTGplU84pI4hdw7E"; // analog_tilt Ch1 @ SITE
const FIX_CH2 = "fZcUfT02F5BZEAaUuwck"; // cracktemp → analog_tilt Ch2, move @ SITE
const MIGRATE_FROM = "A7lojb7VUgkvfvIPSTu5"; // analog_tilt Ch1 @ default
const DELETE_SENSORS = [
  "A7lojb7VUgkvfvIPSTu5",
  "Zfbxl0F7zjxif5C3Kixl", // tilt Ch0 @ SITE (created by mistake)
  "VX4PScVvC0LdXAaG72vw", // cracktemp Ch3 @ default
  "wiYLs1Gk2SSfdaj9CFrr", // cracktemp Ch4 @ default
];
const JUNK_SAMPLE_SENSORS = [KEEP_CH1, FIX_CH2];
const isJunk = (d: any) => d.y === -127 || (typeof d.x === "number" && Math.abs(d.x) > 1000);

run(async () => {
  const args = parseArgs();
  const summary: string[] = [];
  const planned: { path: string; action: string }[] = [];

  // ── 1. devices-types doc ────────────────────────────────────────────────
  const tiltDoc = await db.doc("devices-types/sensors/devices/tilt").get();
  if (!tiltDoc.exists) throw new Error("devices-types/…/tilt missing — cannot clone");
  const atDoc = await db.doc("devices-types/sensors/devices/analog_tilt").get();
  const newTypeDoc = { ...tiltDoc.data()!, type: "analog_tilt" };
  console.log(`1) devices-types/…/analog_tilt: ${atDoc.exists ? "EXISTS (will overwrite merge)" : "CREATE from tilt"}`);
  console.log(`   ${JSON.stringify(newTypeDoc)}`);
  planned.push({ path: "devices-types/sensors/devices/analog_tilt", action: "set(copy of tilt)" });
  summary.push("create devices-types/sensors/devices/analog_tilt");

  // ── 2. datalogger siteId ────────────────────────────────────────────────
  const dlRef = db.collection("photon-otac").doc(DATALOGGER_DOC);
  const dl = await dlRef.get();
  if (!dl.exists) throw new Error(`datalogger doc ${DATALOGGER_DOC} missing`);
  const siteDoc = await db.collection("projects").doc(SITE).get();
  const siteName = siteDoc.exists ? (siteDoc.data()!.name || siteDoc.data()!.title || SITE) : SITE;
  console.log(`2) photon-otac/${DATALOGGER_DOC} (${DEVICE}): config.siteId "${dl.data()?.config?.siteId ?? "(none)"}" → "${SITE}"  site="${siteName}"`);
  planned.push({ path: dlRef.path, action: `config.siteId=${SITE}` });
  summary.push(`set siteId on datalogger ${DEVICE}`);

  // ── 3. fix Ch2 sensor ───────────────────────────────────────────────────
  const ch2Ref = db.collection("work-sensors").doc(FIX_CH2);
  const ch2 = await ch2Ref.get();
  if (!ch2.exists) throw new Error(`sensor ${FIX_CH2} missing`);
  const ch2Update = {
    type: "analog_tilt",
    title: "analog_tilt.62:D8.Ch2",
    confirmed: true,
    location: { site: SITE, section: "", title: "", "map-x": "", "map-y": "" },
  };
  console.log(`3) work-sensors/${FIX_CH2} (Ch2): type cracktemp→analog_tilt, confirmed→true, location.site default→${SITE}`);
  planned.push({ path: ch2Ref.path, action: JSON.stringify(ch2Update) });
  summary.push("fix Ch2 sensor");

  // ── 4. migrate good samples default Ch1 → site Ch1 ─────────────────────
  const migSnap = await db.collection(`work-sensors/${MIGRATE_FROM}/data-log`).get();
  const goodSamples = migSnap.docs.filter((d) => !isJunk(d.data()));
  console.log(`4) migrate ${goodSamples.length}/${migSnap.size} good samples work-sensors/${MIGRATE_FROM}/data-log → work-sensors/${KEEP_CH1}/data-log`);
  goodSamples.forEach((d) => planned.push({ path: `work-sensors/${KEEP_CH1}/data-log/<new>`, action: `copy of ${d.id}: ${JSON.stringify(d.data())}` }));
  summary.push(`migrate ${goodSamples.length} samples to site Ch1`);

  // ── 5. junk samples on kept sensors ─────────────────────────────────────
  for (const sid of JUNK_SAMPLE_SENSORS) {
    const snap = await db.collection(`work-sensors/${sid}/data-log`).get();
    const junk = snap.docs.filter((d) => isJunk(d.data()));
    console.log(`5) work-sensors/${sid}/data-log: delete ${junk.length}/${snap.size} junk samples (y=-127 / |x|>1000)`);
    junk.forEach((d) => planned.push({ path: d.ref.path, action: "DELETE (junk)" }));
    summary.push(`delete ${junk.length} junk samples on ${sid}`);
  }

  // ── 6. delete stale sensors (+ their data-log) ──────────────────────────
  for (const sid of DELETE_SENSORS) {
    const sDoc = await db.collection("work-sensors").doc(sid).get();
    const dataSnap = await db.collection(`work-sensors/${sid}/data-log`).get();
    console.log(`6) DELETE work-sensors/${sid} (${sDoc.data()?.title ?? "?"}, type=${sDoc.data()?.type}, site=${sDoc.data()?.location?.site}) + ${dataSnap.size} data-log docs`);
    planned.push({ path: `work-sensors/${sid}`, action: `DELETE doc + ${dataSnap.size} samples` });
    summary.push(`delete sensor ${sid}`);
  }

  console.log("\n── PLAN ──");
  planned.forEach((p) => console.log(`  ${p.action.padEnd(60)} ${p.path}`));

  if (!(await confirmApply(args, summary.join("; ")))) return;

  // ── WRITE ───────────────────────────────────────────────────────────────
  // 1
  await db.doc("devices-types/sensors/devices/analog_tilt").set(newTypeDoc);
  console.log("  ✓ analog_tilt type doc created");
  // 2
  await dlRef.set({
    config: { ...(dl.data()!.config || {}), siteId: SITE },
    siteId: SITE,
    siteName,
    project: siteName,
  }, { merge: true });
  console.log("  ✓ datalogger siteId set");
  // 3
  await ch2Ref.update(ch2Update);
  console.log("  ✓ Ch2 sensor fixed");
  // 4
  for (const d of goodSamples) {
    await db.collection(`work-sensors/${KEEP_CH1}/data-log`).add(d.data());
  }
  console.log(`  ✓ migrated ${goodSamples.length} samples`);
  // 5
  for (const sid of JUNK_SAMPLE_SENSORS) {
    const snap = await db.collection(`work-sensors/${sid}/data-log`).get();
    for (const d of snap.docs.filter((x) => isJunk(x.data()))) await d.ref.delete();
  }
  console.log("  ✓ junk samples deleted");
  // 6
  for (const sid of DELETE_SENSORS) {
    const dataSnap = await db.collection(`work-sensors/${sid}/data-log`).get();
    for (const d of dataSnap.docs) await d.ref.delete();
    await db.collection("work-sensors").doc(sid).delete();
  }
  console.log("  ✓ stale sensors deleted");
  console.log("✅ done");
});
