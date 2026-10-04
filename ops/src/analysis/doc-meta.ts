/**
 * Read-only: Firestore create/update times of data-log docs in a sample-time window
 * (detects overwrites: a doc whose updateTime is much later than its sample time).
 * Usage: npx tsx src/analysis/doc-meta.ts <sensorDocId> --from=<ISO> --to=<ISO>
 */
import { db } from "../lib/firebase";
import { parseArgs, parseWhen, run, str } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const id = args._[0];
  const from = parseWhen(str(args.from), Date.now() - 864e5);
  const to = parseWhen(str(args.to), Date.now());
  const snap = await db.collection(`work-sensors/${id}/data-log`).where("time", ">=", from).where("time", "<=", to).orderBy("time").get();
  snap.docs.forEach((d) => {
    const x = d.data();
    console.log(`${d.id.padEnd(22)} sample=${new Date(x.time).toISOString()}  created=${d.createTime.toDate().toISOString()}  updated=${d.updateTime.toDate().toISOString()}  src=${x.source ?? "-"}`);
  });
});
