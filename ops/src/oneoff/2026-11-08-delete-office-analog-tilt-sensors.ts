/**
 * Delete the analog-tilt test sensors on the office test site, so the unit
 * (re-flashed with 20261108.x) re-provisions fresh sensors on its next sync.
 * Asked by Hillel (2026-11-08) before the end-to-end analog tilt test.
 *
 * Scope: work-sensors whose gateway.device belongs to a photon-otac datalogger
 * with config.deviceType == "analog_tilt" AND location.site == --site.
 * Deletes each sensor doc recursively (data-log, baseline-events, …) plus
 * alerts with sensorId == that sensor. The photon-otac datalogger doc is kept
 * (it carries the analog_tilt sampler config the firmware needs).
 *
 * Usage:
 *   ./go.sh run src/oneoff/2026-11-08-delete-office-analog-tilt-sensors.ts           # dry run
 *   ./go.sh run src/oneoff/2026-11-08-delete-office-analog-tilt-sensors.ts --apply   # writes (asks "yes")
 *
 * Undo: none (test data). The bridge recreates sensors on the next upload.
 */
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, fmtTime, parseArgs, run, str } from "../lib/cli";

const OFFICE_TEST_SITE = "j7prfbs8Mord8g4cgNb5"; // "בדיקות משרד"

run(async () => {
  const args = parseArgs();
  const site = str(args.site) ?? OFFICE_TEST_SITE;

  const siteDoc = await db.doc(`projects/${site}`).get();
  console.log(`site ${site}: ${siteDoc.exists ? siteDoc.data()?.title ?? siteDoc.data()?.name : "(no projects doc)"}`);

  const dls = (await db.collection("photon-otac").get()).docs.filter(
    (d) => (d.data()?.config?.deviceType || d.data()?.type) === "analog_tilt"
  );
  const devices = dls.map((d) => String(d.data()?.["photon-id"] || d.id));
  console.log(`analog_tilt dataloggers: ${devices.join(", ") || "(none)"}`);

  const targets: { ref: FirebaseFirestore.DocumentReference; alerts: FirebaseFirestore.DocumentReference[] }[] = [];
  for (const dev of devices) {
    const snap = await db.collection("work-sensors").where("gateway.device", "==", dev).get();
    for (const d of snap.docs) {
      const s = d.data();
      if (s.location?.site !== site) {
        console.log(`  skip ${d.id} (${s.title}) — site ${s.location?.site}`);
        continue;
      }
      const subs = await d.ref.listCollections();
      const counts = await Promise.all(subs.map(async (c) => `${c.id}=${(await c.count().get()).data().count}`));
      const alerts = (await db.collection("alerts").where("sensorId", "==", d.id).get()).docs.map((a) => a.ref);
      console.log(
        `  DELETE work-sensors/${d.id}  title=${s.title}  type=${s.type}  gateway=${JSON.stringify(s.gateway)}` +
        `  created=${fmtTime(s.created?.toMillis?.() ?? s.created)}\n     subcollections: ${counts.join(" ") || "none"}  alerts=${alerts.length}`
      );
      targets.push({ ref: d.ref, alerts });
    }
  }

  const alertCount = targets.reduce((n, t) => n + t.alerts.length, 0);
  if (!targets.length) {
    console.log("\nNothing to delete.");
    return;
  }
  const summary = `recursively delete ${targets.length} work-sensors (+ ${alertCount} alerts) on site ${site}`;
  if (!(await confirmApply(args, summary))) return;

  const w = new BatchWriter();
  for (const t of targets) for (const a of t.alerts) await w.delete(a);
  await w.flush();
  for (const t of targets) {
    await db.recursiveDelete(t.ref);
    console.log(`  ✓ deleted ${t.ref.path}`);
  }
  console.log(`✅ done: ${targets.length} sensors, ${w.committed} alerts deleted`);
});
