/**
 * Axis registry, step X1 of docs/signal-and-alerts/axes.md (decisions A–C, Hillel 2026-10-05).
 *
 * Writes:
 *  1. devices-types/sensors/devices/{type}: adds `axes` (the registry), `smoothingWindowHours`
 *     and `axesVersion` (merge). The existing `chart-axes` is NOT touched, because the live
 *     (old) UI reads it. It's regenerated from `axes` after the new UI is live. New docs only
 *     (OPKON_100_Potentiometer, inclinometer) also get `chart-axes`.
 *  2. Decision B: cracktemp `y` (temperature) is auxiliary. On every cracktemp sensor, delete
 *     `thresholds.axes.y`, `status.axes.y` and `alert_state.axes.y`.
 *  3. Decision C: the one-wire temperature probe typed OPKON_100 is a cracktemp without a crack
 *     meter. Set type → cracktemp, and delete `thresholds|status|alert_state.axes.celsius`.
 *
 * No reader uses `axes` yet (functions X3, UI X2 follow), so step 1 changes no behavior.
 * Steps 2–3 stop temperature alerts on those sensors.
 *
 * Usage:
 *   npx tsx src/oneoff/2026-10-05-axis-registry.ts            # dry run (default)
 *   npx tsx src/oneoff/2026-10-05-axis-registry.ts --apply    # write (asks "yes")
 *   npx tsx src/oneoff/2026-10-05-axis-registry.ts --undo=out/axis-registry-backup-<ts>.json --apply
 *
 * Undo: every touched doc's previous field values are saved to out/axis-registry-backup-<ts>.json
 * before writing. --undo restores them exactly (fields that didn't exist are deleted again).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import { BatchWriter, confirmApply, parseArgs, run, str } from "../lib/cli";

type Axis = {
  label: { he: string; en: string };
  unit: string | null;
  role: "measurement" | "auxiliary" | "derived";
  order: number;
  chart: boolean;
  report: boolean;
  alertable: boolean;
  suspectJump?: number;
  derivedFrom?: string[];
};
type TypeEntry = { axes: Record<string, Axis>; smoothingWindowHours?: number; create?: boolean };

const m = (he: string, en: string, unit: string | null, order: number, extra: Partial<Axis> = {}): Axis => ({
  label: { he, en }, unit, role: "measurement", order, chart: true, report: true, alertable: true, ...extra,
});
const aux = (he: string, en: string, unit: string | null, order: number, extra: Partial<Axis> = {}): Axis => ({
  label: { he, en }, unit, role: "auxiliary", order, chart: true, report: false, alertable: false, ...extra,
});
const crackX = m("פתיחת סדק", "Crack opening", "mm", 1, { suspectJump: 5 });
const temp = (order: number) => aux("טמפרטורה", "Temperature", "°C", order);

// Registry content: axes.md §5 with decisions A–C
const REGISTRY: Record<string, TypeEntry> = {
  prism: {
    smoothingWindowHours: 48,
    axes: {
      HeightDisplacement: m("שקיעה", "Settlement", "mm", 1, { suspectJump: 100 }),
      EastingDisplacement: m("תזוזה מזרח", "East displacement", "mm", 2, { suspectJump: 100 }),
      NorthingDisplacement: m("תזוזה צפון", "North displacement", "mm", 3, { suspectJump: 100 }),
      TwoDDisplacement: {
        ...m("תזוזה אופקית", "Horizontal displacement (2D)", "mm", 4, { suspectJump: 100 }),
        role: "derived", alertable: false, derivedFrom: ["EastingDisplacement", "NorthingDisplacement"],
      },
    },
  },
  tilt: { smoothingWindowHours: 24, axes: { x: m("הטיה X", "Tilt X", "°", 1, { suspectJump: 1 }), y: m("הטיה Y", "Tilt Y", "°", 2, { suspectJump: 1 }) } },
  crack: { smoothingWindowHours: 24, axes: { x: crackX } },
  cracktemp: { smoothingWindowHours: 24, axes: { x: crackX, y: temp(2), celsius: temp(3) } },
  OPKON_60_Potentiometer: { smoothingWindowHours: 24, axes: { x: crackX } },
  OPKON_100_Potentiometer: { smoothingWindowHours: 24, create: true, axes: { x: crackX } },
  loadcell: { smoothingWindowHours: 24, axes: { x: m("עומס", "Load", "kg", 1), raw: { ...aux("ערך גולמי", "Raw counts", null, 2), chart: false } } },
  "load-cell-stretch": { smoothingWindowHours: 24, axes: { kg: m("עומס", "Load", "kg", 1) } },
  battery: { smoothingWindowHours: 24, axes: { voltage: { ...aux("מתח סוללה", "Battery voltage", "V", 1), alertable: true } } },
  straingage: { smoothingWindowHours: 24, axes: { x: m("מעוות", "Strain", "µε", 1) } },
  staringauge: { smoothingWindowHours: 24, axes: { x: m("מעוות", "Strain", "µε", 1) } },
  inclinometer: {
    smoothingWindowHours: 24, create: true,
    axes: { x: m("X", "X", null, 1), y: m("Y", "Y", null, 2), temperature: temp(3) }, // units to verify (axes.md)
  },
  vibration_vf: {
    axes: { velocity: m("מהירות", "Velocity", "mm/s", 1), frequency: { ...m("תדר", "Frequency", "Hz", 2), alertable: false } },
  },
  "vibration-din": {
    // DIN 4150-3 has its own evaluation (not thresholds.axes), so nothing is alertable here
    axes: { velocity: { ...m("מהירות", "Velocity", "mm/s", 1), alertable: false }, frequency: { ...m("תדר", "Frequency", "Hz", 2), alertable: false } },
  },
  vibration: {
    axes: { velocity: { ...m("מהירות", "Velocity", "mm/s", 1), alertable: false }, frequency: { ...m("תדר", "Frequency", "Hz", 2), alertable: false } },
  },
};
const PROBE_ID = "sen-OPKON_100_Potentiometer-TEMP(one-wire)-UN-2";
const TYPES_PATH = "devices-types/sensors/devices";

type Backup = { path: string; fields: Record<string, unknown> }; // value undefined = field didn't exist

const getPath = (obj: any, dotted: string) => dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

run(async () => {
  const args = parseArgs();
  const outDir = path.resolve(__dirname, "../../out");

  // ── UNDO ──────────────────────────────────────────────────────────────
  const undoFile = str(args.undo);
  if (undoFile) {
    const backups: Backup[] = JSON.parse(fs.readFileSync(path.resolve(undoFile), "utf8"));
    console.log(`Undo: restoring ${backups.length} docs from ${undoFile}`);
    backups.slice(0, 10).forEach((b) => console.log(`  ${b.path}: ${Object.keys(b.fields).join(", ")}`));
    if (!(await confirmApply(args, `restore ${backups.length} docs (axis registry undo)`))) return;
    const w = new BatchWriter();
    for (const b of backups) {
      const ref = db.doc(b.path);
      if (b.fields.__created) { await w.delete(ref); continue; }
      const upd: Record<string, unknown> = {};
      Object.entries(b.fields).forEach(([k, v]) => (upd[k] = v === null || v === undefined ? FieldValue.delete() : v));
      await w.update(ref, upd);
    }
    await w.flush();
    console.log(`✅ undo done: ${w.committed} writes`);
    return;
  }

  const plan: { ref: DocumentReference; kind: "set" | "update"; data: Record<string, unknown>; backup: Backup; note: string }[] = [];

  // 1. registry on devices-types docs
  for (const [type, entry] of Object.entries(REGISTRY)) {
    const ref = db.doc(`${TYPES_PATH}/${type}`);
    const snap = await ref.get();
    if (!snap.exists && !entry.create) {
      console.log(`  ⚠️  ${type}: no devices-types doc and not marked create — skipped`);
      continue;
    }
    const cur = snap.data() ?? {};
    const data: Record<string, unknown> = { axes: entry.axes, axesVersion: 1, axesUpdatedAt: Date.now(), axesSource: "handbook ops/src/oneoff/2026-10-05-axis-registry.ts" };
    if (entry.smoothingWindowHours) data.smoothingWindowHours = entry.smoothingWindowHours;
    if (!snap.exists) {
      data["chart-axes"] = Object.fromEntries(Object.entries(entry.axes).filter(([, a]) => a.chart).map(([k, a]) => [k, a.unit ?? ""]));
      data.type = type;
    }
    const chartAxes = Object.keys(cur["chart-axes"] ?? {});
    const regAxes = Object.keys(entry.axes);
    const onlyChart = chartAxes.filter((a) => !regAxes.includes(a));
    const onlyReg = regAxes.filter((a) => !chartAxes.includes(a));
    plan.push({
      ref, kind: "set", data,
      backup: { path: ref.path, fields: snap.exists ? { axes: cur.axes ?? null, axesVersion: cur.axesVersion ?? null, axesUpdatedAt: cur.axesUpdatedAt ?? null, axesSource: cur.axesSource ?? null, smoothingWindowHours: cur.smoothingWindowHours ?? null } : { __created: true } },
      note: `${snap.exists ? "update" : "CREATE"} ${type}: axes [${regAxes.join(", ")}]` +
        (onlyChart.length ? ` | chart-axes only (left as is): ${onlyChart.join(", ")}` : "") +
        (snap.exists && onlyReg.length ? ` | registry only (not yet in chart-axes): ${onlyReg.join(", ")}` : ""),
    });
  }

  // 2. decision B — cracktemp y
  const cracktemps = await db.collection("work-sensors").where("type", "==", "cracktemp").get();
  for (const d of cracktemps.docs) {
    const x = d.data();
    const fields = ["thresholds.axes.y", "status.axes.y", "alert_state.axes.y"].filter((f) => getPath(x, f) !== undefined);
    if (!fields.length) continue;
    plan.push({
      ref: d.ref, kind: "update",
      data: Object.fromEntries(fields.map((f) => [f, FieldValue.delete()])),
      backup: { path: d.ref.path, fields: Object.fromEntries(fields.map((f) => [f, getPath(x, f)])) },
      note: `cracktemp ${d.id} "${x.name ?? ""}" @${x.location?.site ?? "?"}: delete ${fields.join(", ")} (thr y = ${JSON.stringify(x.thresholds?.axes?.y ?? null)})`,
    });
  }

  // 3. decision C — temperature probe
  const probe = await db.collection("work-sensors").doc(PROBE_ID).get();
  if (probe.exists) {
    const x = probe.data()!;
    const fields = ["thresholds.axes.celsius", "status.axes.celsius", "alert_state.axes.celsius"].filter((f) => getPath(x, f) !== undefined);
    plan.push({
      ref: probe.ref, kind: "update",
      data: { type: "cracktemp", ...Object.fromEntries(fields.map((f) => [f, FieldValue.delete()])) },
      backup: { path: probe.ref.path, fields: { type: x.type, ...Object.fromEntries(fields.map((f) => [f, getPath(x, f)])) } },
      note: `probe ${PROBE_ID}: type ${x.type} → cracktemp; delete ${fields.join(", ") || "(no celsius fields)"}`,
    });
  } else console.log(`  ⚠️  probe ${PROBE_ID} not found`);

  // SHOW
  console.log(`\nPlanned writes: ${plan.length}\n`);
  plan.forEach((p) => console.log(`  • ${p.note}`));
  console.log(`\nRegistry preview (prism):\n${JSON.stringify(REGISTRY.prism, null, 2)}`);

  if (!plan.length || !(await confirmApply(args, `write axis registry to ${Object.keys(REGISTRY).length} types + clear temperature thresholds on ${plan.length - Object.keys(REGISTRY).length} sensors`))) return;

  // BACKUP, then WRITE
  fs.mkdirSync(outDir, { recursive: true });
  const backupFile = path.join(outDir, `axis-registry-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(plan.map((p) => p.backup), null, 2));
  console.log(`Backup: ${backupFile}`);

  const w = new BatchWriter();
  for (const p of plan) await (p.kind === "set" ? w.set(p.ref, p.data, true) : w.update(p.ref, p.data));
  await w.flush();
  console.log(`✅ done: ${w.committed} writes. Undo: --undo=${path.relative(process.cwd(), backupFile)} --apply`);
});
