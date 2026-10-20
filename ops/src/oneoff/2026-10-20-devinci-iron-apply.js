/**
 * A4 — apply the DeVinci ironing plan (from 2026-10-20-devinci-iron.ts --backup).
 * Runs from a scanin-svc-firebase-functions build dir (uses its compiled lib/ cores, like 2026-10-06):
 *   cd <functions build dir> && node <handbook>/ops/src/oneoff/2026-10-20-devinci-iron-apply.js <plan.json>
 * Refuses to run unless the plan records a verified backup file that exists.
 * Every event: reason 'rebaseline', note starting with 'iron:' (the restore script deletes exactly those).
 * Undo: ops/src/oneoff/2026-10-20-devinci-iron-restore.ts <backup.json> --apply, or deleteBaseline per event.
 */
const fs = require("fs");
const path = require("path");
const L = (m) => require(path.join(process.cwd(), "lib", m));
const { applyBaseline } = L("setBaseline");

const planFile = process.argv[2];
if (!planFile) { console.error("usage: node 2026-10-20-devinci-iron-apply.js <plan.json>"); process.exit(1); }
const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
if (!plan.backup || !plan.backup.file || !fs.existsSync(plan.backup.file)) {
  console.error("✗ plan has no backup file on disk — run the plan script with --backup first"); process.exit(1);
}
const BY = plan.by || "hillel@scanin (oneoff 2026-10-20-devinci-iron)";
const events = [...plan.events].sort((a, b) => a.sensorId.localeCompare(b.sensorId) || a.time - b.time);
console.log(`backup ${plan.backup.file} (${plan.backup.sensors} sensors, sha256 ${String(plan.backup.sha256).slice(0, 12)})`);
console.log(`applying ${events.length} events…`);

(async () => {
  let ok = 0, fail = 0;
  const log = [];
  for (const [i, e] of events.entries()) {
    try {
      const out = await applyBaseline({ sensorId: e.sensorId, time: e.time, reason: "rebaseline", initial: e.initial, note: e.note }, BY);
      ok++;
      log.push({ ...e, eventId: out.eventId, recompute: out.recompute });
      console.log(`✓ ${i + 1}/${events.length} ${e.name} ${new Date(e.time).toISOString().slice(0, 16)} ${JSON.stringify(e.shift)} → ${out.eventId} (recompute ${JSON.stringify(out.recompute).slice(0, 80)})`);
    } catch (err) {
      fail++;
      log.push({ ...e, error: err.message });
      console.log(`✗ ${i + 1}/${events.length} ${e.name}: ${err.message}`);
    }
  }
  const out = planFile.replace(/\.json$/, "-applied.json");
  fs.writeFileSync(out, JSON.stringify({ appliedAt: new Date().toISOString(), ok, fail, log }, null, 1));
  console.log(`\ndone: ${ok} ok, ${fail} failed · log ${out}`);
  process.exit(fail ? 1 : 0);
})();
