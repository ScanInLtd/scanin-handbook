/**
 * Apply Nathan's level decisions (2026-10-25, review/level-review-2026-10-25.html): per prism, ONE level
 * is the right one; every sample on another level is aligned to it (continuity), and when the chosen
 * level is far from the current zero the sensor gets a new zero on it (else it would read metres off
 * and alarm). Same mechanism as the DeVinci flatten: the sensor's baseline events are replaced by one
 * clean set (old ones archived to baseline-events-deleted), raw values untouched.
 *
 * Per sensor (whole history, ingestion suspects implausible-jump / out-of-range included):
 *   1. levels = lib/levels.ts clustering on the adjusted series (same as the review page); the chosen
 *      level = the one whose median matches Nathan's answer;
 *   2. runs in time order; offset of each run vs the chosen level, chained through the boundaries
 *      (median of the K samples after − K before), chosen runs = 0;
 *   3. zero: chosen level within 60 mm of the current zero → keep initial-value; else the series is
 *      re-zeroed so it starts at 0;
 *   4. events: start of data (reset) + one per run change (reason "iron", continuity:true);
 *   5. simulation: steps left at the boundaries, start and today values.
 * After --apply: recompute the MA for these sensors (printed command, functions repo).
 *
 * Backup first (lib/iron-backup.ts writeBackup, whole history) — refuses to write without it.
 * Undo: npx tsx src/oneoff/2026-10-20-devinci-iron-restore.ts --backup=<file> --apply (restores events
 * + fields; the events written here have notes starting with "iron:").
 *
 * Usage: npx tsx src/oneoff/2026-10-25-level-decisions.ts [--k=6] [--include=NAVON_18,SAVYON_LIVING_3] [--decisions=review/navon-auto-2026-10-26.json] [--apply]
 */
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, fmtTime, num, parseArgs, run } from "../lib/cli";
import { median } from "../lib/signal";
import { type Pt, clusterLevels, periods } from "../lib/levels";
import { writeBackup } from "../lib/iron-backup";

const AXES = ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"];
const BY = "hillel@scanin (oneoff 2026-10-25-level-decisions, Nathan's answers 2026-10-25 / rule decisions 2026-10-26)";
// Nathan's answers: chosen level medians (mm, X/Y/Z, as shown on the review page)
const DECISIONS = [
  { sensorId: "xmXaS7p7cjlRTkoRZhrs", name: "JAFFA_68 1", med: [118, -14, 1832] },
  { sensorId: "AG6010IORg3UCFmN0r3A", name: "JAFFA_68 2", med: [-117, 16, -1829] },
  { sensorId: "XnYw2FlxUawGpur9qXba", name: "NAVON 9", med: [1, 2, 10] },
  { sensorId: "sen-prism-PRISM_JTCS_H0_9B", name: "NAVON 18", med: [27, -89, -2473] },
  { sensorId: "sen-prism-prism_JTCS_H2_3F", name: "SAVYON LIVING 3", med: [2, 1, -1] },
];

run(async () => {
  const args = parseArgs();
  const K = num(args.k, 6);
  const plans: any[] = [];
  // --decisions=review/x.json: [{ sensorId, name, keepAt: ISO }] — chosen level = the one in force at keepAt (rule-based)
  const decisions: any[] = args.decisions ? JSON.parse(require("node:fs").readFileSync(require("node:path").resolve(process.cwd(), String(args.decisions)), "utf8")).items : DECISIONS;

  for (const d of decisions) {
    const s = (await db.doc(`work-sensors/${d.sensorId}`).get()).data()!;
    const evSnap = await db.collection(`work-sensors/${d.sensorId}/baseline-events`).orderBy("time").get();
    const events = evSnap.docs.map((e) => ({ id: e.id, ...(e.data() as any) })).filter((e) => typeof e.time === "number");
    const init0: Record<string, number> = s["initial-value"] ?? {};
    const inForce = (t: number) => { let f: any = null; for (const e of events) if (e.time <= t) f = e; return (f?.initial ?? init0) as Record<string, number>; };
    const snap = await db.collection(`work-sensors/${d.sensorId}/data-log`).orderBy("time").get();
    const rows = snap.docs.filter((x) => !x.id.startsWith("daily::")).map((x) => x.data())
      .filter((x) => typeof x.time === "number" && x.isReplay !== true && x.source !== "replay" && x.source !== "derived:daily")
      .filter((x) => !(x.suspect && x.suspect_reason && !["implausible-jump", "out-of-range"].includes(x.suspect_reason)))
      .map((x) => ({ t: x.time as number, raw: AXES.map((a) => parseFloat(x[a])) }))
      .filter((p) => p.raw.some(Number.isFinite));
    const pts: Pt[] = rows.map((p) => ({ t: p.t, suspect: false, v: p.raw.map((r, k) => r - (Number(inForce(p.t)[AXES[k]]) || 0)) }));
    const lab = clusterLevels(pts);
    const runs = periods(pts, lab);
    const nLev = Math.max(0, ...lab) + 1;
    const levMed = Array.from({ length: nLev }, (_, l) => AXES.map((_, k) => median(pts.filter((_, i) => lab[i] === l).map((p) => p.v[k]).filter(Number.isFinite))));
    const dist = (m: number[]) => Math.max(...m.map((x, k) => Math.abs((Number.isFinite(x) ? x : 0) - d.med[k])));
    const keepRun = d.keepAt ? runs.filter((r) => r.from <= Date.parse(d.keepAt)).pop() : null;
    const chosen = keepRun ? { l: keepRun.level, dd: 0 } : levMed.map((m, l) => ({ l, dd: dist(m) })).sort((a, b) => a.dd - b.dd)[0];
    if (!chosen || chosen.dd > 100) { console.log(`\n${d.name}: chosen level not found (closest ${chosen?.dd?.toFixed(0)} mm) — skipped`); continue; }

    // sample index ranges per run (runs from lib/levels cover labelled samples; noise belongs to the run it falls in)
    const idxOf = (t: number) => rows.findIndex((p) => p.t >= t);
    const rr = runs.map((r) => ({ ...r, i0: idxOf(r.from), i1: rows.findIndex((p) => p.t > r.to) < 0 ? rows.length : rows.findIndex((p) => p.t > r.to) }));
    rr[0].i0 = 0;
    for (let j = 1; j < rr.length; j++) rr[j].i0 = rr[j - 1].i1; // contiguous
    rr[rr.length - 1].i1 = rows.length;
    // offsets are measured on the adjusted series (existing events applied: an ats-setup re-zero is a frame change, not a level)
    const medRaw = (i0: number, i1: number) => AXES.map((_, k) => median(pts.slice(Math.max(0, i0), Math.min(rows.length, i1)).map((p) => p.v[k]).filter(Number.isFinite)));
    // offsets (raw space) of every run vs the chosen level, chained through the boundaries
    // offset of each run = its median − the median of the nearest run on the chosen level (whole runs: robust to noisy edges)
    const runMed = rr.map((r) => medRaw(r.i0, r.i1));
    const chosenRuns = rr.map((r, j) => (r.level === chosen.l ? j : -1)).filter((j) => j >= 0);
    const corr: number[][] = rr.map((r, j) => {
      if (r.level === chosen.l) return [0, 0, 0];
      const ref = chosenRuns.reduce((best, q) => (Math.abs(q - j) < Math.abs(best - j) || (Math.abs(q - j) === Math.abs(best - j) && q < j) ? q : best), chosenRuns[0]);
      return runMed[j].map((m, k) => (Number.isFinite(m - runMed[ref][k]) ? m - runMed[ref][k] : 0));
    });
    // zero for the chosen level
    const farFromZero = levMed[chosen.l].some((m) => Number.isFinite(m) && Math.abs(m) > 60);
    const last = runMed[chosenRuns[chosenRuns.length - 1]]; // new zero = the chosen level's latest stretch
    const Ic = AXES.map((_, k) => (farFromZero && Number.isFinite(last[k]) ? last[k] : 0)); // extra zero shift on top of the existing initial
    // boundaries: run starts + existing events inside the data (kept as their own resets, e.g. ats-setup)
    const runAt = (t: number) => { let j = 0; rr.forEach((r, q) => { if (rows[r.i0].t <= t) j = q; }); return j; };
    const bounds = [...rr.map((r) => ({ time: rows[r.i0].t, kind: "run" as const, reason: "" })),
      ...events.filter((e) => e.time > rows[0].t).map((e) => ({ time: e.time, kind: "existing" as const, reason: e.reason as string }))].sort((a, b) => a.time - b.time);
    const evs = bounds.map((b) => { const j = runAt(b.time), f = inForce(b.time);
        return { time: b.time, kind: b.kind, reason: b.reason, level: rr[j].level, initial: Object.fromEntries(AXES.map((a, k) => [a, Math.round(((Number(f[a]) || 0) + Ic[k] + corr[j][k]) * 100) / 100])) }; })
      .filter((e, j, arr) => j === 0 || e.kind === "existing" || AXES.some((a) => Math.abs(e.initial[a] - arr[j - 1].initial[a]) >= 1));

    // simulation
    const I = (t: number) => { let f = evs[0]; for (const e of evs) if (e.time <= t) f = e; return f.initial; };
    const adj = rows.map((p) => p.raw.map((r, k) => r - I(p.t)[AXES[k]]));
    const stepAt = (i: number) => Math.max(...AXES.map((_, k) => Math.abs(median(adj.slice(i, i + K).map((v) => v[k]).filter(Number.isFinite)) - median(adj.slice(Math.max(0, i - K), i).map((v) => v[k]).filter(Number.isFinite))) || 0));
    const boundarySteps = evs.slice(1).filter((e) => e.kind === "run").map((e) => stepAt(rows.findIndex((p) => p.t >= e.time)));
    const today = AXES.map((_, k) => median(adj.slice(-K).map((v) => v[k]).filter(Number.isFinite)));
    evs.slice(1).filter((e) => e.kind === "run").forEach((e, q) => { const st = boundarySteps[q]; if (st >= 50) console.log(`    ⚠ step ${st.toFixed(0)} mm left at ${fmtTime(e.time).slice(0, 16)} (→ level ${String.fromCharCode(65 + e.level)})`); });
    const startV = AXES.map((_, k) => median(adj.slice(0, K).map((v) => v[k]).filter(Number.isFinite)));
    const within = adj.filter((v) => v.every((x) => !Number.isFinite(x) || Math.abs(x) < 100)).length / adj.length;
    const f = (v: number[]) => v.map((x) => (Number.isFinite(x) ? x.toFixed(1) : "—")).join(" / ");
    console.log(`\n${d.name} (${d.sensorId})  ${rows.length} samples, ${nLev} levels, chosen ${String.fromCharCode(65 + chosen.l)} (median ${f(levMed[chosen.l])}), ${farFromZero ? "NEW ZERO on the chosen level" : "zero kept"}`);
    console.log(`  ${events.length} existing events → archived; ${evs.length} new events (1 start + ${evs.length - 1} iron)`);
    evs.forEach((e) => console.log(`    ${fmtTime(e.time).slice(0, 16)}  ${e.kind === "existing" ? "[" + e.reason + "] " : ""}level ${String.fromCharCode(65 + e.level)}  initial ${f(AXES.map((a) => e.initial[a]))}`));
    console.log(`  simulated: start ${f(startV)} · today ${f(today)} · max step left at a boundary ${Math.max(0, ...boundarySteps).toFixed(1)} mm · ${(within * 100).toFixed(0)} % of samples within ±100 mm`);
    plans.push({ d, events, evs, Ic, ok: Math.max(0, ...boundarySteps) < 50 && today.every((x) => !Number.isFinite(x) || Math.abs(x) < 100) });
  }

  // --include=NAVON_18,SAVYON_LIVING_3: accept plans whose remaining steps sit only inside non-chosen (unstable) stretches
  const include = String(args.include ?? "").split(",").filter(Boolean).map((x) => x.replace(/_/g, " "));
  const ok = plans.filter((p) => p.ok || include.includes(p.d.name.replace(/_/g, " ")));
  console.log(`\n${ok.length}/${plans.length} plans pass (boundary steps < 50 mm, today within ±100 mm): ${ok.map((p) => p.d.name).join(", ")}`);
  if (!ok.length || !(await confirmApply(args, `replace the baseline events of ${ok.length} prisms (${ok.map((p) => p.d.name).join(", ")})`))) return;

  const backup = await writeBackup(ok.map((p) => ({ sensorId: p.d.sensorId, from: 0 })), BY);
  console.log(`💾 backup ${backup.file} (${backup.sensors} sensors, ${backup.docs} docs, sha256 ${backup.sha256.slice(0, 12)})`);
  const w = new BatchWriter();
  for (const p of ok) {
    const sRef = db.collection("work-sensors").doc(p.d.sensorId);
    for (const e of p.events) {
      const { id, ...data } = e;
      await w.set(sRef.collection("baseline-events-deleted").doc(id), { ...data, deletedAt: FieldValue.serverTimestamp(), deletedBy: BY, deleteNote: "level decisions 2026-10-25" }, false);
      await w.delete(sRef.collection("baseline-events").doc(id));
    }
    for (const [j, e] of p.evs.entries()) {
      await w.set(sRef.collection("baseline-events").doc(), {
        time: e.time, initial: e.initial, by: BY, createdAt: FieldValue.serverTimestamp(),
        ...(j === 0 ? { reason: "rebaseline", note: `iron: start of data, level ${String.fromCharCode(65 + e.level)} (Nathan 2026-10-25)` }
          : e.kind === "existing" ? { reason: e.reason, note: `iron: existing ${e.reason} kept, shifted onto the chosen level (Nathan 2026-10-25)` }
          : { reason: "iron", continuity: true, note: `iron: level ${String.fromCharCode(65 + e.level)} aligned to the chosen level (Nathan 2026-10-25)` }),
      }, false);
    }
    const statusAxes: Record<string, string> = {};
    Object.keys((await sRef.get()).data()?.status?.axes ?? {}).forEach((a) => (statusAxes[a] = "ok"));
    await w.update(sRef, { "initial-value": p.evs[p.evs.length - 1].initial, "status.axes": statusAxes, "alert_state.axes": {} });
  }
  await w.flush();
  console.log(`✅ ${w.committed} writes. Next — MA for these sensors (functions repo):`);
  ok.forEach((p) => console.log(`   node scripts/recompute-smoothing.js --sensor=${p.d.sensorId} --days=all --apply`));
});
