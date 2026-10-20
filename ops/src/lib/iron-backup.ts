/**
 * Backup + restore of the sensor state that baseline ironing touches (A4, 2026-10-20).
 *
 * Ironing adds baseline events (`applyBaseline`) and recomputes smooth/eval. Raw values never
 * change, so the backup holds only what ironing can change:
 *   - sensor doc: initial-value, status, alert_state, thresholds
 *   - every baseline-events doc (id + data)
 *   - every data-log doc with time >= `from`: id + smooth, eval, suspect, suspect_reason
 *
 * Firestore Timestamps are encoded as {"__ts":[seconds,nanos]} so the restore writes them back
 * exactly. Any other non-JSON value fails the backup (better to stop than to lose data silently).
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DocumentData, UpdateData } from "firebase-admin/firestore";
import { db, FieldValue, PROJECT_ID, Timestamp } from "./firebase";
import { BatchWriter } from "./cli";

export const SENSOR_FIELDS = ["initial-value", "status", "alert_state", "thresholds"] as const;
export const LOG_FIELDS = ["smooth", "eval", "suspect", "suspect_reason"] as const;
export const IRON_NOTE_PREFIX = "iron:";
const PAGE = 2000;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface SensorBackup {
  sensorId: string;
  name: string;
  from: number;
  sensor: Record<string, Json>;                      // absent field = absent in the doc
  baselineEvents: Array<{ id: string; data: Json }>;
  dataLog: Array<{ id: string; time: number | null; f: Record<string, Json> }>;
}

export interface BackupFile {
  kind: "iron-backup";
  version: 1;
  project: string;
  createdAt: string;
  createdBy: string;
  sensors: SensorBackup[];
}

// ---------- encoding ----------
export function enc(v: unknown): Json {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (v instanceof Timestamp) return { __ts: [v.seconds, v.nanoseconds] };
  if (Array.isArray(v)) return v.map(enc);
  if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const o: Record<string, Json> = {};
    for (const k of Object.keys(v as object).sort()) o[k] = enc((v as Record<string, unknown>)[k]);
    return o;
  }
  throw new Error(`iron-backup: unsupported value type ${(v as object)?.constructor?.name ?? typeof v}`);
}

export function dec(v: Json): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(dec);
  if (Array.isArray((v as { __ts?: unknown }).__ts) && Object.keys(v).length === 1) {
    const [s, n] = (v as { __ts: [number, number] }).__ts;
    return new Timestamp(s, n);
  }
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) o[k] = dec(x);
  return o;
}

const same = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a ?? "∅") === JSON.stringify(b ?? "∅");
const pick = (d: DocumentData, keys: readonly string[]) => {
  const o: Record<string, Json> = {};
  for (const k of keys) if (d[k] !== undefined) o[k] = enc(d[k]);
  return o;
};

// ---------- backup ----------
/** Read-only: collect the backup for one sensor from `from` (epoch ms) onwards. */
export async function collectSensor(sensorId: string, from: number): Promise<SensorBackup> {
  const ref = db.collection("work-sensors").doc(sensorId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`iron-backup: sensor ${sensorId} not found`);
  const events = await ref.collection("baseline-events").get();
  const dataLog: SensorBackup["dataLog"] = [];
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = ref.collection("data-log").where("time", ">=", from).orderBy("time").limit(PAGE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    for (const d of page.docs) dataLog.push({ id: d.id, time: d.data().time ?? null, f: pick(d.data(), LOG_FIELDS) });
    if (page.size < PAGE) break;
    last = page.docs[page.docs.length - 1];
  }
  return {
    sensorId, name: snap.data()?.name ?? "", from,
    sensor: pick(snap.data()!, SENSOR_FIELDS),
    baselineEvents: events.docs.map((e) => ({ id: e.id, data: enc(e.data()) })),
    dataLog,
  };
}

/**
 * Write the backup file and verify it (re-read, parse, counts, sha256). Throws on any failure —
 * the apply script must call this FIRST and stop if it throws.
 */
export async function writeBackup(
  targets: Array<{ sensorId: string; from: number }>, createdBy: string, outDir = path.join(__dirname, "../../out"),
): Promise<{ file: string; bytes: number; sha256: string; sensors: number; docs: number; events: number }> {
  const sensors: SensorBackup[] = [];
  for (const t of targets) sensors.push(await collectSensor(t.sensorId, t.from));
  const body: BackupFile = { kind: "iron-backup", version: 1, project: PROJECT_ID, createdAt: new Date().toISOString(), createdBy, sensors };
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `devinci-iron-backup-${body.createdAt.replace(/[:.]/g, "-")}.json`);
  const text = JSON.stringify(body);
  fs.writeFileSync(file, text);

  const back = fs.readFileSync(file, "utf8");
  const sha256 = createHash("sha256").update(back).digest("hex");
  if (sha256 !== createHash("sha256").update(text).digest("hex")) throw new Error(`iron-backup: ${file} verify failed (hash)`);
  const parsed = JSON.parse(back) as BackupFile;
  const docs = sensors.reduce((n, s) => n + s.dataLog.length, 0);
  const events = sensors.reduce((n, s) => n + s.baselineEvents.length, 0);
  if (parsed.sensors.length !== targets.length ||
      parsed.sensors.reduce((n, s) => n + s.dataLog.length, 0) !== docs) {
    throw new Error(`iron-backup: ${file} verify failed (counts)`);
  }
  return { file, bytes: Buffer.byteLength(back), sha256, sensors: sensors.length, docs, events };
}

export function loadBackup(file: string): BackupFile {
  const b = JSON.parse(fs.readFileSync(file, "utf8")) as BackupFile;
  if (b.kind !== "iron-backup" || b.version !== 1) throw new Error(`${file} is not an iron-backup v1 file`);
  if (b.project !== PROJECT_ID) throw new Error(`${file} is for project ${b.project}, ops is pinned to ${PROJECT_ID}`);
  return b;
}

// ---------- restore ----------
export interface RestorePlan {
  sensorId: string;
  name: string;
  sensorUpdate: Record<string, Json | "__delete">;   // field → backed-up value / delete
  eventsToDelete: Array<{ id: string; data: Json }>;  // added since the backup (note "iron: …")
  eventsForeign: Array<{ id: string; data: Json }>;   // added since the backup, NOT by ironing — left alone
  eventsToRecreate: Array<{ id: string; data: Json }>; // in the backup but gone now
  eventsChanged: Array<{ id: string; data: Json }>;   // same id, different data → written back
  logUpdates: Array<{ id: string; set: Record<string, Json | "__delete"> }>;
  logMissing: number;   // backed-up docs that no longer exist (not recreated)
  logNewSince: number;  // docs with time >= from created after the backup (not in it)
}

/** Read-only diff: what the restore must write so the sensor matches the backup again. */
export async function planRestore(b: SensorBackup): Promise<RestorePlan> {
  const now = await collectSensor(b.sensorId, b.from);
  const plan: RestorePlan = {
    sensorId: b.sensorId, name: b.name, sensorUpdate: {}, eventsToDelete: [], eventsForeign: [],
    eventsToRecreate: [], eventsChanged: [], logUpdates: [], logMissing: 0, logNewSince: 0,
  };
  for (const k of SENSOR_FIELDS) {
    if (!same(now.sensor[k], b.sensor[k])) plan.sensorUpdate[k] = k in b.sensor ? b.sensor[k] : "__delete";
  }
  const oldEv = new Map(b.baselineEvents.map((e) => [e.id, e.data]));
  const nowEv = new Map(now.baselineEvents.map((e) => [e.id, e.data]));
  for (const [id, data] of nowEv) {
    if (!oldEv.has(id)) {
      const note = (data as Record<string, Json>)?.note;
      (typeof note === "string" && note.startsWith(IRON_NOTE_PREFIX) ? plan.eventsToDelete : plan.eventsForeign).push({ id, data });
    } else if (!same(data, oldEv.get(id))) plan.eventsChanged.push({ id, data: oldEv.get(id)! });
  }
  for (const [id, data] of oldEv) if (!nowEv.has(id)) plan.eventsToRecreate.push({ id, data });

  const nowLog = new Map(now.dataLog.map((d) => [d.id, d.f]));
  const oldIds = new Set(b.dataLog.map((d) => d.id));
  for (const d of b.dataLog) {
    const cur = nowLog.get(d.id);
    if (!cur) { plan.logMissing++; continue; }
    const set: Record<string, Json | "__delete"> = {};
    for (const k of LOG_FIELDS) if (!same(cur[k], d.f[k])) set[k] = k in d.f ? d.f[k] : "__delete";
    if (Object.keys(set).length) plan.logUpdates.push({ id: d.id, set });
  }
  for (const id of nowLog.keys()) if (!oldIds.has(id)) plan.logNewSince++;
  return plan;
}

export const planWrites = (p: RestorePlan) =>
  (Object.keys(p.sensorUpdate).length ? 1 : 0) + p.eventsToDelete.length * 2 + p.eventsToRecreate.length +
  p.eventsChanged.length + p.logUpdates.length;

const toUpdate = (o: Record<string, Json | "__delete">): UpdateData<DocumentData> => {
  const u: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) u[k] = v === "__delete" ? FieldValue.delete() : dec(v);
  return u as UpdateData<DocumentData>;
};

/** WRITES. Deleted iron events are archived to baseline-events-deleted (same audit trail as deleteBaseline). */
export async function applyRestore(p: RestorePlan, by: string, w: BatchWriter): Promise<void> {
  const ref = db.collection("work-sensors").doc(p.sensorId);
  for (const e of p.eventsToDelete) {
    await w.set(ref.collection("baseline-events-deleted").doc(e.id), {
      ...(dec(e.data) as DocumentData), deletedAt: FieldValue.serverTimestamp(), deletedBy: by, deleteNote: "iron restore",
    }, false);
    await w.delete(ref.collection("baseline-events").doc(e.id));
  }
  for (const e of [...p.eventsToRecreate, ...p.eventsChanged]) {
    await w.set(ref.collection("baseline-events").doc(e.id), dec(e.data) as DocumentData, false);
  }
  if (Object.keys(p.sensorUpdate).length) await w.update(ref, toUpdate(p.sensorUpdate));
  for (const u of p.logUpdates) await w.update(ref.collection("data-log").doc(u.id), toUpdate(u.set));
}
