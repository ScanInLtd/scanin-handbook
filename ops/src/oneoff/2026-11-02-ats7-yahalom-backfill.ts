/**
 * Copy ats-7 ("yahalom" station) resent samples onto the legacy sensors they
 * continue, so each prism's history is whole again.
 *
 * Context: the new Savyon-office ATS PC published as `ats7` (no hyphen) and
 * every message was dropped by the bridge until ~2026-11-02 15:40. After the
 * device id was fixed to `ats-7`, the station republished all stored cycles;
 * the bridge auto-created `ATS.yahalom.<point>` sensors (site "yahalom",
 * unconfirmed). Nathan confirmed these are the same physical prisms the old
 * Hexagon ATS machine measured (verified: inter-point distances match to ~mm).
 * This script copies each backfilled sample (doc id = timestamp ms, same as
 * the bridge writes) into the mapped legacy sensor's data-log. Samples >48h
 * old never alert; they carry gateway_id so isAtsFed suppresses late-data
 * notices. Idempotent — existing doc ids are skipped.
 *
 * After this: run functions/scripts/recompute-smoothing.js --sensor=<id>
 * --days=16 --apply per target to rebuild `smooth` over the gap.
 * The ats-device-map reassignment itself is Nathan's action in the UI.
 *
 * Usage:
 *   npx tsx src/oneoff/2026-11-02-ats7-yahalom-backfill.ts           # dry run
 *   npx tsx src/oneoff/2026-11-02-ats7-yahalom-backfill.ts --apply
 *
 * Undo: delete the copied docs — they are the docs in the target data-logs
 *   whose ids are listed by the dry run (all have source:"ats_live",
 *   gateway_id:"ats-7", and times >= 2026-10-21).
 */
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run } from "../lib/cli";

// ats-7 point -> { src: yahalom sensor doc id, dst: legacy sensor doc id, label }
const PAIRS: { point: string; src: string; dst: string; label: string }[] = [
  { point: "H0P2A", src: "YjpHDoE5Ywky0WUmjTWa", dst: "2SAma7OXG38LBmdZkt8e", label: 'navon "3"' },
  { point: "H0P2B", src: "IDCyLtuqgeWy5QaIss1c", dst: "BvFFi6GLTzf0A2JHFjpk", label: 'navon "4"' },
  { point: "H0P3A", src: "BAk8k8E1PzcOHOsj021u", dst: "1wHV37Gv2SgdWUePZQbr", label: 'navon "5"' },
  { point: "H0P3C", src: "614vLYjNImn7GGOOb2Be", dst: "INihc6dY1vpFLNypLUlf", label: 'navon "6"' },
  { point: "H0P4A", src: "AFERDlTGcUoLkI37225G", dst: "0wD0jDKhIH4wJk1s6G8v", label: 'navon "7"' },
  { point: "H0P4B", src: "zzItKXnSsO0OIEAFH4zr", dst: "UJqE9Ac2TQOxNG9R1gO6", label: 'navon "8"' },
  { point: "H0P5A", src: "3nnl0d2k49CnQyRngoxa", dst: "XnYw2FlxUawGpur9qXba", label: 'navon "9"' },
  { point: "H0P5B", src: "w6i1avjOG3t3L14wT6J7", dst: "4t9lPJk1cFlguwhZsNc9", label: 'navon "10 פריזמה"' },
  { point: "H0P6A", src: "n2aJEiBct77lyqpl2IPa", dst: "W5CWaz4bDuEN6sFWjsNI", label: 'navon "11"' },
  { point: "H5P1B", src: "LFDPr5Fe1zBJunWGWbBq", dst: "AG6010IORg3UCFmN0r3A", label: 'jaffa "2"' },
  { point: "H5P4A", src: "hk9KtxhHIauY5BbQmQEr", dst: "rB7Eir36jTl34dyJxBkZ", label: 'jaffa "5"' },
  { point: "H5P5A", src: "EQLprdR6dyZPhaF30ZzL", dst: "hEgvvnlCHVndm40bR2dj", label: 'jaffa "7"' },
  { point: "H5P5B", src: "pY98XFUM4pPgvWIuJMu0", dst: "lCzOkCIT88VwrLQPMAkM", label: 'jaffa "8"' },
  { point: "H9P3A", src: "aXsiAHUG1g3frqgTO565", dst: "sen-tilt-prism_JTCS_NEVIM61_3A", label: 'neviim "6"' },
  { point: "H9P3B", src: "ro5w5v0rBhOI4QqCsGf8", dst: "sen-tilt-prism_JTCS_NEVIM61_3B", label: 'neviim "5"' },
];

run(async () => {
  const args = parseArgs();

  type Plan = { dstPath: string; data: FirebaseFirestore.DocumentData; label: string };
  const plan: Plan[] = [];

  for (const p of PAIRS) {
    const srcLog = db.collection(`work-sensors/${p.src}/data-log`);
    const snap = await srcLog.orderBy("time").get();
    const docs = snap.docs.filter((d) => {
      const x = d.data();
      return typeof x.time === "number" && !d.id.startsWith("daily::") && x.source !== "derived:daily";
    });
    let skipped = 0;
    for (const d of docs) {
      const dstRef = db.doc(`work-sensors/${p.dst}/data-log/${d.id}`);
      const exists = await dstRef.get();
      if (exists.exists) { skipped++; continue; }
      plan.push({ dstPath: dstRef.path, data: d.data(), label: `${p.point} → ${p.label}` });
    }
    console.log(`${p.point}: ${docs.length} src samples, ${skipped} already present, ${docs.length - skipped} to copy → ${p.label}`);
  }

  console.log(`\nTotal to copy: ${plan.length}`);
  const sample = plan.slice(0, 3);
  for (const p of sample) console.log(`  ${p.dstPath}\n    ${JSON.stringify(p.data).slice(0, 220)}`);
  if (plan.length > 3) console.log(`  … (+${plan.length - 3} more)`);

  if (!plan.length || !(await confirmApply(args, `copy ${plan.length} data-log docs to legacy sensors`))) return;

  const w = new BatchWriter();
  for (const p of plan) await w.set(db.doc(p.dstPath), p.data);
  await w.flush();
  console.log(`done: ${w.committed} docs copied`);
});
