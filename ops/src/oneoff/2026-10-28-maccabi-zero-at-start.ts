/**
 * Maccabi Yafo R11–R15: zero each prism at its first usable sample, so the alert thresholds (±4 / ±6 vs
 * initial-value) measure from the same point the report starts from (Hillel 2026-10-28: final settlement
 * −3.3…−3.9 mm, none may cross the threshold). Replaces the baseline events with one "start of data" event
 * (initial = median of the first 6 non-suspect raw samples, E/N/H); old events archived to baseline-events-deleted.
 * initial-value mirrors it; status/alert_state reset. MA recompute afterwards (functions script).
 * Usage: npx tsx src/oneoff/2026-10-28-maccabi-zero-at-start.ts [--apply]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run } from "../lib/cli";
import { median } from "../lib/signal";
import { enc } from "../lib/iron-backup";

const IDS: Record<string, string> = { R11: "ez7QOIidMYCpkqPzqvjE", R12: "mCPL5VROtwlc8by0DFTj", R13: "zoHkA64eoO1BKsdL5Kr4", R14: "6stWmfxjiH3VvBjJ4Fnr", R15: "WsnJcTZnVYHdFFFyqOy9" };
const AXES = ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"];
const BY = "hillel@scanin (oneoff 2026-10-28-maccabi-zero-at-start)";

run(async () => {
  const args = parseArgs();
  const plans: any[] = [];
  for (const [name, id] of Object.entries(IDS)) {
    const s = (await db.collection("work-sensors").doc(id).get()).data()!;
    const ev = await db.collection(`work-sensors/${id}/baseline-events`).get();
    const snap = await db.collection(`work-sensors/${id}/data-log`).orderBy("time").limit(200).get();
    const pts = snap.docs.map((d) => d.data()).filter((x) => typeof x.time === "number" && !x.suspect && !String(x.source ?? "").includes("daily") && AXES.every((a) => Number.isFinite(parseFloat(x[a])))).slice(0, 6);
    const initial: Record<string, number> = { ...(s["initial-value"] ?? {}) };
    AXES.forEach((a) => (initial[a] = Math.round(median(pts.map((p) => parseFloat(p[a]))) * 100) / 100));
    plans.push({ name, id, time: pts[0].time, initial, old: s["initial-value"], oldEvents: ev.docs.map((d) => ({ id: d.id, data: enc(d.data()) })), status: enc(s.status ?? null) });
    console.log(`${name}: first sample ${new Date(pts[0].time).toISOString().slice(0, 16)} · H ${s["initial-value"]?.HeightDisplacement} → ${initial.HeightDisplacement} · E ${s["initial-value"]?.EastingDisplacement} → ${initial.EastingDisplacement} · N ${s["initial-value"]?.NorthingDisplacement} → ${initial.NorthingDisplacement} · old events ${ev.size} → archive`);
  }
  if (!(await confirmApply(args, `zero R11–R15 at their first sample (${plans.length} prisms)`))) return;
  const backup = path.resolve(__dirname, `../../out/maccabi-zero-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify({ by: BY, plans }, null, 1));
  console.log(`💾 ${backup}`);
  const w = new BatchWriter();
  for (const p of plans) {
    const ref = db.collection("work-sensors").doc(p.id);
    for (const e of p.oldEvents) {
      const d = (await ref.collection("baseline-events").doc(e.id).get()).data();
      if (!d) continue;
      await w.set(ref.collection("baseline-events-deleted").doc(e.id), { ...d, deletedAt: FieldValue.serverTimestamp(), deletedBy: BY, deleteNote: "maccabi zero-at-start 2026-10-28" });
      await w.delete(ref.collection("baseline-events").doc(e.id));
    }
    await w.set(ref.collection("baseline-events").doc(), { time: p.time, reason: "rebaseline", initial: p.initial, note: "zero at start of data (Maccabi demo final report)", by: BY, createdAt: FieldValue.serverTimestamp() });
    await w.update(ref, { "initial-value": p.initial, "alert_state.axes": {} });
  }
  await w.flush();
  console.log(`✅ ${w.committed} writes`);
});
