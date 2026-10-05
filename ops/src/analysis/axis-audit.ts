/**
 * Read-only: axis inventory per sensor type — which fields exist in the data, which axes are
 * registered for charts (devices-types chart-axes), which have thresholds, which the alert code
 * actually evaluates today, and which alerted in the last N days. Basis for the axis registry.
 * Scope: active projects, active sensors.
 * Usage: npx tsx src/analysis/axis-audit.ts [--days=60] [--samples=20]
 */
import { db } from "../lib/firebase";
import { num, parseArgs, run } from "../lib/cli";

// Mirror of functions checkThresholds.shouldEvaluateAxis (2026-10-05)
const evaluatedToday = (type: string, axis: string) =>
  type === "vibration_vf" ? axis === "velocity" : type === "prism" ? axis === "HeightDisplacement" || axis === "TwoDDisplacement" : true;
// Mirror of scanin-svc-reports scripts/utils/sensorTypeAxes.js (charted fields, showRaw off)
const REPORT_AXES: Record<string, string[]> = {
  cracktemp: ["x"], crack: ["x"], tilt: ["x", "y"], straingauge: ["x"], loadcell: ["x", "temperature"],
  prism: ["dailyEastingDisplacement", "dailyNorthingDisplacement", "dailySettlement"],
  vibration: ["velocity", "frequency"], "vibration-din": ["velocity", "frequency"], vibration_vf: ["velocity", "frequency"],
};
const NON_AXIS = new Set(["time", "timestamp", "source", "isReplay", "suspect", "suspect_reason", "suspect_axis", "smooth", "eval", "runId", "rowNumber", "metadata", "n", "e", "u"]);

type T = { sensors: number; fields: Map<string, number>; thr: Map<string, number>; alerts: Map<string, number> };

run(async () => {
  const args = parseArgs();
  const days = num(args.days, 60);
  const perSensor = num(args.samples, 20);

  const chartAxes = new Map<string, string[]>();
  (await db.collection("devices-types/sensors/devices").get()).docs.forEach((d) => chartAxes.set(d.id, Object.keys(d.data()["chart-axes"] ?? {})));

  const projects = (await db.collection("projects").where("isActive", "==", true).get()).docs.map((d) => d.id);
  const types = new Map<string, T>();
  const sensorType = new Map<string, string>();
  for (const pid of projects) {
    const sensors = (await db.collection("work-sensors").where("location.site", "==", pid).get()).docs.filter((d) => d.data().active !== false);
    for (const sd of sensors) {
      const s = sd.data();
      const type = s.type || "(none)";
      sensorType.set(sd.id, type);
      sensorType.set(s["scanin-id"] ?? "", type);
      const t = types.get(type) ?? { sensors: 0, fields: new Map(), thr: new Map(), alerts: new Map() };
      t.sensors++;
      Object.entries(s.thresholds?.axes ?? {}).forEach(([ax, v]: [string, any]) => {
        if (v?.warn?.gap || v?.alarm?.gap) t.thr.set(ax, (t.thr.get(ax) ?? 0) + 1);
      });
      const snap = await sd.ref.collection("data-log").orderBy("time", "desc").limit(perSensor).get();
      const seen = new Set<string>();
      snap.docs.filter((d) => !d.id.startsWith("daily::")).forEach((d) =>
        Object.entries(d.data()).forEach(([k, v]) => { if (!NON_AXIS.has(k) && typeof v === "number") seen.add(k); }));
      seen.forEach((k) => t.fields.set(k, (t.fields.get(k) ?? 0) + 1));
      types.set(type, t);
    }
  }

  const since = Date.now() - days * 864e5;
  const alerts = await db.collection("alerts").where("time", ">=", since).get();
  alerts.docs.forEach((d) => {
    const a = d.data();
    const type = sensorType.get(a.sensorDocId) ?? sensorType.get(a.sensor) ?? null;
    if (!type || !a.axis) return;
    const t = types.get(type);
    if (t) t.alerts.set(a.axis, (t.alerts.get(a.axis) ?? 0) + 1);
  });

  console.log(`\nAxis audit — ${projects.length} active projects, alerts last ${days}d. Columns: data = sensors whose recent samples carry the field; chart = in devices-types chart-axes; thr = sensors with warn/alarm gap; evalToday = alert code evaluates it; report = charted in reports; alerts = count.\n`);
  [...types.entries()].sort((a, b) => b[1].sensors - a[1].sensors).forEach(([type, t]) => {
    const ca = chartAxes.get(type) ?? [];
    const axes = new Set([...t.fields.keys(), ...t.thr.keys(), ...ca, ...t.alerts.keys(), ...(REPORT_AXES[type] ?? [])]);
    console.log(`■ ${type} — ${t.sensors} sensors${chartAxes.has(type) ? "" : "  (no devices-types doc!)"}`);
    console.log(`  ${"axis".padEnd(28)} ${"data".padStart(5)} ${"chart".padStart(6)} ${"thr".padStart(5)} ${"evalToday".padStart(9)} ${"report".padStart(7)} ${"alerts".padStart(7)}`);
    [...axes].sort().forEach((ax) =>
      console.log(`  ${ax.padEnd(28)} ${String(t.fields.get(ax) ?? 0).padStart(5)} ${(ca.includes(ax) ? "✓" : "-").padStart(6)} ${String(t.thr.get(ax) ?? 0).padStart(5)} ${(t.thr.get(ax) ? (evaluatedToday(type, ax) ? "✓" : "✗ hidden") : "-").padStart(9)} ${((REPORT_AXES[type] ?? []).includes(ax) ? "✓" : "-").padStart(7)} ${String(t.alerts.get(ax) ?? 0).padStart(7)}`));
    console.log();
  });
});
