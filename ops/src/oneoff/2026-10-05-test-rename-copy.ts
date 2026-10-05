/**
 * Test the sensor-rename copy used by install-sensor (web-platform
 * `src/app/pages/install-sensor/copy-sensor-subcollections.ts` — this script
 * imports and runs that exact file with firebase-admin).
 *
 * Asked by Hillel (review round 2, Q10): chunked data-log copy (≤ 400 per
 * batch), old doc deleted only after everything committed, stop + keep the
 * old doc on failure. Test on a בדיקות משרד sensor with > 500 samples.
 *
 * The real sensor is NEVER modified or deleted. The copy goes to a temporary
 * doc `work-sensors/<id>__rename-test-20261005`, which is deleted at the end.
 *   1. Failure: a simulated failure on the 2nd batch commit → expect
 *      CopySubcollectionsError with data-log = 400 copied, source untouched.
 *   2. Retry over the partial copy (same doc ids → no duplicates) → full copy;
 *      verify counts (target == source per subcollection) + spot-check docs.
 *   3. Delete the temporary copy (chunks), verify it's gone.
 *
 * Usage:
 *   npx tsx src/oneoff/2026-10-05-test-rename-copy.ts [--project="בדיקות משרד"] [--sensor=<docId>]          # dry run
 *   npx tsx src/oneoff/2026-10-05-test-rename-copy.ts ... --apply                                            # run (asks "yes")
 *
 * Undo: nothing to undo — only the temporary doc is written, and step 3 deletes
 * it. If the script dies mid-way, re-run it: it clears a leftover temp copy first.
 */
import { FieldPath } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { confirmApply, parseArgs, run, str } from "../lib/cli";
import { projectSensors, resolveProject } from "../lib/sensors";
import {
  COPY_CHUNK_SIZE,
  CopySubcollectionsError,
  SENSOR_SUBCOLLECTIONS,
  copySensorSubcollections,
} from "../../../../scanin-web-platform/src/app/pages/install-sensor/copy-sensor-subcollections";

const SUFFIX = "__rename-test-20261005";

const countOf = async (path: string) => (await db.collection(path).count().get()).data().count;

async function countsFor(sensorId: string) {
  const out: Record<string, number> = {};
  for (const sub of SENSOR_SUBCOLLECTIONS) out[sub] = await countOf(`work-sensors/${sensorId}/${sub}`);
  return out;
}

async function deleteSubcollections(sensorId: string) {
  let deleted = 0;
  for (const sub of SENSOR_SUBCOLLECTIONS) {
    for (;;) {
      const snap = await db.collection(`work-sensors/${sensorId}/${sub}`).limit(COPY_CHUNK_SIZE).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
    }
  }
  return deleted;
}

/** firebase-admin db whose Nth batch commit throws (simulated network failure) */
function dbFailingOnCommit(failOn: number) {
  let commits = 0;
  return {
    collection: (p: string) => db.collection(p),
    batch: () => {
      const b = db.batch();
      return {
        set: (ref: any, data: any) => b.set(ref, data),
        commit: async () => {
          commits++;
          if (commits === failOn) throw new Error(`simulated failure on commit #${failOn}`);
          return b.commit();
        },
      };
    },
  };
}

const assert = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✅" : "❌"} ${msg}`);
  if (!ok) throw new Error(`assertion failed: ${msg}`);
};

run(async () => {
  const args = parseArgs();
  const project = await resolveProject(str(args.project) ?? "בדיקות משרד");
  console.log(`project: ${project.name} (${project.id})`);

  // Pick the sensor: --sensor, else the first in the project with > 500 samples
  let sensorId = str(args.sensor);
  let source: Record<string, number> | undefined;
  if (!sensorId) {
    for (const s of await projectSensors(project.id)) {
      const n = await countOf(`work-sensors/${s.id}/data-log`);
      console.log(`  ${s.id}  ${s.label}  data-log=${n}`);
      if (n > 500) {
        sensorId = s.id;
        break;
      }
    }
  }
  if (!sensorId) throw new Error(`no sensor with > 500 samples in ${project.name} — pass --sensor`);
  source = await countsFor(sensorId);
  const target = `${sensorId}${SUFFIX}`;
  const leftover = await countsFor(target);
  console.log(`\nsource: work-sensors/${sensorId}  ${JSON.stringify(source)}`);
  console.log(`temp target: work-sensors/${target}  (existing: ${JSON.stringify(leftover)})`);
  console.log(`chunks: data-log ${Math.ceil(source["data-log"] / COPY_CHUNK_SIZE)} × ≤${COPY_CHUNK_SIZE}`);
  if (source["data-log"] <= 500) throw new Error("source needs > 500 samples for a meaningful test");

  if (!(await confirmApply(args, `copy ${source["data-log"]} samples + ${source["baseline-events"]} baseline events of ${sensorId} to the TEMPORARY doc ${target}, verify, then delete the temporary doc (source untouched)`))) return;

  if (leftover["data-log"] + leftover["baseline-events"] > 0) {
    console.log(`clearing leftover temp copy: ${await deleteSubcollections(target)} docs`);
  }

  // 1. Failure on the 2nd commit
  console.log("\n1) simulated failure on the 2nd batch commit");
  let failed: CopySubcollectionsError | null = null;
  try {
    await copySensorSubcollections(dbFailingOnCommit(2), FieldPath.documentId(), sensorId, target);
  } catch (e) {
    failed = e as CopySubcollectionsError;
  }
  assert(failed instanceof CopySubcollectionsError, "throws CopySubcollectionsError");
  assert(failed?.counts["data-log"] === COPY_CHUNK_SIZE, `reports ${failed?.counts["data-log"]} data-log docs copied (expected ${COPY_CHUNK_SIZE})`);
  assert((await countOf(`work-sensors/${target}/data-log`)) === COPY_CHUNK_SIZE, "target holds exactly the committed chunk");
  assert(JSON.stringify(await countsFor(sensorId)) === JSON.stringify(source), "source unchanged");

  // 2. Retry → full copy, same ids (no duplicates)
  console.log("\n2) retry → full copy");
  const t0 = Date.now();
  const copied = await copySensorSubcollections(db, FieldPath.documentId(), sensorId, target, (p) =>
    process.stdout.write(`   ${p.subcollection}: ${p.copied}\r`)
  );
  console.log(`\n   copied ${JSON.stringify(copied)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const after = await countsFor(target);
  for (const sub of SENSOR_SUBCOLLECTIONS) {
    assert(copied[sub] === source[sub], `${sub}: reported ${copied[sub]} == source ${source[sub]}`);
    assert(after[sub] === source[sub], `${sub}: target count ${after[sub]} == source ${source[sub]} (no duplicates from the retry)`);
  }
  const sample = await db.collection(`work-sensors/${sensorId}/data-log`).orderBy("time", "desc").limit(3).get();
  for (const d of sample.docs) {
    const t = await db.doc(`work-sensors/${target}/data-log/${d.id}`).get();
    assert(t.exists && JSON.stringify(t.data()) === JSON.stringify(d.data()), `doc ${d.id} copied with same id and identical data`);
  }
  assert(JSON.stringify(await countsFor(sensorId)) === JSON.stringify(source), "source still unchanged");

  // 3. Delete the temporary copy
  console.log("\n3) delete the temporary copy");
  console.log(`   deleted ${await deleteSubcollections(target)} docs`);
  const gone = await countsFor(target);
  assert(gone["data-log"] === 0 && gone["baseline-events"] === 0, "temporary copy fully deleted");
  assert(!(await db.doc(`work-sensors/${target}`).get()).exists, "no temporary parent doc");

  console.log("\n✅ rename copy test passed");
});
