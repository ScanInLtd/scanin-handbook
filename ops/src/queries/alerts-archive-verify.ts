/**
 * Verify the 2026-10-05 alerts archive (read-only): counts in alerts /
 * alerts-archive, every backed-up id present in the archive and absent from
 * alerts, and no legacy threshold alert older than the cutoff left behind.
 * Usage: npx tsx src/queries/alerts-archive-verify.ts --backup=out/alerts-archive-backup-<ts>.json --cutoff=<ms|ISO>
 */
import fs from "fs";
import path from "path";
import { db } from "../lib/firebase";
import { fmtTime, parseArgs, run, str } from "../lib/cli";

run(async () => {
  const args = parseArgs();
  const backupPath = path.resolve(__dirname, "../..", str(args.backup) ?? "");
  const ids: string[] = JSON.parse(fs.readFileSync(backupPath, "utf8")).map((a: any) => a.id);
  const cutoffArg = str(args.cutoff);
  const cutoff = cutoffArg ? (isNaN(Number(cutoffArg)) ? new Date(cutoffArg).getTime() : Number(cutoffArg)) : Date.now();

  const [alertsCount, archiveCount, archiveReason] = await Promise.all([
    db.collection("alerts").count().get(),
    db.collection("alerts-archive").count().get(),
    db.collection("alerts-archive").where("archiveReason", "==", "pre-smoothing-raw").count().get(),
  ]);
  console.log(`backup ids: ${ids.length}`);
  console.log(`alerts: ${alertsCount.data().count}   alerts-archive: ${archiveCount.data().count} (pre-smoothing-raw: ${archiveReason.data().count})`);

  let inArchive = 0, stillInAlerts = 0;
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const [arch, live] = await Promise.all([
      db.getAll(...chunk.map((id) => db.collection("alerts-archive").doc(id))),
      db.getAll(...chunk.map((id) => db.collection("alerts").doc(id))),
    ]);
    inArchive += arch.filter((d) => d.exists).length;
    stillInAlerts += live.filter((d) => d.exists).length;
  }
  console.log(`backed-up ids in alerts-archive: ${inArchive}/${ids.length}   still in alerts: ${stillInAlerts}`);

  // Anything legacy-threshold older than the cutoff left in alerts?
  const old = await db.collection("alerts").where("time", "<", cutoff).get();
  const leftovers = old.docs.filter((d) => {
    const a = d.data();
    return a.type === "threshold" && a.subType === undefined && a.tier === undefined;
  });
  const kinds = new Map<string, number>();
  old.docs.forEach((d) => {
    const k = `subType=${d.data().subType ?? "—"} tier=${d.data().tier ?? "none"}`;
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  });
  console.log(`alerts before cutoff ${fmtTime(cutoff)}: ${old.size}`, [...kinds]);
  console.log(`legacy threshold alerts left before cutoff: ${leftovers.length}`);
  const newer = await db.collection("alerts").where("time", ">=", cutoff).count().get();
  console.log(`alerts created since the cutoff: ${newer.data().count}`);
});
