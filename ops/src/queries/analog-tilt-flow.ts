/**
 * End-to-end state of `analog_tilt` devices — read-only.
 *  1. photon-otac datalogger docs with config.deviceType == "analog_tilt"
 *  2. work-sensors with type == "analog_tilt" + sensors whose gateway.device
 *     belongs to those dataloggers (incl. mistyped sensors)
 *  3. data-log contents of each matching sensor
 *  4. devices-types/sensors/devices/analog_tilt existence
 *
 * Usage: npx tsx src/queries/analog-tilt-flow.ts [--n=5] [--full]
 */
import { db } from "../lib/firebase";
import { fmtTime, num, parseArgs, run } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const n = num(args.n, 5);

  // ── 1. Dataloggers ──────────────────────────────────────────────────────
  console.log("=== 1. photon-otac dataloggers ===");
  const allDataloggers = await db.collection("photon-otac").get();
  const byType = new Map<string, number>();
  const analogDls: { id: string; deviceId: string; data: any }[] = [];
  allDataloggers.forEach((d) => {
    const dt = d.data()?.config?.deviceType || d.data()?.type || "(none)";
    byType.set(dt, (byType.get(dt) || 0) + 1);
    if (dt === "analog_tilt") {
      analogDls.push({ id: d.id, deviceId: d.data()?.["photon-id"] || d.id, data: d.data() });
    }
  });
  console.log("deviceType census:", JSON.stringify(Object.fromEntries([...byType.entries()].sort())));
  console.log(`\nanalog_tilt dataloggers: ${analogDls.length}`);
  for (const dl of analogDls) {
    const d = dl.data;
    console.log(`\n● photon-otac/${dl.id}  photon-id=${dl.deviceId}`);
    console.log(`  title=${d.title}  siteId=${d.siteId}  project=${d.project}  active=${d.active}`);
    console.log(`  created=${fmtTime(d.created?.toMillis?.() ?? d.created)}  last_seen_at=${fmtTime(d.last_seen_at?.toMillis?.() ?? d.last_seen_at)}`);
    console.log(`  config.deviceType=${d.config?.deviceType}  firmware=${d.status?.firmwareVersion ?? d.config?.firmwareVersion}`);
    if (args.full) console.log("  config:", JSON.stringify(d.config, null, 2));
    const interesting = ["siteId", "sampleRate", "channel_1_active", "channel_2_active", "channel_3_active", "channel_4_active"]
      .filter((k) => d.config?.[k] !== undefined)
      .map((k) => `${k}=${d.config[k]}`);
    if (interesting.length) console.log(`  config keys: ${interesting.join("  ")}`);
    if (d.status) console.log(`  status keys: ${Object.keys(d.status).join(",")}`);
  }
  const analogDeviceIds = analogDls.map((d) => d.deviceId);

  // ── 2. work-sensors ─────────────────────────────────────────────────────
  console.log("\n=== 2. work-sensors ===");
  const typed = await db.collection("work-sensors").where("type", "==", "analog_tilt").get();
  console.log(`type=="analog_tilt": ${typed.size}`);

  // Sensors attached to the analog_tilt dataloggers regardless of declared type
  const gwSensors = new Map<string, any>();
  for (const devId of analogDeviceIds) {
    const snap = await db.collection("work-sensors").where("gateway.device", "==", devId).get();
    snap.forEach((d) => gwSensors.set(d.id, d));
  }
  console.log(`gateway.device ∈ analog dataloggers: ${gwSensors.size}`);

  const sensorIds = new Set<string>([...typed.docs.map((d) => d.id), ...gwSensors.keys()]);
  if (!sensorIds.size) console.log("  (none)");

  for (const sid of sensorIds) {
    const doc = typed.docs.find((d) => d.id === sid) ?? gwSensors.get(sid);
    const d = doc.data();
    console.log(`\n● work-sensors/${sid}`);
    console.log(`  title=${d.title ?? d.name}  type=${d.type}  scanin-id=${d["scanin-id"]}`);
    console.log(`  active=${d.active}  esp=${d.esp}  confirmed=${d.confirmed}  created=${fmtTime(d.created?.toMillis?.() ?? d.created)}`);
    console.log(`  location=${JSON.stringify(d.location)}  gateway=${JSON.stringify(d.gateway)}`);
    console.log(`  initial-value=${JSON.stringify(d["initial-value"] ?? null)}  thresholds=${JSON.stringify(d.thresholds ?? null)}`);
    if (args.full) console.log(JSON.stringify(d, null, 2));

    // ── 3. data-log ───────────────────────────────────────────────────────
    const col = db.collection(`work-sensors/${sid}/data-log`);
    const latest = await col.orderBy("time", "desc").limit(n).get();
    const first = await col.orderBy("time", "asc").limit(1).get();
    console.log(`  data-log: latest ${latest.size} shown; oldest=${first.empty ? "—" : fmtTime(first.docs[0].data().time)}`);
    latest.docs.forEach((x) => {
      const { time, timestamp, ...rest } = x.data();
      console.log(`    ${fmtTime(time)}  time=${time} (${typeof time}) ts=${timestamp} ${JSON.stringify(rest)}`);
    });
  }

  // ── 4. devices-types doc ────────────────────────────────────────────────
  console.log("\n=== 4. devices-types/sensors/devices/{analog_tilt,tilt} ===");
  for (const t of ["analog_tilt", "tilt"]) {
    const snap = await db.doc(`devices-types/sensors/devices/${t}`).get();
    if (!snap.exists) {
      console.log(`  ${t}: MISSING`);
      continue;
    }
    const dd = snap.data()!;
    console.log(`  ${t}: exists  type=${dd.type}  chart-axes=${JSON.stringify(dd["chart-axes"] ?? null)}  axes=${dd.axes ? Object.keys(dd.axes).join(",") : "none"}`);
  }

  console.log();
});
