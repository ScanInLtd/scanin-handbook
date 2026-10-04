/**
 * Read-only: reconcile an ATS PC event log (CSV export) with what reached Firestore.
 *
 * For every cycle in the log and every monitored point: measured OK / failed / held-as-suspect
 * (from the PC log) vs a data-log sample present for that point's sensor within the cycle window
 * (via ats-device-map/ATS-<station>-<point>).
 *
 * Usage: npx tsx src/analysis/ats-log-vs-db.ts --log=<path.csv> [--station=5] [--site=DeVinci-1]
 */
import * as fs from "node:fs";
import { db } from "../lib/firebase";
import { parseArgs, run, str } from "../lib/cli";

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length >= head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

type PointState = "ok" | "failed" | "suspect" | "ok+suspect";

run(async () => {
  const args = parseArgs();
  const logPath = str(args.log);
  if (!logPath) throw new Error("--log=<csv> required");
  const station = str(args.station) ?? "5";
  const rows = parseCsv(fs.readFileSync(logPath, "utf8")).sort((a, b) => a.time.localeCompare(b.time));

  // ---- cycles from the log
  type Cycle = { id: number; start: number; end: number | null; configured?: number; measuredSummary?: number; published?: number; points: Map<string, PointState> };
  const cycles: Cycle[] = [];
  let cur: Cycle | null = null;
  for (const r of rows) {
    const t = Date.parse(r.time);
    const m = r.message;
    let mm: RegExpMatchArray | null;
    if ((mm = m.match(/^Cycle (\d+) starting: .*?(\d+) monitored/))) {
      cur = { id: +mm[1], start: t, end: null, configured: +mm[2], points: new Map() };
      cycles.push(cur);
    } else if (cur && (mm = m.match(/^Cycle (\d+) ok: .*?(\d+) monitored/))) {
      cur.end = t;
      cur.measuredSummary = +mm[2];
    } else if (cur && (mm = m.match(/^monitored (\S+) measured OK/))) {
      cur.points.set(mm[1], cur.points.get(mm[1]) === "suspect" ? "ok+suspect" : "ok");
    } else if (cur && (mm = m.match(/^monitored (\S+) measurement failed/))) {
      if (!cur.points.has(mm[1])) cur.points.set(mm[1], "failed");
    } else if (cur && (mm = m.match(/^monitored (\S+) result held as suspect/))) {
      cur.points.set(mm[1], cur.points.get(mm[1]) === "ok" ? "ok+suspect" : "suspect");
    } else if ((mm = m.match(/^Published (\d+) message/))) {
      const c = [...cycles].reverse().find((x) => x.start <= t);
      if (c) c.published = +mm[1];
    }
  }
  const complete = cycles.filter((c) => c.end);
  console.log(`\nLog: ${rows.length} events ${rows[0]?.time} → ${rows[rows.length - 1]?.time}; ${complete.length} complete cycles`);

  // ---- DB: map each point → sensor, fetch samples in the log span
  const points = [...new Set(complete.flatMap((c) => [...c.points.keys()]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const from = complete[0].start - 60e3;
  const to = (complete[complete.length - 1].end ?? Date.now()) + 30 * 60e3;
  const info = new Map<string, { sensorId: string | null; sensorName?: string; exists: boolean; active?: boolean; times: number[] }>();
  await Promise.all(points.map(async (p) => {
    const deviceId = `ATS-${station}-${p}`;
    const map = await db.collection("ats-device-map").doc(deviceId).get();
    const sensorId = map.exists ? map.data()!.sensorId : null;
    if (!sensorId) return info.set(p, { sensorId: null, exists: false, times: [] });
    const [s, log] = await Promise.all([
      db.collection("work-sensors").doc(sensorId).get(),
      db.collection(`work-sensors/${sensorId}/data-log`).where("time", ">=", from).where("time", "<=", to).get(),
    ]);
    info.set(p, {
      sensorId, exists: s.exists, sensorName: s.data()?.name, active: s.data()?.active,
      times: log.docs.filter((d) => d.data().source === "ats_live").map((d) => d.data().time),
    });
  }));

  // ---- reconcile
  const sym = { ok: "✔", failed: "✗", suspect: "S", "ok+suspect": "s" } as const;
  const tally = { okInDb: 0, okMissing: 0, failed: 0, suspectInDb: 0, suspectMissing: 0, notMeasured: 0 };
  const perPoint = new Map<string, { ok: number; okMissing: number; failed: number; suspect: number; absent: number }>();
  console.log(`\nLegend per cycle: ✔ measured & in DB | ! measured OK but NOT in DB | ✗ measurement failed | S/s held as suspect (in DB: lower-case) | · not attempted/logged\n`);
  console.log(`${"point".padEnd(6)} ${complete.map((c) => String(c.id).slice(-3).padStart(3)).join("")}   device → sensor`);
  for (const p of points) {
    const inf = info.get(p)!;
    const pp = { ok: 0, okMissing: 0, failed: 0, suspect: 0, absent: 0 };
    const cells = complete.map((c) => {
      const st = c.points.get(p);
      const inDb = inf.times.some((t) => t >= c.start - 60e3 && t <= (c.end ?? c.start) + 30 * 60e3);
      if (!st) { pp.absent++; tally.notMeasured++; return inDb ? "  ?" : "  ·"; }
      if (st === "failed") { pp.failed++; tally.failed++; return "  ✗"; }
      if (st === "suspect" || st === "ok+suspect") { pp.suspect++; inDb ? tally.suspectInDb++ : tally.suspectMissing++; return inDb ? "  s" : "  S"; }
      if (inDb) { pp.ok++; tally.okInDb++; return "  ✔"; }
      pp.okMissing++; tally.okMissing++; return "  !";
    });
    perPoint.set(p, pp);
    const target = !inf.sensorId ? "NO MAP ENTRY" : !inf.exists ? `${inf.sensorId} (SENSOR DOC MISSING)` : `${inf.sensorId} ${inf.sensorName}${inf.active === false ? " [inactive]" : ""}`;
    console.log(`${p.padEnd(6)} ${cells.join("")}   ATS-${station}-${p} → ${target}`);
  }

  console.log(`\nCycles: ${complete.map((c) => `${c.id}: configured ${c.configured}, OK ${c.measuredSummary}, published ${c.published ?? "?"}`).join(" | ")}`);
  console.log(`\nTotals (point×cycle): measured OK & in DB ${tally.okInDb} | measured OK but MISSING in DB ${tally.okMissing} | measurement failed ${tally.failed} | suspect in DB ${tally.suspectInDb} / suspect not in DB ${tally.suspectMissing} | not attempted ${tally.notMeasured}`);
});
