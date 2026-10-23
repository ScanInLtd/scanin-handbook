/**
 * REP141 (DeVinci, ReportConfig/Nn5D8EIN9shaaSvhCqPO): no gaps, no baseline / alert markers, UI y-scale.
 * Sets connectGaps=true, showBaselineMarkers=false, showAlertMarkers=false, useUiScale=true
 * (reports `a8ab57e` / `9f6293b`). Prints the previous values (undo = write them back).
 * Usage: npx tsx src/oneoff/2026-10-23-devinci-report-options.ts [--apply]
 */
import { db } from "../lib/firebase";
import { confirmApply, parseArgs, run } from "../lib/cli";

const ID = "Nn5D8EIN9shaaSvhCqPO";
const SET = { connectGaps: true, showBaselineMarkers: false, showAlertMarkers: false, useUiScale: true };

run(async () => {
  const args = parseArgs();
  const ref = db.collection("ReportConfig").doc(ID);
  const d = (await ref.get()).data();
  if (!d) throw new Error(`ReportConfig/${ID} not found`);
  console.log(`ReportConfig/${ID} "${d.reportName}" (${d.reportId})`);
  for (const [k, v] of Object.entries(SET)) console.log(`  ${k}: ${JSON.stringify(d[k] ?? null)} → ${JSON.stringify(v)}`);
  if (!(await confirmApply(args, `set ${Object.keys(SET).join(", ")} on ${d.reportId}`))) return;
  await ref.update({ ...SET, updatedAt: new Date().toISOString(), updatedBy: "oneoff 2026-10-23-devinci-report-options" });
  console.log("✅ updated");
});
