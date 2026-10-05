/**
 * Signal & Alerts UI acceptance (read-only): verify the stored `smooth` data
 * that the preview charts plot — pilot sites, windows, TwoD, suspects,
 * baseline events, and >90d coverage.
 * Usage: npx tsx src/queries/smooth-ui-verify.ts
 */
import { db } from "../lib/firebase";
import { fmtTime, run, toMs } from "../lib/cli";

const ZEITLIN = "oBcqejjRiLRIFhG2UzPI"; // צייטלין 12
const DEVINCI = "hmPh7Hg2fjTc9GyNRDYO"; // מגדל דה וינצי דרום

async function inspectSensor(id: string, label: string, axes: string[], n = 8) {
  console.log(`\n── ${label} (${id}) ──`);
  const sensor = await db.collection("work-sensors").doc(id).get();
  if (!sensor.exists) {
    console.log("  ❌ sensor not found");
    return;
  }
  const d = sensor.data()!;
  console.log(`  name: ${d.name ?? d["scanin-id"]}  type: ${d.type}  initial-value: ${JSON.stringify(d["initial-value"] ?? null)}`);
  console.log(`  chart: /sites/${d.location?.site}/${d.location?.section}/${id}`);

  // Baseline events
  const events = await db.collection(`work-sensors/${id}/baseline-events`).orderBy("time", "asc").get();
  console.log(`  baseline-events: ${events.size}`);
  events.docs.slice(0, 4).forEach((e) => {
    const ev = e.data();
    console.log(`    ${ev.reason} @ ${fmtTime(toMs(ev.time))} by ${ev.by ?? "—"}`);
  });

  // Latest samples: smooth presence / w / values, suspect, replay
  const snap = await db.collection(`work-sensors/${id}/data-log`).orderBy("time", "desc").limit(n * 3).get();
  const docs = snap.docs.filter((x) => !x.id.startsWith("daily::")).slice(0, n);
  console.log(`  latest ${docs.length} samples (newest first):`);
  docs.forEach((doc) => {
    const s = doc.data();
    const smoothStr = s.smooth
      ? `smooth{w:${s.smooth.w ?? "—"}, n:${s.smooth.n}, q:${s.smooth.q}, ` +
        axes.map((a) => `${a}:${s.smooth[a] !== undefined ? Number(s.smooth[a]).toFixed(4) : "—"}`).join(", ") + `}`
      : "NO SMOOTH";
    const flags = [s.suspect ? `SUSPECT(${s.suspect_reason})` : "", s.isReplay ? "REPLAY" : ""].filter(Boolean).join(" ");
    const rawStr = axes.map((a) => `${a}:${s[a] !== undefined ? Number(s[a]).toFixed(4) : "—"}`).join(", ");
    console.log(`    ${fmtTime(toMs(s.time))}  raw{${rawStr}}  ${smoothStr} ${flags}`);
  });

  // Coverage: does smooth exist ~95 days back? (expect NO — backfill is 90d)
  const old = await db
    .collection(`work-sensors/${id}/data-log`)
    .where("time", "<", Date.now() - 95 * 24 * 3600 * 1000)
    .orderBy("time", "desc")
    .limit(10)
    .get();
  const oldReal = old.docs.filter((x) => !x.id.startsWith("daily::"));
  const oldWithSmooth = oldReal.filter((x) => x.data().smooth).length;
  console.log(`  >95d-old samples: ${oldReal.length} checked, ${oldWithSmooth} with smooth (expect 0 until full-history fill)`);

  // Smooth coverage in the last 14 days
  const recent = await db
    .collection(`work-sensors/${id}/data-log`)
    .where("time", ">", Date.now() - 14 * 24 * 3600 * 1000)
    .get();
  const real = recent.docs.filter((x) => !x.id.startsWith("daily::"));
  const withSmooth = real.filter((x) => x.data().smooth).length;
  const suspects = real.filter((x) => x.data().suspect === true).length;
  console.log(`  last 14d: ${real.length} samples, ${withSmooth} with smooth (${real.length ? Math.round((100 * withSmooth) / real.length) : 0}%), ${suspects} suspect`);
}

run(async () => {
  // Pick pilot sensors: one tilt + one crack at Zeitlin, prism A11 + a JTCS-style suspect-rich prism at DeVinci
  const [zeitlinSensors, devinciSensors] = await Promise.all([
    db.collection("work-sensors").where("location.site", "==", ZEITLIN).get(),
    db.collection("work-sensors").where("location.site", "==", DEVINCI).get(),
  ]);

  const tilt = zeitlinSensors.docs.find((s) => s.data().type === "tilt" && s.data().active !== false);
  const crack = zeitlinSensors.docs.find((s) => (s.data().type || "").startsWith("crack") && s.data().active !== false);
  const prismA11 = devinciSensors.docs.find((s) => (s.data().name || "").includes("A11") && s.data().type === "prism")
    ?? devinciSensors.docs.find((s) => s.data().type === "prism");

  console.log(`צייטלין 12: ${zeitlinSensors.size} sensors; דה וינצי דרום: ${devinciSensors.size} sensors`);

  if (tilt) await inspectSensor(tilt.id, `TILT ${tilt.data().name}`, ["x", "y"]);
  if (crack) await inspectSensor(crack.id, `CRACK ${crack.data().name}`, ["x", "temp"]);
  if (prismA11)
    await inspectSensor(prismA11.id, `PRISM ${prismA11.data().name}`, [
      "EastingDisplacement",
      "NorthingDisplacement",
      "HeightDisplacement",
      "TwoDDisplacement",
    ]);

  // Suspect-rich JTCS prism
  const jtcs = await db.collection("work-sensors").where("scanin-id", "==", "sen-prism-PRISM_JTCS_H0_12B").get();
  if (!jtcs.empty) {
    await inspectSensor(jtcs.docs[0].id, `PRISM (suspect-rich) ${jtcs.docs[0].data().name}`, ["TwoDDisplacement", "HeightDisplacement"]);
  } else {
    console.log("\n(JTCS prism sen-prism-PRISM_JTCS_H0_12B not found by scanin-id)");
    const candidates = devinciSensors.docs.filter((s) =>
      JSON.stringify([s.id, s.data().name, s.data()["scanin-id"]]).toUpperCase().includes("JTCS"),
    );
    console.log(`  DeVinci sensors matching "JTCS": ${candidates.map((s) => `${s.id} (${s.data().name})`).join(", ") || "none"}`);
    if (candidates[0])
      await inspectSensor(candidates[0].id, `PRISM (JTCS) ${candidates[0].data().name}`, ["TwoDDisplacement", "HeightDisplacement"]);
  }
  await inspectSensor("sen-prism-prism9", "PRISM (suspect-rich) prism9", ["TwoDDisplacement", "HeightDisplacement"], 4);
});
