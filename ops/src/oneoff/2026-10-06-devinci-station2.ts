/**
 * מגדל דה וינצי דרום — station 2 ("de vinzi 2", devices ats-01-<point>) leftovers (Nathan + Hillel, 2026-10-06).
 * Follows 2026-10-06-devinci-remap.ts, which only covered sensors already in the project.
 *
 *  - 7 auto-created station-2 sensors still sit under the raw site "de vinzi 2", unconfirmed. Assign them to
 *    DeVinci + floor section, confirm, short names: f5p2, f7p2, f9p1, f5p07 → f5p7b, f6p7 → f6p7b, f7p07 → f7p7
 *    (station 5 also has f5p7 / f6p7 — "b" until it's understood).
 *  - f7p08: no longer on station 2 → sensor + map entry deleted.
 *  - f9p1: station 2 wins; point A6 was deleted on station 5 → station-5 sensor "f9p1" (ex-A9) + map
 *    ATS-5-A6 deleted.
 * Deleted docs (incl. subcollections) and changed fields are backed up; --undo restores.
 *
 * Usage (from ops/):
 *   npx tsx src/oneoff/2026-10-06-devinci-station2.ts [--apply]
 *   npx tsx src/oneoff/2026-10-06-devinci-station2.ts --undo=out/devinci-station2-backup-<ts>.json --apply
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DocumentReference, FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run, str } from "../lib/cli";

const PROJECT = "hmPh7Hg2fjTc9GyNRDYO";
const BY = "oneoff 2026-10-06-devinci-station2";
const RENAME: Record<string, string> = { f5p2: "f5p2", f7p2: "f7p2", f9p1: "f9p1", f5p07: "f5p7b", f6p7: "f6p7b", f7p07: "f7p7" };
const DELETE_STATION2 = ["f7p08"];
const DELETE_STATION5_MAP = ["A6"];

type Backup = { fields: { path: string; before: Record<string, unknown> }[]; deleted: { path: string; data: any; subs: Record<string, Record<string, any>> }[] };
const get = (o: any, p: string) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
async function snap(ref: DocumentReference) {
  const d = await ref.get(); const subs: Backup["deleted"][number]["subs"] = {};
  for (const c of await ref.listCollections()) { subs[c.id] = {}; (await c.get()).docs.forEach((x) => (subs[c.id][x.id] = x.data())); }
  return { path: ref.path, data: d.exists ? d.data() : null, subs };
}

run(async () => {
  const args = parseArgs();
  const outDir = path.resolve(__dirname, "../../out");
  const undo = str(args.undo);
  if (undo) {
    const b: Backup = JSON.parse(fs.readFileSync(path.resolve(undo), "utf8"));
    if (!(await confirmApply(args, `undo station-2 changes (${path.basename(undo)})`))) return;
    const w = new BatchWriter();
    for (const d of b.deleted) { if (d.data) await w.set(db.doc(d.path), d.data, false); for (const [c, docs] of Object.entries(d.subs)) for (const [id, x] of Object.entries(docs)) await w.set(db.doc(`${d.path}/${c}/${id}`), x, false); }
    for (const f of b.fields) await w.update(db.doc(f.path), Object.fromEntries(Object.entries(f.before).map(([k, v]) => [k, v ?? FieldValue.delete()])));
    await w.flush(); console.log("✅ undo done"); return;
  }
  const sections = (await db.collection(`projects/${PROJECT}/sections`).get()).docs;
  const secOf = (name: string) => { const f = Number(/^f(\d+)p/.exec(name)?.[1]); return sections.find((s) => Number(/(\d+)/.exec(String(s.data().name))?.[1]) === f); };
  const s2 = (await db.collection("work-sensors").where("dataSource", "==", "ats_live").where("atsSiteId", "==", "de vinzi 2").get()).docs;
  const maps = (await db.collection("ats-device-map").get()).docs;

  const updates: { ref: DocumentReference; upd: Record<string, unknown>; line: string }[] = [];
  const deletes: { ref: DocumentReference; mapIds: string[]; line: string }[] = [];
  for (const d of s2) {
    const x = d.data(); const point = String(x.pointId ?? x.atsDeviceId?.replace(/^ats-01-/, "") ?? "");
    if (x.location?.site === PROJECT) continue;
    if (DELETE_STATION2.includes(point)) { deletes.push({ ref: d.ref, mapIds: maps.filter((m) => m.data().sensorId === d.id).map((m) => m.id), line: `${x.name} (station 2 point ${point}, no longer on the station)` }); continue; }
    const name = RENAME[point];
    if (!name) { console.log(`⚠ unknown station-2 point ${point} (${x.name}) — skipped`); continue; }
    const sec = secOf(name);
    updates.push({ ref: d.ref, upd: { name, "location.site": PROJECT, "location.section": sec?.id ?? FieldValue.delete(), "location.title": name, confirmed: true, active: true, remappedBy: BY, remappedAt: Date.now() }, line: `${x.name} → ${name} · ${sec?.data().name ?? "⚠ no section"} · DeVinci · confirm` });
  }
  for (const p of DELETE_STATION5_MAP) {
    const m = maps.find((x) => x.id === `ATS-5-${p}`); if (!m) continue;
    const ref = db.doc(`work-sensors/${m.data().sensorId}`); const s = await ref.get();
    deletes.push({ ref, mapIds: [m.id], line: `${s.data()?.name ?? m.data().sensorId} (station 5 point ${p}, deleted on the station) + map ${m.id}` });
  }
  console.log(`ASSIGN + RENAME (${updates.length})`); updates.forEach((u) => console.log(`  ${u.line}`));
  console.log(`DELETE (${deletes.length})`); deletes.forEach((d) => console.log(`  ${d.line}${d.mapIds.length ? ` · map ${d.mapIds.join(", ")}` : ""}`));
  if (!(await confirmApply(args, `station 2: ${updates.length} assigned/renamed, ${deletes.length} deleted`))) return;

  const backup: Backup = { fields: [], deleted: [] };
  for (const u of updates) { const d = (await u.ref.get()).data(); backup.fields.push({ path: u.ref.path, before: Object.fromEntries(Object.keys(u.upd).map((k) => [k, get(d, k) ?? null])) }); }
  for (const d of deletes) { backup.deleted.push(await snap(d.ref)); for (const id of d.mapIds) backup.deleted.push(await snap(db.doc(`ats-device-map/${id}`))); }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `devinci-station2-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(backup));
  const w = new BatchWriter();
  for (const u of updates) await w.update(u.ref, u.upd);
  for (const d of deletes) for (const id of d.mapIds) await w.delete(db.doc(`ats-device-map/${id}`));
  await w.flush();
  for (const d of deletes) await db.recursiveDelete(d.ref);
  console.log(`✅ done. Backup: ${file}`);
});
