/**
 * Read-only: data-log docs of a sensor whose Firestore updateTime falls in a window,
 * regardless of their `time` field (finds samples stored under an unexpected timestamp).
 * Usage: npx tsx src/analysis/written-between.ts <sensorDocId> --from=<ISO> --to=<ISO>
 */
import { db } from "../lib/firebase";
import { parseArgs, run, str } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const id = args._[0];
  const from = Date.parse(str(args.from) ?? "");
  const to = Date.parse(str(args.to) ?? "");
  if (!id || !Number.isFinite(from) || !Number.isFinite(to)) throw new Error("usage: written-between.ts <sensorId> --from=ISO --to=ISO");
  const snap = await db.collection(`work-sensors/${id}/data-log`).get();
  const hits = snap.docs.filter((d) => {
    const u = d.updateTime.toMillis();
    return u >= from && u <= to;
  });
  console.log(`${id}: ${snap.size} docs, ${hits.length} written between ${new Date(from).toISOString()} and ${new Date(to).toISOString()}`);
  hits.forEach((d) => {
    const x = d.data();
    const t = typeof x.time === "number" ? new Date(x.time).toISOString() : String(x.time);
    console.log(`  id=${d.id}  time=${x.time} (${t})  created=${d.createTime.toDate().toISOString()}  updated=${d.updateTime.toDate().toISOString()}  src=${x.source}  E=${x.EastingDisplacement} N=${x.NorthingDisplacement} H=${x.HeightDisplacement}`);
  });
});
