import { db } from "../lib/firebase";
import { copyFileSync, writeFileSync, constants, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const reports = resolve("../../scanin-svc-reports");
const dest = "/Users/hillelvidal/Downloads/macabi";
const ids = ["ez7QOIidMYCpkqPzqvjE", "mCPL5VROtwlc8by0DFTj", "zoHkA64eoO1BKsdL5Kr4", "6stWmfxjiH3VvBjJ4Fnr", "WsnJcTZnVYHdFFFyqOy9"];
const axes = ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"];
const variants = [
  { title: "מכבי יפו - תל אביב", suffix: "-unshifted-20261029" },
  { title: "מכבי יפו חפירה", suffix: "" },
];
const round = (n: number) => Math.round(n * 10000) / 10000;

async function main() {
  for (const variant of variants) {
    for (const ext of ["pdf", "csv"]) {
      if (existsSync(`${dest}/${variant.title}.${ext}`)) throw new Error(`Destination already exists: ${variant.title}.${ext}`);
    }
  }
  for (const variant of variants) {
    const sensors = ids.map(id => id + variant.suffix);
    const args = ["scripts/entry-points/render-only.js", "QpaWmsa4k2uOA1TjmVBN",
      `--set=sensors=${JSON.stringify([{ name: "קבוצה צפונית", sensors }])}`,
      `--set=reportName=${variant.title}`, `--set=projectName=${variant.title}`, "--set=reportId=REP136"];
    console.log(`Rendering ${variant.title}`);
    const rendered = spawnSync(process.execPath, args, { cwd: reports, env: process.env, encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
    writeFileSync(resolve(`out/maccabi-${variant.suffix ? "calm" : "excavation"}-render.log`), rendered.stdout + rendered.stderr);
    if (rendered.status !== 0) throw new Error(`Render failed: ${rendered.stderr.slice(-2000)}`);
    const match = rendered.stdout.match(/PDF: (.+\/pdfs\/report\.pdf)/);
    if (!match) throw new Error("Missing PDF output path");
    copyFileSync(resolve(reports, match[1].trim()), `${dest}/${variant.title}.pdf`, constants.COPYFILE_EXCL);
    const rows: { time: number; prism: string; values: number[]; suspect: boolean }[] = [];
    for (const id of sensors) {
      const ref = db.doc(`work-sensors/${id}`);
      const sensor = (await ref.get()).data()!;
      const baselineDocs = await ref.collection("baseline-events").orderBy("time").get();
      const events = baselineDocs.docs.map(d => d.data());
      const entries = await ref.collection("data-log").orderBy("time").get();
      for (const doc of entries.docs) {
        const d = doc.data();
        if (d.source === "derived:daily" || !axes.every(a => typeof d[a] === "number")) continue;
        if (d.time < Date.parse("2026-05-20") || d.time >= Date.parse("2026-10-29")) continue;
        const baseline = events.filter(e => e.time <= d.time).at(-1)?.initial ?? sensor["initial-value"];
        if (!axes.every(a => typeof baseline?.[a] === "number")) throw new Error(`Missing baseline: ${id}`);
        rows.push({ time: d.time, prism: sensor.name, values: axes.map(a => round(d[a] - baseline[a])), suspect: d.suspect === true });
      }
    }
    rows.sort((a, b) => a.time - b.time || a.prism.localeCompare(b.prism));
    const lines = ["timestamp_utc,prism,x_mm,y_mm,z_mm,suspect", ...rows.map(r => [new Date(r.time).toISOString(), r.prism, ...r.values, r.suspect].join(","))];
    writeFileSync(`${dest}/${variant.title}.csv`, "\uFEFF" + lines.join("\r\n") + "\r\n", { flag: "wx" });
    if (statSync(`${dest}/${variant.title}.pdf`).size < 10000 || rows.length !== 5145) throw new Error(`Unexpected export size: ${variant.title} ${rows.length}`);
    console.log(`${variant.title}: PDF ${(statSync(`${dest}/${variant.title}.pdf`).size / 1e6).toFixed(1)} MB; CSV ${rows.length} samples, ${rows.filter(r => r.suspect).length} suspect; ${new Date(rows[0].time).toISOString()} → ${new Date(rows.at(-1)!.time).toISOString()}`);
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
