import { db } from "../lib/firebase";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const site = "e39vIWXDt7L0peeTW81q";
const section = "demo-unshifted-20261029";
const ids = ["ez7QOIidMYCpkqPzqvjE", "mCPL5VROtwlc8by0DFTj", "zoHkA64eoO1BKsdL5Kr4", "6stWmfxjiH3VvBjJ4Fnr", "WsnJcTZnVYHdFFFyqOy9"];
const axes = ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"];
const absolute = ["Easting", "Northing", "Height"];
const from = [Date.parse("2026-09-10"), Date.parse("2026-09-10"), Date.parse("2026-09-12")];
const to = Date.parse("2026-09-26T23:59:59Z");
const apply = process.argv.includes("--apply");
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const round = (v: number) => Math.round(v * 10) / 10;
const out = resolve("out/maccabi-unshifted-20261029.json");

async function main() {
  const project = db.doc(`projects/${site}`);
  const sectionRef = project.collection("sections").doc(section);
  if ((await sectionRef.get()).exists) throw new Error("Comparison section already exists; refusing to overwrite");
  const originalSection = (await project.collection("sections").doc("sec-1").get()).data()!;
  const plans = [];
  for (const id of ids) {
    const ref = db.doc(`work-sensors/${id}`);
    const sensor = (await ref.get()).data()!;
    const snapshot = await ref.collection("data-log").orderBy("time").get();
    const docs = snapshot.docs.map(d => ({ id: d.id, data: d.data() }));
    const readings = docs.filter(({ data: d }) => axes.every(a => typeof d[a] === "number") && d.source !== "derived:daily");
    const usable = readings.filter(({ data: d }) => !d.suspect);
    const before = usable.filter(({ data: d }) => d.time >= Date.parse("2026-08-27") && d.time < Date.parse("2026-09-10"));
    const after = usable.filter(({ data: d }) => d.time >= Date.parse("2026-10-01") && d.time < Date.parse("2026-10-29"));
    if (before.length < 20 || after.length < 20) throw new Error(`Insufficient comparison samples: ${sensor.name}`);
    const shifts = axes.map(a => mean(after.map(x => x.data[a])) - mean(before.map(x => x.data[a])));
    if (Math.abs(shifts[0]) > 2 || shifts[1] < 2.5 || shifts[1] > 4.5 || shifts[2] > -2.5 || shifts[2] < -4.5) throw new Error(`Unexpected shifts: ${sensor.name} ${shifts}`);
    const copyId = `${id}-unshifted-20261029`;
    const copied = readings.map(({ id: entryId, data: original }) => {
      const d = { ...original };
      for (const key of ["smooth", "eval", "suspect_reason", "processedAt", "processingDate", "runId", "derivedFromReplay", "replayedSampleCount", "genuineSampleCount"]) delete d[key];
      if (original.suspect_reason) d.suspect_reason = original.suspect_reason;
      axes.forEach((a, i) => {
        const u = Math.max(0, Math.min(1, (d.time - from[i]) / (to - from[i])));
        const delta = shifts[i] * (1 - (1 - u) ** 2);
        d[a] = round(original[a] - delta);
        if (typeof original[absolute[i]] === "number") d[absolute[i]] = round(original[absolute[i]] + d[a] - original[a]);
      });
      d.TwoDDisplacement = round(Math.hypot(d[axes[0]], d[axes[1]]));
      d.ThreeDDisplacement = round(Math.hypot(...axes.map(a => d[a])));
      d.isWorked = true;
      d.source = "worked";
      delete d.isReplay;
      d.demoComparison = { sourceSensorId: id, sourceEntryId: entryId, method: "reverse-ease-out-measured-plateau-shift", synthetic: true };
      return { id: entryId, data: d };
    });
    const baselines = await ref.collection("baseline-events").get();
    if (baselines.docs.some(d => d.data().time >= Math.min(...from))) throw new Error("Unexpected baseline during movement");
    const clone: Record<string, any> = { ...sensor, active: false, MAC: `DEMO-UNSHIFTED-${sensor.name}`, gateway: { device: "", channel: 0 }, facade: { atsId: "" }, location: { ...sensor.location, section }, demoComparison: { synthetic: true, sourceSensorId: id, shifts, method: "reverse-ease-out-measured-plateau-shift", createdAt: new Date().toISOString() } };
    for (const key of ["alert_state", "status", "last_seen_at", "subscriptions", "subscribers"]) delete clone[key];
    plans.push({ id, copyId, sensor, docs, clone, baselines: baselines.docs.map(d => ({ id: d.id, data: d.data() })), copied, shifts });
    console.log(`${sensor.name} -> ${copyId}: ${copied.length} samples; remove X/Y/Z ${shifts.map(x => x.toFixed(3)).join(" / ")} mm`);
  }
  writeFileSync(out, JSON.stringify({ site, section, createdAt: new Date().toISOString(), plans }, null, 2));
  console.log(`Full source snapshot and copy plan: ${out}`);
  if (!apply) return;
  const writer = db.bulkWriter();
  writer.create(sectionRef, { ...originalSection, name: "השוואה — ללא תזוזה יזומה", synthetic: true });
  for (const p of plans) {
    const ref = db.doc(`work-sensors/${p.copyId}`);
    await ref.create(p.clone);
    for (const event of p.baselines) writer.create(ref.collection("baseline-events").doc(event.id), event.data);
    for (const entry of p.copied) writer.create(ref.collection("data-log").doc(entry.id), entry.data);
  }
  await writer.close();
  for (const p of plans) {
    const count = await db.collection(`work-sensors/${p.copyId}/data-log`).count().get();
    if (count.data().count !== p.copied.length) throw new Error(`Count mismatch: ${p.copyId}`);
  }
  console.log("Created and verified new section; original documents unchanged.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
