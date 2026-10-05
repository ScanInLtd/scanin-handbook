/**
 * Archive the pre-smoothing threshold alerts: move them from `alerts` to
 * `alerts-archive/{same id}` so no UI screen shows them any more.
 *
 * Why: until Phase 4 (two-tier alerts on the smooth series), checkThresholds
 * evaluated raw samples, so the history is full of alerts fired by raw spikes
 * / bad readings, under thresholds and baselines that have since changed.
 * They now clutter the chart's alert markers, the sensor sidebar, the alerts
 * center, log and timeline. Asked by Hillel (2026-10-05, preview round 2).
 *
 * Scope: type == "threshold", no subType (DIN vibration alerts stay — they're
 * evaluated correctly on peak velocity; the one subType "test" alert stays),
 * no tier (legacy), time < cutoff (default: now, i.e. the moment you run it).
 * Alerts created after the cutoff are untouched (they're what users receive
 * on WhatsApp until Phase 4 is live) — re-run after Phase 4 if wanted.
 *
 * Side effects: none beyond the move — handleAlerts / evaluateMultiSensorRules
 * fire on alerts onCreate only; nothing triggers on alerts-archive. Each
 * archive doc is written before its source is deleted, so an interrupted run
 * leaves duplicates (safe to re-run), never losses.
 *
 * Usage:
 *   npx tsx src/oneoff/2026-10-05-archive-pre-smoothing-alerts.ts                     # dry run
 *   npx tsx src/oneoff/2026-10-05-archive-pre-smoothing-alerts.ts --apply             # move (asks "yes")
 *   npx tsx src/oneoff/2026-10-05-archive-pre-smoothing-alerts.ts --before=2026-10-05T12:00 --apply
 *
 * Undo: --undo [--apply] copies every alerts-archive doc with
 * archiveReason == "pre-smoothing-raw" back to `alerts` (same id, archive
 * fields removed) and deletes it from the archive. A JSON copy of everything
 * moved is also written to ops/out/ before any write.
 */
import fs from "fs";
import path from "path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, fmtTime, parseArgs, run, str } from "../lib/cli";

const REASON = "pre-smoothing-raw";
const SCRIPT = "oneoff/2026-10-05-archive-pre-smoothing-alerts";

async function allDocs(collection: string) {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db.collection(collection).orderBy("__name__").limit(5000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    docs.push(...snap.docs);
    last = snap.docs[snap.docs.length - 1];
  }
  return docs;
}

run(async () => {
  const args = parseArgs();

  // ── Undo ──────────────────────────────────────────────────────────────────
  if (args.undo) {
    const archived = (await allDocs("alerts-archive")).filter((d) => d.data().archiveReason === REASON);
    console.log(`alerts-archive docs with archiveReason=${REASON}: ${archived.length}`);
    if (!archived.length || !(await confirmApply(args, `restore ${archived.length} alerts from alerts-archive back to alerts`))) return;
    const w = new BatchWriter();
    for (const d of archived) {
      const { archivedAt, archiveReason, archivedBy, ...original } = d.data();
      await w.set(db.collection("alerts").doc(d.id), original, false);
      await w.delete(d.ref);
    }
    await w.flush();
    console.log(`✅ restored ${archived.length} alerts`);
    return;
  }

  // ── 1. READ + plan ────────────────────────────────────────────────────────
  const beforeArg = str(args.before);
  const cutoff = beforeArg ? (isNaN(Number(beforeArg)) ? new Date(beforeArg).getTime() : Number(beforeArg)) : Date.now();
  if (isNaN(cutoff)) throw new Error(`bad --before: ${beforeArg}`);

  const docs = await allDocs("alerts");
  const plan = docs.filter((d) => {
    const a = d.data();
    return a.type === "threshold" && a.subType === undefined && a.tier === undefined && typeof a.time === "number" && a.time < cutoff;
  });

  // ── 2. SHOW ───────────────────────────────────────────────────────────────
  const kept = docs.length - plan.length;
  const bySite = new Map<string, number>();
  plan.forEach((d) => {
    const s = d.data().location?.site || "?"; // siteName is "Unknown Site" on every alert
    bySite.set(s, (bySite.get(s) ?? 0) + 1);
  });
  const times = plan.map((d) => d.data().time as number);
  console.log(`alerts: ${docs.length} total → archive ${plan.length}, keep ${kept} (DIN / test / tiered / after cutoff)`);
  console.log(`cutoff: ${fmtTime(cutoff)}`);
  if (plan.length) console.log(`archived range: ${fmtTime(times.reduce((m, t) => Math.min(m, t), Infinity))} … ${fmtTime(times.reduce((m, t) => Math.max(m, t), 0))}`);
  console.log("top sites:");
  [...bySite].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([s, n]) => console.log(`  ${String(n).padStart(6)}  ${s}`));
  console.log("samples:");
  plan.slice(0, 3).forEach((d) => console.log(`  alerts/${d.id} → alerts-archive/${d.id}  ${fmtTime(d.data().time)}  ${d.data().sensor} ${d.data().axis} ${d.data().severity}`));

  // ── 3. GUARD ──────────────────────────────────────────────────────────────
  if (!plan.length || !(await confirmApply(args, `move ${plan.length} legacy threshold alerts (before ${fmtTime(cutoff)}) from alerts to alerts-archive`))) return;

  // Local backup before any write
  const backup = path.resolve(__dirname, `../../out/alerts-archive-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.writeFileSync(backup, JSON.stringify(plan.map((d) => ({ id: d.id, ...d.data() }))));
  console.log(`backup: ${backup}`);

  // ── 4. WRITE: archive copy first, then delete the source ──────────────────
  const w = new BatchWriter();
  for (const d of plan) {
    await w.set(
      db.collection("alerts-archive").doc(d.id),
      { ...d.data(), archivedAt: FieldValue.serverTimestamp(), archiveReason: REASON, archivedBy: SCRIPT },
      false
    );
    await w.delete(d.ref);
  }
  await w.flush();
  console.log(`✅ moved ${plan.length} alerts to alerts-archive (${w.committed} writes)`);
});
