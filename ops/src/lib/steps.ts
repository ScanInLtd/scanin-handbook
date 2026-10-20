/**
 * Level-step detection on prism E/N/H, on the adjusted series (raw − baseline event in force).
 * Shared by analysis/step-inventory.ts and review/group-review.ts.
 *
 * Step test at sample i: before = median of the previous K samples, after = median of the next K;
 * |after − before| ≥ minStep, both K-blocks internally consistent (spread ≤ 2·max(2, step/3)),
 * no baseline event exactly at the step. Neighbours within 12 h merge to the strongest.
 * End: back to the old level (K-sample median within max(2, step/5)) → "returns", or a later
 * baseline event first → "event:<reason>", else "open".
 */
import { db } from "./firebase";
import { DAY, H, median } from "./signal";
import { Sensor } from "./sensors";

export const PRISM_AXES = [
  { key: "EastingDisplacement", he: "X" },
  { key: "NorthingDisplacement", he: "Y" },
  { key: "HeightDisplacement", he: "Z" },
] as const;

export type Pt = { t: number; v: number };
export type Step = {
  sensorId: string; name: string; axis: string; time: number;
  before: number; after: number; size: number; end: number | null; endKind: string;
};
export type SensorData = { sensor: Sensor; events: { time: number; reason: string; initial: any }[]; series: Record<string, Pt[]> };

export async function loadPrismSeries(s: Sensor, from: number): Promise<SensorData> {
  const events = (await db.collection(`work-sensors/${s.id}/baseline-events`).orderBy("time").get()).docs
    .map((d) => d.data() as any).filter((e) => typeof e.time === "number");
  const init = s.data["initial-value"] ?? {};
  const baseAt = (t: number) => { let f: any = null; for (const e of events) if (e.time <= t) f = e; return f?.initial ?? init; };
  const snap = await db.collection(`work-sensors/${s.id}/data-log`).where("time", ">=", from).orderBy("time").get();
  const docs = snap.docs.filter((d) => !d.id.startsWith("daily::")).map((d) => d.data())
    .filter((x) => typeof x.time === "number" && !(x.suspect && x.suspect_reason && !["implausible-jump", "out-of-range"].includes(x.suspect_reason)));
  const series: Record<string, Pt[]> = {};
  for (const a of PRISM_AXES) {
    series[a.key] = docs.map((x) => ({ t: x.time as number, v: parseFloat(x[a.key]) - (Number(baseAt(x.time)[a.key]) || 0) })).filter((p) => Number.isFinite(p.v));
  }
  return { sensor: s, events, series };
}

export function detectSteps(sd: SensorData, from: number, minStep: number, K: number): Step[] {
  const out: Step[] = [];
  for (const a of PRISM_AXES) {
    const pts = sd.series[a.key];
    if (pts.length < 2 * K + 2) continue;
    const cand: Step[] = [];
    for (let i = K; i <= pts.length - K; i++) {
      if (pts[i].t < from) continue;
      const prev = pts.slice(i - K, i).map((p) => p.v), next = pts.slice(i, i + K).map((p) => p.v);
      const b = median(prev), af = median(next), size = af - b;
      if (Math.abs(size) < minStep) continue;
      const tol = Math.max(2, Math.abs(size) / 3);
      if (Math.max(...next) - Math.min(...next) > 2 * tol || Math.max(...prev) - Math.min(...prev) > 2 * tol) continue;
      if (sd.events.some((e) => e.time > pts[i - 1].t && e.time <= pts[i].t)) continue;
      cand.push({ sensorId: sd.sensor.id, name: String(sd.sensor.label), axis: a.key, time: pts[i].t, before: b, after: af, size, end: null, endKind: "open" });
    }
    const merged: Step[] = [];
    for (const c of cand) {
      const last = merged[merged.length - 1];
      if (last && c.time - last.time < 12 * H) { if (Math.abs(c.size) > Math.abs(last.size)) merged[merged.length - 1] = c; }
      else merged.push(c);
    }
    for (const st of merged) {
      const after = pts.filter((p) => p.t > st.time);
      for (let j = 0; j + K <= after.length; j++) {
        const m = median(after.slice(j, j + K).map((p) => p.v));
        if (Math.abs(m - st.before) <= Math.max(2, Math.abs(st.size) / 5)) { st.end = after[j].t; st.endKind = "returns"; break; }
      }
      const nextEv = sd.events.find((e) => e.time > st.time && (st.end === null || e.time < st.end));
      if (nextEv) { st.end = nextEv.time; st.endKind = `event:${nextEv.reason}`; }
      out.push(st);
    }
  }
  return out;
}

/** Group steps across sensors: a new group starts when a step is more than `gapMs` after the group's first step. */
export function groupSteps(steps: Step[], gapMs = DAY): { t0: number; items: Step[] }[] {
  const sorted = [...steps].sort((a, b) => a.time - b.time);
  const groups: { t0: number; items: Step[] }[] = [];
  for (const st of sorted) {
    const g = groups[groups.length - 1];
    if (g && st.time - g.t0 <= gapMs) g.items.push(st); else groups.push({ t0: st.time, items: [st] });
  }
  return groups;
}
