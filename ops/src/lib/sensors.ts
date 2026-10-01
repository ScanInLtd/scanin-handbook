/**
 * Sensor / project resolution shared by query scripts.
 *
 * Data model facts (verified against bridge, functions, data-replay code):
 *   - work-sensors/{docId}: `scanin-id`, `name`, `type`, `location.site` (= projects doc id),
 *     `location.section`, `thresholds`, `status`
 *   - work-sensors/{docId}/data-log/{autoId}: raw samples, `time` = epoch ms
 *   - work-sensors/{docId}/data-log/daily::{YYYY-MM-DD}::{axis}: daily aggregates (prism-daily worker)
 *   - Sensors are linked to a project ONLY via `location.site` (no list on the project doc)
 */
import { db } from "./firebase";
import type { DocumentData } from "firebase-admin/firestore";

export type Sensor = { id: string; label: string; data: DocumentData };
export type Project = { id: string; name: string; data: DocumentData };

export const sensorLabel = (d: DocumentData, fallback: string) =>
  d.name || d.label || d["scanin-id"] || d.MAC || fallback;

export const projectName = (d: DocumentData) => d.name || d.title || d.projectName || "(unnamed)";

/** Find sensors by doc id, `scanin-id`, MAC, or exact name. */
export async function findSensors(key: string): Promise<Sensor[]> {
  const col = db.collection("work-sensors");
  const byId = await col.doc(key).get();
  if (byId.exists) return [{ id: byId.id, label: sensorLabel(byId.data()!, byId.id), data: byId.data()! }];

  const out = new Map<string, Sensor>();
  for (const field of ["scanin-id", "MAC", "name"]) {
    const snap = await col.where(field, "==", key).get();
    snap.forEach((d) => out.set(d.id, { id: d.id, label: sensorLabel(d.data(), d.id), data: d.data() }));
  }
  return [...out.values()];
}

/** Resolve a project by exact id or (substring) name. Throws if ambiguous. */
export async function resolveProject(key: string): Promise<Project> {
  const byId = await db.collection("projects").doc(key).get();
  if (byId.exists) return { id: byId.id, name: projectName(byId.data()!), data: byId.data()! };

  const snap = await db.collection("projects").get();
  const matches = snap.docs.filter((d) => projectName(d.data()).includes(key));
  if (matches.length === 1) return { id: matches[0].id, name: projectName(matches[0].data()), data: matches[0].data() };
  if (!matches.length) throw new Error(`no project matches "${key}"`);
  throw new Error(`"${key}" matched ${matches.length} projects: ${matches.map((m) => `${projectName(m.data())} (${m.id})`).join(", ")}`);
}

export async function projectSensors(projectId: string, type?: string): Promise<Sensor[]> {
  let q = db.collection("work-sensors").where("location.site", "==", projectId);
  if (type) q = q.where("type", "==", type);
  const snap = await q.get();
  return snap.docs
    .map((d) => ({ id: d.id, label: sensorLabel(d.data(), d.id), data: d.data() }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
}
