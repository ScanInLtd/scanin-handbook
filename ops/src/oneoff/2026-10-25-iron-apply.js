/**
 * Apply an iron plan (from 2026-10-25-iron-approved.ts --backup) — generic successor of
 * 2026-10-20-devinci-iron-apply.js. Events get reason "iron" (functions stamp continuity:true, so the
 * MA window spans them) and a note starting with "iron:" (the restore script deletes exactly those).
 * applyBaseline recomputes smooth/eval from each event's time.
 *
 * Runs from a scanin-svc-firebase-functions build dir (uses its compiled lib/ cores):
 *   cd <functions> && GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud-scanin/application_default_credentials.json \
 *     node <handbook>/ops/src/oneoff/2026-10-25-iron-apply.js <plan.json>
 * Refuses to run unless the plan records a backup file that exists.
 * Undo: npx tsx src/oneoff/2026-10-20-devinci-iron-restore.ts --backup=<backup.json> --apply
 */
const fs = require("fs");
const path = require("path");
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "dataloggerdev";
const L = (m) => require(path.join(process.cwd(), "lib", m));
const { applyBaseline } = L("setBaseline");

const planFile = process.argv[2];
if (!planFile) { console.error("usage: node 2026-10-25-iron-apply.js <plan.json>"); process.exit(1); }
const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
if (!plan.backup || !plan.backup.file || !fs.existsSync(plan.backup.file)) {
  console.error("✗ plan has no backup file on disk — run the plan script with --backup first"); process.exit(1);
}
const BY = plan.by || "hillel@scanin (oneoff 2026-10-25-iron-apply)";
const events = [...plan.events].sort((a, b) => a.sensorId.localeCompare(b.sensorId) || a.time - b.time);
console.log(`backup ${plan.backup.file} (${plan.backup.sensors} sensors, sha256 ${String(plan.backup.sha256).slice(0, 12)})`);
console.log(`applying ${events.length} events…`);

(async () => {
  let ok = 0, fail = 0;
  const log = [];
  for (const [i, e] of events.entries()) {
    try {
      const out = await applyBaseline({ sensorId: e.sensorId, time: e.time, reason: "iron", initial: e.initial, note: e.note }, BY);
      ok++;
      log.push({ ...e, eventId: out.eventId, recompute: out.recompute });
      console.log(`✓ ${i + 1}/${events.length} ${e.project} "${e.name}" ${new Date(e.time).toISOString().slice(0, 16)} ${JSON.stringify(e.shift)} → ${out.eventId} (recompute ${JSON.stringify(out.recompute).slice(0, 100)})`);
    } catch (err) {
      fail++;
      log.push({ ...e, error: err.message });
      console.log(`✗ ${i + 1}/${events.length} ${e.name}: ${err.message}`);
    }
  }
  const out = planFile.replace(/\.json$/, "-applied.json");
  fs.writeFileSync(out, JSON.stringify({ appliedAt: new Date().toISOString(), ok, fail, log }, null, 1));
  console.log(`\n${ok} applied, ${fail} failed → ${out}`);
  process.exit(fail ? 1 : 0);
})();
