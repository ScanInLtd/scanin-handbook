/**
 * Read-only: who generates the alerts? Fleet inventory + alert volume by type / sensor / axis.
 * Usage: npx tsx src/analysis/alert-landscape.ts [--since=60d] [--top=25] [--json]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../lib/firebase";
import { num, parseArgs, parseWhen, run, str } from "../lib/cli";
import { sensorLabel } from "../lib/sensors";

run(async () => {
  const args = parseArgs();
  const since = parseWhen(str(args.since) ?? "60d", 0);
  const days = (Date.now() - since) / 864e5;

  const sensorsSnap = await db
    .collection("work-sensors")
    .select("type", "name", "scanin-id", "MAC", "location", "thresholds", "options", "active", "status", "initial-value")
    .get();
  const sensors = new Map(sensorsSnap.docs.map((d) => [d.id, d.data()]));

  // ---- Fleet inventory by type
  const byType = new Map<string, { n: number; withThr: number; ema: number; inAlert: number }>();
  for (const s of sensors.values()) {
    const t = s.type || "(none)";
    const e = byType.get(t) ?? { n: 0, withThr: 0, ema: 0, inAlert: 0 };
    e.n++;
    if (s.thresholds?.axes && Object.keys(s.thresholds.axes).length) e.withThr++;
    if (s.options?.movingAverage?.enabled) e.ema++;
    if (Object.values(s.status?.axes ?? {}).some((v) => v !== "ok")) e.inAlert++;
    byType.set(t, e);
  }
  console.log(`\n━━ Fleet: ${sensors.size} sensors ━━`);
  console.log("type".padEnd(22), "count", "w/thr", "ema", "now warn/alarm");
  [...byType].sort((a, b) => b[1].n - a[1].n).forEach(([t, e]) => console.log(t.padEnd(22), String(e.n).padStart(5), String(e.withThr).padStart(5), String(e.ema).padStart(4), String(e.inAlert).padStart(8)));

  // ---- Alerts
  const alertsSnap = await db.collection("alerts").where("time", ">=", since).select("type", "subType", "sensorDocId", "axis", "severity", "prev_level", "new_level", "time", "siteName", "location").get();
  const alerts = alertsSnap.docs.map((d) => d.data());
  console.log(`\n━━ Alerts since ${new Date(since).toISOString().slice(0, 10)} (${days.toFixed(0)}d): ${alerts.length} (${(alerts.length / days).toFixed(1)}/day) ━━`);

  const group = <K extends string>(keyFn: (a: any) => K) => {
    const m = new Map<K, number>();
    alerts.forEach((a) => m.set(keyFn(a), (m.get(keyFn(a)) ?? 0) + 1));
    return [...m].sort((a, b) => b[1] - a[1]);
  };

  console.log("\nBy alert type/subType:");
  group((a) => `${a.type}/${a.subType ?? "-"}`).forEach(([k, n]) => console.log(`  ${String(n).padStart(6)}  ${k}`));

  console.log("\nBy sensor type (threshold alerts):");
  group((a) => (a.type === "threshold" ? sensors.get(a.sensorDocId)?.type ?? "(deleted)" : "(non-threshold)")).forEach(([k, n]) => console.log(`  ${String(n).padStart(6)}  ${k}`));

  console.log("\nBy severity / transition:");
  group((a) => `${a.prev_level ?? "?"}→${a.new_level ?? a.severity ?? "?"}`).forEach(([k, n]) => console.log(`  ${String(n).padStart(6)}  ${k}`));

  console.log("\nBy site:");
  group((a) => a.siteName ?? a.location?.siteName ?? "?").slice(0, 15).forEach(([k, n]) => console.log(`  ${String(n).padStart(6)}  ${k}`));

  // ---- Storms vs genuine: an alert is a "burst" if the same sensor+axis alerted < 60 min before
  // (impossible under the 24h throttle → concurrent trigger race, typically backfill / replay / ATS batch)
  const sortedA = [...alerts].sort((a, b) => a.time - b.time);
  const lastAt = new Map<string, number>();
  const genuine: any[] = [];
  let burst = 0;
  const perDay = new Map<string, { all: number; burst: number }>();
  for (const a of sortedA) {
    const k = `${a.sensorDocId}|${a.axis}`;
    const isBurst = lastAt.has(k) && a.time - lastAt.get(k)! < 60 * 6e4;
    lastAt.set(k, a.time);
    if (isBurst) burst++;
    else genuine.push(a);
    const day = new Date(a.time).toISOString().slice(0, 10);
    const e = perDay.get(day) ?? { all: 0, burst: 0 };
    e.all++;
    if (isBurst) e.burst++;
    perDay.set(day, e);
  }
  console.log(`\nThrottle-violating bursts (same sensor+axis < 60 min apart): ${burst} of ${alerts.length} (${((burst / alerts.length) * 100).toFixed(0)}%)`);
  console.log(`Genuine-looking alerts: ${alerts.length - burst} (${((alerts.length - burst) / days).toFixed(1)}/day)`);
  console.log("\nPer day (all / burst):");
  [...perDay].forEach(([d, e]) => console.log(`  ${d} ${String(e.all).padStart(5)} ${String(e.burst).padStart(5)}  ${"█".repeat(Math.min(Math.round((e.all - e.burst) / 2), 60))}`));

  const top = num(args.top, 25);
  if (!args["include-bursts"]) {
    alerts.length = 0;
    alerts.push(...genuine);
    console.log(`\n(Below: genuine alerts only — pass --include-bursts for all)`);
    console.log("\nGenuine by sensor type:");
    group((a) => (a.type === "threshold" ? sensors.get(a.sensorDocId)?.type ?? "(deleted)" : "(non-threshold)")).forEach(([k, n]) => console.log(`  ${String(n).padStart(6)}  ${k}`));
  }
  const bySensor = group((a) => `${a.sensorDocId}|${a.axis ?? "-"}`);
  const distinctSensors = new Set(alerts.map((a) => a.sensorDocId)).size;
  const cum = (k: number) => bySensor.slice(0, k).reduce((s, [, n]) => s + n, 0);
  console.log(`\nConcentration: ${distinctSensors} sensors alerted; top 10 sensor-axes = ${((cum(10) / alerts.length) * 100).toFixed(0)}% of alerts, top 30 = ${((cum(30) / alerts.length) * 100).toFixed(0)}%`);
  console.log(`\nTop ${top} sensor/axis:`);
  const topRows = bySensor.slice(0, top).map(([k, n]) => {
    const [id, axis] = k.split("|");
    const s = sensors.get(id) ?? {};
    const thr = s.thresholds?.axes?.[axis];
    return { id, axis, n, type: s.type, label: sensorLabel(s, id), site: s.location?.siteName ?? "", warn: thr?.warn?.gap, alarm: thr?.alarm?.gap, ema: !!s.options?.movingAverage?.enabled };
  });
  topRows.forEach((r) => console.log(`  ${String(r.n).padStart(5)}  ${String(r.type).padEnd(16)} ${String(r.label).padEnd(18)} ${r.axis.padEnd(22)} warn=±${r.warn ?? "?"} alarm=±${r.alarm ?? "?"}  ${r.site}  ${r.id}${r.ema ? "  [ema]" : ""}`));

  if (args.json) {
    const out = path.resolve(__dirname, "../../out/alert-landscape.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ since, total: alerts.length, top: topRows }, null, 2));
    console.log(`\n📄 ${out}`);
  }
  console.log();
});
