/**
 * מגדל דה וינצי דרום — remap ATS points to physically named sensors (Nathan + Hillel, 2026-10-06).
 *
 * Points on the station PCs are NOT renamed (no rename support yet) — this changes sensors + mapping:
 *  1. Station 5 (`DeVinci-1`, devices ATS-5-<point>): each point in NATHAN gets its target sensor
 *     (the one ats-device-map points to) renamed to the physical name, moved to the floor's section,
 *     and turned on + confirmed (the hidden ATS.DeVinci-1.* sensors that held the data since 08-10
 *     become the real sensors).
 *  2. Exceptions (Nathan): A1 / A3 → station "de vinzi 2" points f4p1 / f6p1 are used instead; the
 *     station-5 sensors and map entries are deleted. A5 → deleted (f8p1 point is used). C5 → keeps its
 *     sensor (renamed f8p6); the new f8p6 point's auto-sensor + map entry are deleted. B4, E4 → deleted.
 *     Points whose sensor was already deleted (f4p8, f4p10, f4p14, f6p14, f7p14, A5) are NOT restored:
 *     map entry + orphan data-log are deleted.
 *  3. C3 and C4 both wrote into "C6" since 08-10. Split by station height `u` (C3 ≈ −16.24 m,
 *     C4 ≈ −12.74 m, one storey apart): C6 stays C3 → f6p6; C4's samples move to a new sensor f7p6
 *     and ATS-5-C4 maps to it.
 *  4. New fXpY points (station 5 auto-sensors, station "de vinzi 2" sensors): renamed to fXpY (lower
 *     case, no "ATS.…" prefix), confirmed, floor section.
 *  5. Prism sensors of the project that no map entry targets any more and are still active (the old
 *     UI sensors with only 12–16.08 data, empty ones) → active:false.
 * Smoothing for f6p6 / f7p6 and the 08-09/16-09 step baselines are done by the follow-up script
 * 2026-10-06-devinci-baselines.ts (deployed callables).
 *
 * Every deleted doc (sensor + subcollections, map entry) and every changed field is backed up to
 * out/devinci-remap-backup-<ts>.json; --undo restores everything (incl. moving C4 samples back).
 *
 * Usage (from ops/):
 *   npx tsx src/oneoff/2026-10-06-devinci-remap.ts            # dry run (full plan)
 *   npx tsx src/oneoff/2026-10-06-devinci-remap.ts --apply
 *   npx tsx src/oneoff/2026-10-06-devinci-remap.ts --undo=out/devinci-remap-backup-<ts>.json --apply
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DocumentReference, FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run, str } from "../lib/cli";

const PROJECT = "hmPh7Hg2fjTc9GyNRDYO";
const BY = "oneoff 2026-10-06-devinci-remap";
const NATHAN: Record<string, string> = {
  A1: "f4p1", A2: "f5p1", A3: "f6p1", A4: "f7p1", A5: "f8p1", A6: "f9p1", A7: "f10p1", A8: "f11p1", A9: "f12p1",
  B1: "f4p5", B2: "f5p3", B5: "f7p4", B6: "f8p4",
  C1: "f4p6", C2: "f5p6", C3: "f6p6", C4: "f7p6", C5: "f8p6", C6: "f9p6", C7: "f10p6", C8: "f11p6", C9: "f12p6", C10: "f13p6",
  D1: "f4p11", D2: "f5p11", D3: "f6p11", D4: "f7p11", D5: "f8p11", D6: "f9p11", D7: "f10p11", D8: "f11p11", D9: "f12p11", D10: "f13p11",
  E5: "f5p5", E6: "f6p5", E7: "f7p5", F10: "f10p8", F11: "f11p8", G10: "f10p9", G11: "f11p9",
  H6: "f6p13", H7: "f7p13", H10: "f10p13", H11: "f11p13", H13: "f13p13", I10: "f10p12", I11: "f11p12",
};
const DELETE_POINT_AND_SENSOR = ["A1", "A3", "B4", "E4", "f8p6", "f6p13"]; // station-5 points whose sensor + map entry go
const DELETE_POINT_ONLY = ["A5", "f4p8", "f4p10", "f4p14", "f6p14", "f7p14"]; // sensor already deleted: map + orphan data
const SKIP_RENAME = new Set([...DELETE_POINT_AND_SENSOR, ...DELETE_POINT_ONLY, "C4"]); // C4 handled by the split
const C3_C4_SPLIT_U = -14.5;

type Backup = {
  fields: { path: string; before: Record<string, unknown> }[];
  maps: { id: string; data: Record<string, unknown> | null }[];
  deleted: { path: string; data: Record<string, unknown> | null; subs: Record<string, Record<string, Record<string, unknown>>> }[];
  split?: { from: string; to: string; moved: string[] };
};

const floorOf = (name: string) => Number(/^f(\d+)p/i.exec(name)?.[1] ?? NaN);
const get = (o: any, p: string) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

async function snapshotDoc(ref: DocumentReference) {
  const doc = await ref.get();
  const subs: Backup["deleted"][number]["subs"] = {};
  for (const c of await ref.listCollections()) {
    subs[c.id] = {};
    (await c.get()).docs.forEach((d) => (subs[c.id][d.id] = d.data()));
  }
  return { path: ref.path, data: doc.exists ? doc.data()! : null, subs };
}

run(async () => {
  const args = parseArgs();
  const outDir = path.resolve(__dirname, "../../out");
  const undo = str(args.undo);
  if (undo) return runUndo(undo, args);

  const sensors = (await db.collection("work-sensors").where("location.site", "==", PROJECT).get()).docs;
  const byId = new Map(sensors.map((s) => [s.id, s]));
  const maps = (await db.collection("ats-device-map").get()).docs;
  const map5 = new Map(maps.filter((m) => m.id.startsWith("ATS-5-")).map((m) => [m.id.slice(6), m]));
  const sections = (await db.collection(`projects/${PROJECT}/sections`).get()).docs;
  const sectionOfFloor = new Map<number, string>();
  sections.forEach((s) => { const f = Number(/(\d+)/.exec(String(s.data().name))?.[1]); if (f) sectionOfFloor.set(f, s.id); });

  const plan: { what: string; sensor?: string; detail: string }[] = [];
  const changes = new Map<string, Record<string, unknown>>(); // sensor path → update
  const setChange = (id: string, upd: Record<string, unknown>) => changes.set(`work-sensors/${id}`, { ...(changes.get(`work-sensors/${id}`) ?? {}), ...upd });
  const renameTo = (id: string, name: string, why: string) => {
    const s = byId.get(id)!.data();
    const sec = sectionOfFloor.get(floorOf(name));
    const upd: Record<string, unknown> = { name, confirmed: true, active: true };
    if (sec) upd["location.section"] = sec;
    if (s["location"]?.title !== undefined) upd["location.title"] = name;
    setChange(id, upd);
    plan.push({ what: "rename", sensor: name, detail: `${s.name} → ${name}${sec ? ` · ${sections.find((x) => x.id === sec)!.data().name}` : " · ⚠ no section"}${s.active === false ? " · turn ON" : ""}${s.confirmed !== true ? " · confirm" : ""} (${why})` });
  };

  // 1. station-5 points from Nathan's list
  for (const [point, name] of Object.entries(NATHAN)) {
    if (SKIP_RENAME.has(point)) continue;
    const m = map5.get(point);
    if (!m) { plan.push({ what: "⚠ missing", detail: `no ats-device-map entry for ATS-5-${point}` }); continue; }
    const sid = m.data().sensorId;
    if (!byId.has(sid)) { plan.push({ what: "⚠ missing", detail: `ATS-5-${point} → sensor ${sid} does not exist` }); continue; }
    renameTo(sid, name, `station-5 point ${point}`);
  }
  // 2. new fXpY points on station 5 (auto-sensors), except f8p6 (deleted, C5 keeps the name)
  for (const [point, m] of map5) {
    if (!/^f\d+p\d+$/i.test(point) || SKIP_RENAME.has(point)) continue;
    const sid = m.data().sensorId;
    if (!byId.has(sid)) continue;
    if (!changes.has(`work-sensors/${sid}`)) renameTo(sid, point.toLowerCase(), `new station-5 point ${point}`);
  }
  // 3. station "de vinzi 2" sensors + ones Nathan already renamed (F11P3 …): lower-case fXpY
  for (const s of sensors) {
    const n = String(s.data().name ?? "");
    const m = /^ATS\.de vinzi 2\.(f\d+p\d+)$/i.exec(n) ?? (/^f\d+p\d+$/i.test(n) && n !== n.toLowerCase() ? [n, n] : null);
    if (m && !changes.has(`work-sensors/${s.id}`)) renameTo(s.id, m[1].toLowerCase(), "station de vinzi 2 / case");
  }
  // 4. deletions
  const delSensors: string[] = [];
  const delMaps: string[] = [];
  const delOrphans: string[] = [];
  for (const p of DELETE_POINT_AND_SENSOR) {
    const m = map5.get(p); if (!m) continue;
    delMaps.push(m.id);
    const sid = m.data().sensorId;
    if (byId.has(sid)) { delSensors.push(sid); plan.push({ what: "DELETE", sensor: byId.get(sid)!.data().name, detail: `sensor + data (point ${p}) and map ATS-5-${p}` }); }
  }
  for (const p of DELETE_POINT_ONLY) {
    const m = map5.get(p); if (!m) continue;
    delMaps.push(m.id);
    const sid = m.data().sensorId;
    if (!byId.has(sid)) { delOrphans.push(sid); plan.push({ what: "DELETE", detail: `map ATS-5-${p} + orphan data-log of deleted sensor ${sid}` }); }
  }
  // 5. C3/C4 split
  const c6 = map5.get("C3")?.data().sensorId;
  const c6doc = c6 ? byId.get(c6) : undefined;
  let split: { toMove: string[]; keep: number; noU: number } | null = null;
  if (c6doc && map5.get("C4")?.data().sensorId === c6) {
    renameTo(c6, "f6p6", "station-5 point C3 (split: C3 stays)");
    const log = await c6doc.ref.collection("data-log").get();
    const toMove: string[] = []; let keep = 0, noU = 0;
    log.docs.forEach((d) => { const u = d.data().u; if (typeof u !== "number") { noU++; return; } if (u > C3_C4_SPLIT_U) toMove.push(d.id); else keep++; });
    split = { toMove, keep, noU };
    plan.push({ what: "SPLIT", sensor: "f7p6", detail: `C6 (${log.size} docs): ${keep} stay as f6p6 (C3, u<${C3_C4_SPLIT_U}), ${toMove.length} move to NEW sensor f7p6 (C4)${noU ? `, ${noU} without u stay` : ""}; ATS-5-C4 → f7p6` });
  }
  // 6. leftovers → off
  const targeted = new Set(maps.map((m) => m.data().sensorId));
  delMaps.forEach((id) => targeted.delete(maps.find((m) => m.id === id)!.data().sensorId));
  for (const s of sensors) {
    const x = s.data();
    if (x.type !== "prism" || x.active === false || targeted.has(s.id) || changes.has(`work-sensors/${s.id}`) || delSensors.includes(s.id)) continue;
    setChange(s.id, { active: false });
    plan.push({ what: "off", sensor: x.name, detail: `${x.name} (no point maps to it any more)` });
  }

  // print plan
  const order = ["⚠ missing", "DELETE", "SPLIT", "rename", "off"];
  for (const w of order) {
    const rows = plan.filter((p) => p.what === w);
    if (!rows.length) continue;
    console.log(`\n${w.toUpperCase()} (${rows.length})`);
    rows.sort((a, b) => String(a.sensor ?? a.detail).localeCompare(String(b.sensor ?? b.detail), undefined, { numeric: true })).forEach((r) => console.log(`  ${r.detail}`));
  }
  const names = new Map<string, number>();
  for (const [p, u] of changes) if (u.name && u.active !== false) names.set(String(u.name), (names.get(String(u.name)) ?? 0) + 1);
  const dups = [...names].filter(([, n]) => n > 1);
  if (dups.length) console.log(`\n⚠ DUPLICATE target names: ${dups.map(([n]) => n).join(", ")}`);
  if (!(await confirmApply(args, `DeVinci remap: ${changes.size} sensor updates, ${delSensors.length} sensors + ${delOrphans.length} orphan data-logs + ${delMaps.length} map entries DELETED, C6 split`))) return;

  // backup
  const backup: Backup = { fields: [], maps: [], deleted: [] };
  for (const [p, upd] of changes) {
    const d = (await db.doc(p).get()).data() ?? {};
    backup.fields.push({ path: p, before: Object.fromEntries(Object.keys(upd).map((k) => [k, get(d, k) ?? null])) });
  }
  for (const id of delMaps) backup.maps.push({ id, data: maps.find((m) => m.id === id)!.data() });
  for (const id of [...delSensors, ...delOrphans]) backup.deleted.push(await snapshotDoc(db.doc(`work-sensors/${id}`)));
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `devinci-remap-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const save = () => fs.writeFileSync(file, JSON.stringify(backup));
  save();
  console.log(`backup: ${file}`);

  // apply
  const w = new BatchWriter();
  for (const [p, upd] of changes) await w.update(db.doc(p), { ...upd, remappedBy: BY, remappedAt: Date.now() });
  for (const id of delMaps) await w.delete(db.doc(`ats-device-map/${id}`));
  await w.flush();
  for (const id of [...delSensors, ...delOrphans]) await db.recursiveDelete(db.doc(`work-sensors/${id}`));
  console.log(`  ✓ deleted ${delSensors.length} sensors + ${delOrphans.length} orphan data-logs`);

  if (c6doc && split) {
    const src = c6doc.data();
    const newRef = db.collection("work-sensors").doc();
    await newRef.set({
      ...src, name: "f7p6", atsDeviceId: "ATS-5-C4", pointId: "C4", active: true, confirmed: true,
      location: { ...src.location, section: sectionOfFloor.get(7) ?? src.location?.section, title: "f7p6" },
      status: { axes: {} }, alert_state: { axes: {} }, created: FieldValue.serverTimestamp(), remappedBy: BY, splitFrom: c6,
    });
    const bw = new BatchWriter();
    for (const ev of (await c6doc.ref.collection("baseline-events").get()).docs) await bw.set(newRef.collection("baseline-events").doc(ev.id), ev.data(), false);
    const moveSnap = await Promise.all(split.toMove.map((id) => c6doc.ref.collection("data-log").doc(id).get()));
    for (const d of moveSnap) {
      const { smooth, eval: _e, ...rest } = d.data()!;
      await bw.set(newRef.collection("data-log").doc(d.id), rest, false);
    }
    await bw.flush();
    const dw = new BatchWriter();
    for (const id of split.toMove) await dw.delete(c6doc.ref.collection("data-log").doc(id));
    await dw.update(db.doc("ats-device-map/ATS-5-C4"), { sensorId: newRef.id, updatedAt: FieldValue.serverTimestamp() });
    await dw.flush();
    backup.split = { from: c6, to: newRef.id, moved: split.toMove };
    backup.maps.push({ id: "ATS-5-C4", data: map5.get("C4")!.data() });
    save();
    console.log(`  ✓ split: ${split.toMove.length} samples → f7p6 (${newRef.id})`);
  }
  console.log(`✅ done. Backup: ${file}\nNext: 2026-10-06-devinci-baselines.ts (smoothing for f6p6/f7p6 + step baselines).`);
});

async function runUndo(file: string, args: Record<string, unknown>) {
  const b: Backup = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  if (!(await confirmApply(args, `undo DeVinci remap from ${path.basename(file)}`))) return;
  const w = new BatchWriter();
  for (const d of b.deleted) {
    if (d.data) await w.set(db.doc(d.path), d.data, false);
    for (const [c, docs] of Object.entries(d.subs)) for (const [id, data] of Object.entries(docs)) await w.set(db.doc(`${d.path}/${c}/${id}`), data, false);
  }
  for (const m of b.maps) if (m.data) await w.set(db.doc(`ats-device-map/${m.id}`), m.data, false);
  for (const f of b.fields) await w.update(db.doc(f.path), { ...Object.fromEntries(Object.entries(f.before).map(([k, v]) => [k, v ?? FieldValue.delete()])), remappedBy: FieldValue.delete(), remappedAt: FieldValue.delete() });
  if (b.split) {
    const to = db.doc(`work-sensors/${b.split.to}`);
    for (const id of b.split.moved) {
      const d = await to.collection("data-log").doc(id).get();
      if (d.exists) await w.set(db.doc(`work-sensors/${b.split.from}/data-log/${id}`), d.data()!, false);
    }
  }
  await w.flush();
  if (b.split) await db.recursiveDelete(db.doc(`work-sensors/${b.split.to}`));
  console.log("✅ undo done (smoothing of restored sensors may need a recompute)");
}
