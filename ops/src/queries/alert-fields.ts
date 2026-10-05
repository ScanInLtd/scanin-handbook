/**
 * Alert doc shapes for the chart's alert markers (read-only): does `sensor`
 * hold the sensor's scanin-id, what types are time/sampleTime, which
 * tier/severity values exist, and which tilt sensors have recent alerts.
 * Usage: npx tsx src/queries/alert-fields.ts [--days=30]
 */
import { db } from "../lib/firebase";
import { fmtTime, num, parseArgs, run } from "../lib/cli";

const typeOf = (v: any) => (v === undefined ? "—" : v?.toMillis ? "Timestamp" : typeof v);

run(async () => {
  const args = parseArgs();
  const since = Date.now() - num(args.days, 30) * 864e5;
  const snap = await db.collection("alerts").where("time", ">=", since).orderBy("time", "desc").limit(1000).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>);
  console.log(`${rows.length} alerts since ${fmtTime(since)}`);

  const tally = (f: (r: any) => string) => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(f(r), (m.get(f(r)) ?? 0) + 1));
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  console.log("type:", tally((r) => String(r.type)));
  console.log("tier:", tally((r) => String(r.tier ?? "(none)")));
  console.log("severity:", tally((r) => String(r.severity)));
  console.log("time type:", tally((r) => typeOf(r.time)), " sampleTime type:", tally((r) => typeOf(r.sampleTime)));
  console.log("has axis:", tally((r) => String(r.axis !== undefined)), " has summary:", tally((r) => String(!!r.summary)));

  // `sensor` vs the sensor doc's scanin-id
  const docIds = [...new Set(rows.map((r) => r.sensorDocId).filter(Boolean))] as string[];
  const sensors = new Map<string, any>();
  for (let i = 0; i < docIds.length; i += 100) {
    const refs = docIds.slice(i, i + 100).map((id) => db.collection("work-sensors").doc(id));
    (await db.getAll(...refs)).forEach((s) => s.exists && sensors.set(s.id, s.data()));
  }
  let match = 0, mismatch = 0;
  const examples: string[] = [];
  rows.forEach((r) => {
    const s = sensors.get(r.sensorDocId);
    if (!s) return;
    if (s["scanin-id"] === r.sensor) match++;
    else {
      mismatch++;
      if (examples.length < 5) examples.push(`${r.id}: sensor=${r.sensor} scanin-id=${s["scanin-id"]} docId=${r.sensorDocId}`);
    }
  });
  console.log(`alert.sensor == sensorDoc.scanin-id: ${match} match, ${mismatch} mismatch`, examples);

  // Tilt / crack sensors with alerts (screenshot candidates)
  const byTilt = new Map<string, { n: number; tiers: Set<string>; s: any }>();
  rows.forEach((r) => {
    const s = sensors.get(r.sensorDocId);
    if (!s || !["tilt", "cracktemp", "crack"].includes(s.type)) return;
    const e = byTilt.get(r.sensorDocId) ?? { n: 0, tiers: new Set<string>(), s };
    e.n++;
    e.tiers.add(`${r.tier ?? "legacy"}/${r.severity}/${r.axis}`);
    byTilt.set(r.sensorDocId, e);
  });
  console.log("\nTilt/crack sensors with alerts:");
  [...byTilt].sort((a, b) => b[1].n - a[1].n).slice(0, 12).forEach(([id, e]) =>
    console.log(`  ${String(e.n).padStart(3)}  ${e.s.type}  ${e.s.name}  /sites/${e.s.location?.site}/${e.s.location?.section}/${id}  [${[...e.tiers].join(", ")}]`),
  );

  console.log("\nLatest 3 alerts (raw):");
  rows.slice(0, 3).forEach((r) => {
    const { location, threshold, ...rest } = r;
    console.log(" ", JSON.stringify(rest));
  });
});
