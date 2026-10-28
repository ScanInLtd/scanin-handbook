/**
 * REP136 (Maccabi Yafo, ReportConfig/QpaWmsa4k2uOA1TjmVBN): period end → 2026-10-28 (final demo report).
 * Usage: npx tsx src/oneoff/2026-10-28-maccabi-rep136-period.ts [--apply]
 */
import { db } from "../lib/firebase";
import { confirmApply, parseArgs, run } from "../lib/cli";

const ID = "QpaWmsa4k2uOA1TjmVBN";

run(async () => {
  const args = parseArgs();
  const ref = db.collection("ReportConfig").doc(ID);
  const d = (await ref.get()).data()!;
  const period = { ...(d.period ?? {}), type: "absolute", startDate: d.period?.startDate ?? "2026-05-20", endDate: "2026-10-28" };
  console.log(`${d.reportId} "${d.reportName}" period ${JSON.stringify(d.period)} → ${JSON.stringify(period)}`);
  if (!(await confirmApply(args, `set ${d.reportId} period end 2026-10-28`))) return;
  await ref.update({ period, updatedAt: new Date().toISOString(), updatedBy: "oneoff 2026-10-28-maccabi-rep136-period" });
  console.log("✅ updated");
});
