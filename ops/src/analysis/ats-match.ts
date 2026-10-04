/**
 * Read-only: match live ATS devices to project prism sensors by COORDINATES.
 *
 * Every prism has unique local coordinates (e, n, u in metres, stored on ats_live samples).
 * For each device in ats-device-map (site filter), take the median e/n/u of its recent samples;
 * for every prism sensor of the project, take the median e/n/u of its samples that carry e/n/u.
 * The nearest sensor (other than the mapped one) shows where the device's data really belongs.
 *
 * Usage: npx tsx src/analysis/ats-match.ts <projectId|name> --site=DeVinci-1 [--days=60]
 */
import { db } from "../lib/firebase";
import { fmtTime, num, parseArgs, run, str } from "../lib/cli";
import { projectSensors, resolveProject } from "../lib/sensors";
import { DAY, median } from "../lib/signal";

type Coord = { e: number; n: number; u: number; count: number; last: number | null; first: number | null };

async function coords(sensorId: string, from: number, to = Date.now()): Promise<Coord | null> {
  const snap = await db.collection(`work-sensors/${sensorId}/data-log`).where("time", ">=", from).where("time", "<=", to).get();
  const pts = snap.docs.map((d) => d.data()).filter((x) => [x.e, x.n, x.u].every(Number.isFinite) && x.suspect !== true);
  if (!pts.length) return null;
  const ts = pts.map((p) => p.time);
  return { e: median(pts.map((p) => p.e)), n: median(pts.map((p) => p.n)), u: median(pts.map((p) => p.u)), count: pts.length, last: Math.max(...ts), first: Math.min(...ts) };
}
const dist = (a: Coord, b: Coord) => Math.hypot(a.e - b.e, a.n - b.n, a.u - b.u);

run(async () => {
  const args = parseArgs();
  const project = await resolveProject(args._[0] ?? "");
  const site = str(args.site) ?? "DeVinci-1";
  const days = num(args.days, 60);
  const from = Date.now() - days * DAY;

  const sensors = await projectSensors(project.id, "prism");
  const mapSnap = await db.collection("ats-device-map").where("atsSiteId", "==", site).get();
  const devices = mapSnap.docs.map((d) => ({ deviceId: d.id, sensorId: d.data().sensorId as string }));
  const fedBy = new Map<string, string[]>();
  devices.forEach((d) => fedBy.set(d.sensorId, [...(fedBy.get(d.sensorId) ?? []), d.deviceId]));

  // sensor fingerprints = coordinates from history BEFORE the device era is not needed: e/n/u only exist on live samples,
  // so use each sensor's own samples over the window.
  const sensorCoords = new Map<string, Coord | null>();
  await Promise.all(sensors.map(async (s) => sensorCoords.set(s.id, await coords(s.id, from))));

  // device fingerprints = last 48h of the mapped sensor (what the device is sending now)
  const devCoords = new Map<string, Coord | null>();
  await Promise.all(devices.map(async (d) => devCoords.set(d.deviceId, await coords(d.sensorId, Date.now() - 2 * DAY))));

  console.log(`\n● ${project.name}: ${sensors.length} prism sensors; ${devices.length} devices for atsSite ${site}\n`);
  console.log("Prism sensors (by name): last e/n/u-sample, fed by");
  sensors.forEach((s) => {
    const c = sensorCoords.get(s.id);
    console.log(`  ${String(s.label).padEnd(20)} ${s.id}  ${s.data.active === false ? "inactive" : "active  "}  e/n/u samples=${String(c?.count ?? 0).padStart(4)}  last=${fmtTime(c?.last ?? null).padEnd(26)} fed by: ${(fedBy.get(s.id) ?? []).join(", ") || "—"}`);
  });

  console.log(`\nDevice → mapped sensor | nearest OTHER sensor by coordinates (distance; that sensor's e/n/u era)`);
  const nameOf = new Map(sensors.map((s) => [s.id, String(s.label)]));
  devices.sort((a, b) => a.deviceId.localeCompare(b.deviceId, undefined, { numeric: true })).forEach((d) => {
    const dc = devCoords.get(d.deviceId);
    if (!dc) return console.log(`  ${d.deviceId.padEnd(12)} → ${(nameOf.get(d.sensorId) ?? d.sensorId + " (not in project)").padEnd(20)} | no data in last 48h`);
    const cands = sensors
      .filter((s) => s.id !== d.sensorId)
      .map((s) => ({ s, c: sensorCoords.get(s.id) }))
      .filter((x) => x.c)
      .map((x) => ({ ...x, dd: dist(dc, x.c!) }))
      .sort((a, b) => a.dd - b.dd);
    const best = cands[0];
    const self = sensorCoords.get(d.sensorId);
    console.log(`  ${d.deviceId.padEnd(12)} → ${(nameOf.get(d.sensorId) ?? d.sensorId + " (not in project)").padEnd(20)} | nearest: ${best ? `${String(best.s.label).padEnd(20)} ${best.dd.toFixed(3)} m (${fmtTime(best.c!.first)} … ${fmtTime(best.c!.last)})` : "—"}${self ? "" : ""}`);
  });
  console.log();
});
