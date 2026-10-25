/**
 * Send the DeVinci report (REP141, ReportConfig/Nn5D8EIN9shaaSvhCqPO) once to
 * Hillel only, without touching Nathan's config (asked by Hillel 2026-10-24,
 * after Nathan's 23.10 run: see inbox/20261024-1930-report-email-skipped-status.md).
 *
 * How: a temporary copy of the config with recipients = [hillelvidal@gmail.com]
 * is run through the same orchestrator "Run Now" endpoint the UI uses
 * (POST /run-report/:id), then the copy is deleted. The original config, its
 * status and its recipients are not modified.
 *
 * Usage:
 *   npx tsx src/oneoff/2026-10-24-send-rep141-to-hillel.ts            # dry run
 *   npx tsx src/oneoff/2026-10-24-send-rep141-to-hillel.ts --apply    # create copy, run, delete (asks "yes")
 *
 * Undo: nothing persists — the temporary doc is deleted at the end (also on failure).
 * If the script dies mid-way, delete ReportConfig/<TEMP_ID> by hand.
 */
import { db } from "../lib/firebase";
import { confirmApply, parseArgs, run } from "../lib/cli";

const SOURCE_ID = "Nn5D8EIN9shaaSvhCqPO";
const TEMP_ID = `${SOURCE_ID}-tmp-hillel-20261024`;
const RECIPIENT = { email: "hillelvidal@gmail.com", name: "Hillel" };
const ORCHESTRATOR = "https://reports-orchestrator-hqaprow6pq-uc.a.run.app";

// run-state fields of the source that must not be copied
const RUN_STATE = [
  "lastStatus", "lastStatusTime", "lastStatusDetails", "lastRunTime", "runStartedAt",
  "progress", "cancelRequested", "cancelRequestedAt", "lastInteractedBy",
];

run(async () => {
  const args = parseArgs();
  const src = await db.collection("ReportConfig").doc(SOURCE_ID).get();
  if (!src.exists) throw new Error(`ReportConfig/${SOURCE_ID} not found`);
  const data = { ...src.data()! };
  RUN_STATE.forEach((k) => delete data[k]);
  const copy = {
    ...data,
    active: true,
    schedule: "manual",
    recipients: { users: [], emails: [RECIPIENT] },
    tempCopyOf: SOURCE_ID,
    createdBy: "oneoff/2026-10-24-send-rep141-to-hillel",
  };

  console.log(`source: ReportConfig/${SOURCE_ID}  "${data.reportName}" (${data.reportId})  period ${JSON.stringify(data.period)}`);
  console.log(`  source recipients (unchanged): ${JSON.stringify(src.data()!.recipients)}`);
  console.log(`temp copy: ReportConfig/${TEMP_ID}  recipients → ${RECIPIENT.email}`);
  console.log(`run: POST ${ORCHESTRATOR}/run-report/${TEMP_ID}  (then the copy is deleted)`);

  if (!(await confirmApply(args, `create temp ReportConfig/${TEMP_ID}, run it (emails ${RECIPIENT.email} only), delete it`))) return;

  const ref = db.collection("ReportConfig").doc(TEMP_ID);
  await ref.set(copy);
  console.log("✅ temp copy created — running (≈2–3 min)…");
  const t0 = Date.now();
  try {
    const res = await fetch(`${ORCHESTRATOR}/run-report/${TEMP_ID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await res.text();
    console.log(`orchestrator: HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s  ${body.slice(0, 300)}`);
    const after = (await ref.get()).data() || {};
    console.log(`temp status: ${after.lastStatus}  details: ${JSON.stringify(after.lastStatusDetails ?? null)}`);
  } finally {
    await ref.delete();
    console.log(`🧹 temp copy deleted (ReportConfig/${TEMP_ID})`);
  }
});
