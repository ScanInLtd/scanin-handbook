/**
 * Do vibration samples still carry the misspelled `freqeuncy` field? (read-only)
 * For every vibration / vibration-din / vibration_vf sensor: the latest N
 * data-log docs, counted by which spelling they carry, plus the newest time
 * each spelling was seen.
 * Usage: npx tsx src/queries/vibration-frequency-field.ts [--n=200]
 */
import { db } from "../lib/firebase";
import { fmtTime, num, parseArgs, run } from "../lib/cli";

const TYPES = ["vibration", "vibration-din", "vibration_vf"];

run(async () => {
  const n = num(parseArgs().n, 200);
  const totals: Record<string, { sensors: number; docs: number; typo: number; correct: number; both: number; neither: number; lastTypo: number; lastCorrect: number }> = {};

  for (const type of TYPES) {
    const t = (totals[type] = { sensors: 0, docs: 0, typo: 0, correct: 0, both: 0, neither: 0, lastTypo: 0, lastCorrect: 0 });
    const sensors = await db.collection("work-sensors").where("type", "==", type).get();
    t.sensors = sensors.size;
    for (const s of sensors.docs) {
      const snap = await db.collection(`work-sensors/${s.id}/data-log`).orderBy("time", "desc").limit(n).get();
      let sTypo = 0, sCorrect = 0, sLastTypo = 0, sLastCorrect = 0;
      snap.docs.forEach((d) => {
        const x = d.data();
        const time = Number(x.time) || 0;
        const hasTypo = x.freqeuncy !== undefined;
        const hasCorrect = x.frequency !== undefined;
        t.docs++;
        if (hasTypo && hasCorrect) t.both++;
        else if (hasTypo) t.typo++;
        else if (hasCorrect) t.correct++;
        else t.neither++;
        if (hasTypo) { sTypo++; sLastTypo = Math.max(sLastTypo, time); }
        if (hasCorrect) { sCorrect++; sLastCorrect = Math.max(sLastCorrect, time); }
      });
      t.lastTypo = Math.max(t.lastTypo, sLastTypo);
      t.lastCorrect = Math.max(t.lastCorrect, sLastCorrect);
      if (snap.size) {
        console.log(
          `  ${type.padEnd(13)} ${s.id.padEnd(45)} active=${s.data().active !== false}  docs=${snap.size}  freqeuncy=${sTypo} (last ${sLastTypo ? fmtTime(sLastTypo) : "—"})  frequency=${sCorrect} (last ${sLastCorrect ? fmtTime(sLastCorrect) : "—"})`
        );
      }
    }
  }

  console.log("\nTotals (latest docs per sensor):");
  for (const [type, t] of Object.entries(totals)) {
    console.log(
      `  ${type}: ${t.sensors} sensors, ${t.docs} docs — only freqeuncy ${t.typo}, only frequency ${t.correct}, both ${t.both}, neither ${t.neither}; ` +
        `newest freqeuncy ${t.lastTypo ? fmtTime(t.lastTypo) : "—"}, newest frequency ${t.lastCorrect ? fmtTime(t.lastCorrect) : "—"}`
    );
  }
});
