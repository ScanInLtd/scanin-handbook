/**
 * One sensor's alerts vs its CURRENT config (read-only): explains alert
 * markers that don't line up with today's thresholds / baseline.
 * For each alert: stored adjusted value, raw, the initial value and thresholds
 * used at the time, and the value re-adjusted with today's initial value.
 * Usage: npx tsx src/queries/sensor-alerts-vs-config.ts --sensor=<docId>
 */
import { db } from "../lib/firebase";
import { fmtTime, parseArgs, run, str, toMs } from "../lib/cli";

run(async () => {
  const id = str(parseArgs().sensor);
  if (!id) throw new Error("--sensor=<docId> required");
  const s = (await db.collection("work-sensors").doc(id).get()).data();
  if (!s) throw new Error(`sensor ${id} not found`);
  const initial = s["initial-value"] ?? {};
  console.log(`${s.name} (${s.type}) scanin-id=${s["scanin-id"] ?? "—"}`);
  console.log(`current initial-value: ${JSON.stringify(initial)}`);
  console.log(`current thresholds: ${JSON.stringify(s.thresholds)}`);

  const events = await db.collection(`work-sensors/${id}/baseline-events`).orderBy("time", "asc").get();
  console.log(`baseline-events (${events.size}):`);
  events.docs.forEach((e) => {
    const ev = e.data();
    console.log(`  ${fmtTime(toMs(ev.time))}  ${ev.reason}  ${JSON.stringify(ev.values ?? ev.initial ?? ev.newInitial ?? {})}`);
  });

  const keys = [...new Set([s["scanin-id"], id].filter(Boolean))];
  const snap = await db.collection("alerts").where("sensor", "in", keys).orderBy("time", "desc").limit(200).get();
  console.log(`\n${snap.size} alerts (newest first):`);
  snap.docs.forEach((d) => {
    const a = d.data();
    const raw = Number(a.rawValue);
    const reAdj = !isNaN(raw) && a.axis ? raw - (initial[a.axis] ?? 0) : NaN;
    console.log(
      `  ${fmtTime(a.sampleTime ?? a.time)}  ${a.axis ?? "—"}  ${a.prev_level}→${a.new_level ?? a.severity}  ` +
        `stored=${a.actualValue}  raw=${a.rawValue}  initial@alert=${a.initialValue}  ` +
        `→ with today's initial=${isNaN(reAdj) ? "—" : reAdj.toFixed(4)}  thr@alert=${JSON.stringify(a.threshold)}` +
        `${a.sampleTime ? "" : "  (no sampleTime)"}`,
    );
  });
});
