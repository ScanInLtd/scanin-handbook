/**
 * Read-only: live-ATS ingestion coverage — which ATS points (devices) reach which sensors,
 * and which points are missing samples in a window.
 *
 * Chain (scanin-svc-mqtt-bridge, scaninHandler.processAtsSample):
 *   MQTT scanin/ATS-<station>-<point>/uplink/samples
 *     → ats-device-map/{deviceId}.sensorId   (fallback: work-sensors.atsDeviceId, else auto-create)
 *     → work-sensors/{sensorId}/data-log/{timestampMs}  (source: ats_live)
 *   Non-"samples" message types → ats_raw_payloads (samples are NOT stored raw).
 *
 * Usage: npx tsx src/analysis/ats-coverage.ts [--project=<id|name>] [--hours=48] [--site=<atsSiteId>]
 */
import { db } from "../lib/firebase";
import { fmtTime, num, parseArgs, run, str } from "../lib/cli";
import { projectName, resolveProject } from "../lib/sensors";
import { H, median } from "../lib/signal";

run(async () => {
  const args = parseArgs();
  const hours = num(args.hours, 48);
  const from = Date.now() - hours * H;
  const project = args.project ? await resolveProject(str(args.project)!) : null;

  // 1. Routing table
  const mapSnap = await db.collection("ats-device-map").get();
  const map = mapSnap.docs.map((d) => ({ deviceId: d.id, ...(d.data() as any) }));
  const projects = new Map((await db.collection("projects").get()).docs.map((d) => [d.id, projectName(d.data())]));

  // 2. Sensors referenced by the map + all ats_live sensors
  const liveSnap = await db.collection("work-sensors").where("dataSource", "==", "ats_live").get();
  const sensorIds = new Set([...map.map((m) => m.sensorId).filter(Boolean), ...liveSnap.docs.map((d) => d.id)]);
  const sensors = new Map<string, any>();
  await Promise.all([...sensorIds].map(async (id) => {
    const s = await db.collection("work-sensors").doc(id).get();
    if (s.exists) sensors.set(id, s.data());
  }));

  const siteFilter = str(args.site);
  const inScope = (sensor: any, m?: any) => {
    if (siteFilter) return (m?.atsSiteId ?? sensor?.atsSiteId) === siteFilter;
    if (project) return sensor?.location?.site === project.id;
    return true;
  };

  // map entries pointing at nothing
  const dangling = map.filter((m) => !sensors.has(m.sensorId));
  // sensors whose project link is not a real project (auto-created with atsSiteId as site)
  const orphans = [...sensors].filter(([, s]) => !projects.has(s.location?.site));
  // several devices → same sensor
  const bySensor = new Map<string, string[]>();
  map.forEach((m) => bySensor.set(m.sensorId, [...(bySensor.get(m.sensorId) ?? []), m.deviceId]));
  const shared = [...bySensor].filter(([, ds]) => ds.length > 1);

  console.log(`\nats-device-map: ${map.length} devices; ats_live sensors: ${liveSnap.size}`);
  console.log(`  atsSiteIds in map: ${[...new Set(map.map((m) => m.atsSiteId))].join(", ")}`);
  console.log(`  dangling map entries (sensor doc missing): ${dangling.length}${dangling.length ? "  " + dangling.map((m) => m.deviceId).join(", ") : ""}`);
  console.log(`  sensors linked to a non-existent project (location.site): ${orphans.length}`);
  orphans.slice(0, 20).forEach(([id, s]) => console.log(`     ${id}  ${s.name}  site=${s.location?.site}  device=${s.atsDeviceId}`));
  console.log(`  sensors fed by >1 device: ${shared.length}`);
  shared.forEach(([sid, ds]) => console.log(`     ${sid} (${sensors.get(sid)?.name}) ← ${ds.join(", ")}`));

  // 3. Per device: samples in window
  const rows: any[] = [];
  await Promise.all(map.map(async (m) => {
    const s = sensors.get(m.sensorId);
    if (!inScope(s, m)) return;
    const logRef = db.collection(`work-sensors/${m.sensorId}/data-log`);
    const [win, last] = await Promise.all([
      logRef.where("time", ">=", from).get(),
      logRef.orderBy("time", "desc").limit(1).get(),
    ]);
    const live = win.docs.filter((d) => d.data().source === "ats_live");
    rows.push({
      deviceId: m.deviceId, atsSite: m.atsSiteId, sensorId: m.sensorId, name: s?.name ?? "(missing)",
      project: projects.get(s?.location?.site) ?? `?(${s?.location?.site})`, active: s?.active, confirmed: s?.confirmed,
      n: live.length, suspect: live.filter((d) => d.data().suspect).length,
      last: last.docs[0]?.data().time ?? null, mapUpdated: m.updatedAt?.toMillis?.() ?? null,
      lastSeen: s?.lastSeen ?? s?.last_seen_at ?? null,
    });
  }));

  // 4. Raw (non-sample) payloads in window, per device
  const rawSnap = await db.collection("ats_raw_payloads").where("receivedAt", ">=", new Date(from)).get();
  const rawBy = new Map<string, Map<string, number>>();
  rawSnap.docs.forEach((d) => {
    const x = d.data();
    const m = rawBy.get(x.deviceId) ?? new Map();
    m.set(x.messageType, (m.get(x.messageType) ?? 0) + 1);
    rawBy.set(x.deviceId, m);
  });

  rows.sort((a, b) => a.deviceId.localeCompare(b.deviceId, undefined, { numeric: true }));
  const expected = median(rows.map((r) => r.n).filter((n) => n > 0));
  console.log(`\n━━ Per ATS device, last ${hours}h ${project ? `(project ${project.name})` : siteFilter ? `(atsSite ${siteFilter})` : ""} — typical samples/device: ${expected} ━━`);
  console.log(`${"device".padEnd(16)} ${"n".padStart(4)} ${"susp".padStart(4)}  ${"last sample".padEnd(28)} ${"sensor".padEnd(22)} project / flags`);
  rows.forEach((r) => {
    const flag = r.n === 0 ? "🔴 NONE" : r.n < expected * 0.8 ? "🟡 LOW" : "🟢";
    const raw = rawBy.get(r.deviceId);
    console.log(`${r.deviceId.padEnd(16)} ${String(r.n).padStart(4)} ${String(r.suspect).padStart(4)}  ${fmtTime(r.last).padEnd(28)} ${String(r.name).slice(0, 22).padEnd(22)} ${r.project}${r.active === false ? "  [inactive]" : ""}${r.confirmed === false ? "  [unconfirmed]" : ""}  ${flag}${raw ? "  raw:" + [...raw].map(([k, v]) => `${k}=${v}`).join(",") : ""}`);
  });

  const devicesWithRawOnly = [...rawBy.keys()].filter((d) => !map.find((m) => m.deviceId === d));
  if (devicesWithRawOnly.length) console.log(`\nDevices sending non-sample messages but absent from ats-device-map: ${devicesWithRawOnly.join(", ")}`);
  console.log(`\nats_raw_payloads in window: ${rawSnap.size} docs from ${rawBy.size} devices`);
  console.log();
});
