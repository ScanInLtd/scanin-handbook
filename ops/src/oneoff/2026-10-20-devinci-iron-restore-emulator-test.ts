/**
 * EMULATOR ONLY — round-trip test of the A4 iron backup/restore:
 *   seed a sensor (tilt: smoothing needs no project config) with a temporary −14 mm step → writeBackup → iron with the real functions core
 *   (applyBaseline, note "iron: …") → planRestore/applyRestore → state identical to the backup.
 *
 * Usage (functions built: ../scanin-svc-firebase-functions/lib):
 *   firebase emulators:start --only firestore --project dataloggerdev     # in the functions repo
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=dataloggerdev \
 *     npx tsx src/oneoff/2026-10-20-devinci-iron-restore-emulator-test.ts
 */
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST is not set (emulator only!)");
  process.exit(1);
}
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../lib/firebase";
import { BatchWriter, run } from "../lib/cli";
import { applyRestore, collectSensor, loadBackup, planRestore, planWrites, writeBackup } from "../lib/iron-backup";

const FN_LIB = path.join(__dirname, "../../../../scanin-svc-firebase-functions/lib");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyBaseline } = require(path.join(FN_LIB, "setBaseline"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { recomputeSmoothingCore } = require(path.join(FN_LIB, "recomputeSmoothing"));

const H = 3.6e6, D = 24 * H;
const ID = "iron-rt-tilt";
let fails = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`  ${ok ? "✅" : "❌"} ${name} ${ok ? "" : detail}`); if (!ok) fails++; };

run(async () => {
  const ref = db.collection("work-sensors").doc(ID);
  for (;;) { const s = await ref.collection("data-log").limit(400).get(); if (s.empty) break; const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }
  for (const c of ["baseline-events", "baseline-events-deleted"]) for (const d of (await ref.collection(c).get()).docs) await d.ref.delete();

  const t0 = Date.now() - 20 * D;
  await ref.set({
    name: "iron rt", type: "tilt", active: true, location: { site: "iron-rt-none", section: "s" },
    "initial-value": { x: 0, y: 0 },
    thresholds: { axes: { x: { warn: { gap: 10 }, alarm: { gap: 20 } } } },
    status: { axes: { x: "warn" } }, alert_state: { axes: { x: { ref: 0 } } },
  });
  await ref.collection("baseline-events").add({ time: t0 - D, reason: "migration", initial: { x: 0, y: 0 }, by: "test", note: "", createdAt: new Date(t0 - D) });
  const stepStart = t0 + 8 * D, stepEnd = t0 + 14 * D;
  for (let t = t0; t < t0 + 20 * D; t += 3 * H) {
    const e = t >= stepStart && t < stepEnd ? -14 : 0;
    await ref.collection("data-log").add({ time: t, x: e + ((t / H) % 3) * 0.1, y: 0.1 });
  }
  await recomputeSmoothingCore({ sensorId: ID, fromTime: t0, apply: true });
  console.log("=== iron backup/restore round trip (emulator) ===");

  const outDir = fs.mkdtempSync("/tmp/iron-rt-");
  const bk = await writeBackup([{ sensorId: ID, from: stepStart }], "emulator-test", outDir);
  check("backup written + verified", fs.existsSync(bk.file) && bk.docs > 0, JSON.stringify(bk));
  const backup = loadBackup(bk.file).sensors[0];

  // iron: event at the step start (initial = median of the 24h after) + one at the step end
  await applyBaseline({ sensorId: ID, time: stepStart, reason: "rebaseline", note: "iron: rt step start" }, "emulator-test");
  await applyBaseline({ sensorId: ID, time: stepEnd, reason: "rebaseline", note: "iron: rt step end", initial: { x: 0, y: 0 } }, "emulator-test");
  const ironed = await planRestore(backup);
  check("ironing changed the state (2 iron events, smooth/eval rewritten)",
    ironed.eventsToDelete.length === 2 && ironed.logUpdates.length > 0 && Object.keys(ironed.sensorUpdate).length > 0,
    `del=${ironed.eventsToDelete.length} log=${ironed.logUpdates.length} fields=${Object.keys(ironed.sensorUpdate)}`);

  const w = new BatchWriter();
  await applyRestore(ironed, "emulator-test", w);
  await w.flush();

  const after = await planRestore(backup);
  check("after restore: 0 writes left (state == backup)", planWrites(after) === 0, JSON.stringify({ ...after, logUpdates: after.logUpdates.slice(0, 2) }));
  const now = await collectSensor(ID, stepStart);
  check("baseline-events identical to the backup", JSON.stringify(now.baselineEvents) === JSON.stringify(backup.baselineEvents));
  check("sensor fields identical", JSON.stringify(now.sensor) === JSON.stringify(backup.sensor));
  check("data-log smooth/eval/suspect identical", JSON.stringify(now.dataLog) === JSON.stringify(backup.dataLog));
  const arch = await ref.collection("baseline-events-deleted").get();
  check("iron events archived (deletedBy, deleteNote 'iron restore')",
    arch.size === 2 && arch.docs.every((d) => d.data().deleteNote === "iron restore" && String(d.data().note).startsWith("iron:")));
  const fresh = await recomputeSmoothingCore({ sensorId: ID, fromTime: t0, apply: false });
  check("restored state == a fresh recompute (wouldChange 0)", fresh.wouldChange === 0, `wouldChange=${fresh.wouldChange}`);

  console.log(`\n=== ${fails ? fails + " FAILURE(S)" : "ALL PASSED"} ===`);
  if (fails) process.exit(1);
});
