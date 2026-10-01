/**
 * Dump a sensor's data-log for a time window (table or CSV). Read-only — also usable as a backup.
 * Usage: npx tsx src/queries/data-log.ts <sensorDocId> [--from=7d|YYYY-MM-DD] [--to=YYYY-MM-DD] [--csv] [--daily|--raw]
 *   --csv    write CSV to ops/out/<sensorId>-<timestamp>.csv
 *   --daily  only daily::* aggregates      --raw  only raw samples (default: both)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../lib/firebase";
import { fmtTime, parseArgs, parseWhen, run, str } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const id = args._[0];
  if (!id) throw new Error("usage: data-log.ts <sensorDocId> [--from=] [--to=] [--csv]");

  const from = parseWhen(str(args.from), Date.now() - 7 * 864e5);
  const to = parseWhen(str(args.to), Date.now());
  const snap = await db.collection(`work-sensors/${id}/data-log`).where("time", ">=", from).where("time", "<=", to).orderBy("time").get();

  let docs = snap.docs;
  if (args.daily) docs = docs.filter((d) => d.id.startsWith("daily::"));
  if (args.raw) docs = docs.filter((d) => !d.id.startsWith("daily::"));
  console.log(`work-sensors/${id}/data-log  ${fmtTime(from)} → ${fmtTime(to)}  ${docs.length} docs`);

  if (args.csv) {
    const cols = [...new Set(docs.flatMap((d) => Object.keys(d.data())))].filter((c) => c !== "time").sort();
    const esc = (v: unknown) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = [["docId", "time", "isoTime", ...cols].join(",")];
    docs.forEach((d) => {
      const x = d.data();
      lines.push([d.id, x.time, new Date(x.time).toISOString(), ...cols.map((c) => esc(typeof x[c] === "object" ? JSON.stringify(x[c]) : x[c]))].join(","));
    });
    const outDir = path.resolve(__dirname, "../../out");
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
    fs.writeFileSync(file, lines.join("\n"));
    console.log(`📄 ${file}`);
    return;
  }

  docs.forEach((d) => {
    const { time, ...rest } = d.data();
    console.log(`${fmtTime(time)}  ${d.id.startsWith("daily::") ? d.id + " " : ""}${JSON.stringify(rest)}`);
  });
});
