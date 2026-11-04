/**
 * Read-only: for the given sensors, show baseline events plus suspect/smooth
 * state of samples after each event — to see what setBaseline+recompute did.
 * Usage: ./go.sh run src/queries/check-baseline-aftermath.ts --site=<projectId> --names=5,6
 */
import { db } from "../lib/firebase";
import { parseArgs, str, toMs, run } from "../lib/cli";
import { sensorLabel } from "../lib/sensors";

const args = parseArgs();
const siteArg = str(args.site)!;
const names = new Set(String(str(args.names) ?? "").split(",").map(s => s.trim()));

run(async () => {
  let siteId = siteArg;
  if (!(await db.collection("projects").doc(siteArg).get()).exists) {
    const hit = (await db.collection("projects").get()).docs.find(d => JSON.stringify(d.data()).includes(siteArg));
    if (!hit) throw new Error(`No project matching "${siteArg}"`);
    siteId = hit.id;
  }
  console.log(`site=${siteId}`);
  const sensors = (await db.collection("work-sensors").where("location.site", "==", siteId).get()).docs
    .filter(d => names.size === 0 || names.has(String(d.data().name ?? "")) || names.has(String(d.data()["scanin-id"] ?? "")));
  for (const doc of sensors) {
    const s = doc.data();
    console.log(`\n=== ${sensorLabel(s, doc.id)} (${doc.id}) initial-value=${JSON.stringify(s["initial-value"])}`);
    const events = (await doc.ref.collection("baseline-events").orderBy("time", "asc").get()).docs
      .map(d => d.data());
    for (const e of events.slice(-4)) {
      const t = toMs(e.time)!;
      console.log(`  event ${new Date(t).toISOString()} reason=${e.reason} continuity=${e.continuity === true} initial=${JSON.stringify(e.initial)} note=${e.note ?? ""} by=${e.by ?? ""} created=${e.createdAt ? new Date(toMs(e.createdAt)!).toISOString() : "?"}`);
      const after = await doc.ref.collection("data-log").where("time", ">=", t).where("time", "<=", t + 14 * 86400000).get();
      let n = 0, suspect = 0, withSmooth = 0;
      for (const d of after.docs) {
        if (d.id.startsWith("daily::") || d.data().source === "derived:daily" || d.data().isReplay) continue;
        n++; if (d.data().suspect) suspect++; if (d.data().smooth) withSmooth++;
      }
      console.log(`    +14d: ${n} samples, ${suspect} suspect, ${withSmooth} with MA (${n ? Math.round(withSmooth / n * 100) : 0}%)`);
    }
    const latest = await doc.ref.collection("data-log").orderBy("time", "desc").limit(12).get();
    for (const d of latest.docs.reverse()) {
      const x = d.data();
      if (d.id.startsWith("daily::") || x.source === "derived:daily") continue;
      console.log(`    last ${new Date(x.time).toISOString()} suspect=${x.suspect ?? false} reason=${x.suspect_reason ?? ""} smooth=${x.smooth ? "yes" : "no"} eval=${JSON.stringify(x.eval ?? {})}`);
    }
  }
});
