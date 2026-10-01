/**
 * Inspect one sensor: metadata, status, thresholds, latest samples.
 * Usage: npx tsx src/queries/sensor.ts <docId|scanin-id|MAC|name> [--n=10] [--full] [--daily]
 *   --full   print the whole sensor doc as JSON
 *   --daily  include daily::* aggregate docs in the sample list (excluded by default)
 */
import { db } from "../lib/firebase";
import { fmtTime, num, parseArgs, run } from "../lib/cli";
import { findSensors, projectName } from "../lib/sensors";

run(async () => {
  const args = parseArgs();
  const key = args._[0];
  if (!key) throw new Error("usage: sensor.ts <docId|scanin-id|MAC|name>");

  const sensors = await findSensors(key);
  if (!sensors.length) throw new Error(`no sensor matches "${key}"`);
  if (sensors.length > 1) {
    console.log(`"${key}" matched ${sensors.length} sensors:`);
    sensors.forEach((s) => console.log(`  ${s.id}  ${s.label}  type=${s.data.type}  site=${s.data.location?.site}`));
    return;
  }

  const s = sensors[0];
  const d = s.data;
  const site = d.location?.site ? await db.collection("projects").doc(d.location.site).get() : null;

  console.log(`\n● ${s.label}   (work-sensors/${s.id})`);
  console.log(`  scanin-id: ${d["scanin-id"] ?? "—"}   type: ${d.type ?? "—"}   active: ${d.active ?? "—"}`);
  console.log(`  project:   ${site?.exists ? `${projectName(site.data()!)} (${site.id})` : d.location?.site ?? "—"}   section: ${d.location?.section ?? "—"}`);
  if (d.gateway) console.log(`  gateway:   ${JSON.stringify(d.gateway)}`);
  if (d.status) console.log(`  status:    ${JSON.stringify(d.status)}`);
  if (d.thresholds) console.log(`  thresholds:${JSON.stringify(d.thresholds)}`);
  console.log(`  UI link:   /s/${s.id}`);
  if (args.full) console.log(JSON.stringify(d, null, 2));

  const n = num(args.n, 10);
  const snap = await db.collection(`work-sensors/${s.id}/data-log`).orderBy("time", "desc").limit(args.daily ? n : n * 3).get();
  const docs = snap.docs.filter((x) => args.daily || !x.id.startsWith("daily::")).slice(0, n);
  console.log(`\n  Latest ${docs.length} samples:`);
  docs.forEach((x) => {
    const { time, ...rest } = x.data();
    console.log(`  ${fmtTime(time)}  ${x.id.startsWith("daily::") ? x.id + " " : ""}${JSON.stringify(rest)}`);
  });
  console.log();
});
