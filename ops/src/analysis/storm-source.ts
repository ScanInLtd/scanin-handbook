/**
 * Read-only: for a sensor, which data-log docs were CREATED in a time window (Firestore createTime),
 * and what sample times / sources / replay flags they carry. Explains alert storms caused by
 * backfills, replays or batch re-ingestion (old samples written "now" fire checkThresholds).
 * Usage: npx tsx src/analysis/storm-source.ts <sensorDocId> --day=2026-09-02
 */
import { db } from "../lib/firebase";
import { parseArgs, run, str } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const id = args._[0];
  const day = str(args.day);
  if (!id || !day) throw new Error("usage: storm-source.ts <sensorDocId> --day=YYYY-MM-DD");
  const start = Date.parse(`${day}T00:00:00Z`);
  const end = start + 864e5;

  const snap = await db.collection(`work-sensors/${id}/data-log`).get();
  const created = snap.docs.filter((d) => {
    const c = d.createTime.toMillis();
    return c >= start && c < end;
  });
  const updated = snap.docs.filter((d) => {
    const u = d.updateTime.toMillis();
    return u >= start && u < end && d.createTime.toMillis() < start;
  });
  console.log(`${id}: ${snap.size} data-log docs total; created on ${day}: ${created.length}; updated (pre-existing) on ${day}: ${updated.length}`);
  const summarize = (docs: typeof created) => {
    const tally = new Map<string, number>();
    let minT = Infinity;
    let maxT = -Infinity;
    docs.forEach((d) => {
      const x = d.data();
      const k = `source=${x.source ?? "-"} isReplay=${x.isReplay ?? "-"} daily=${d.id.startsWith("daily::")}`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
      if (typeof x.time === "number") {
        minT = Math.min(minT, x.time);
        maxT = Math.max(maxT, x.time);
      }
    });
    [...tally].forEach(([k, n]) => console.log(`    ${String(n).padStart(6)}  ${k}`));
    if (docs.length) console.log(`    sample time range: ${new Date(minT).toISOString()} → ${new Date(maxT).toISOString()}`);
  };
  console.log("  created:");
  summarize(created);
  console.log("  updated:");
  summarize(updated);
});
