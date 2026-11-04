import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { db } from "../lib/firebase";
import { parseArgs, str, num, toMs, run } from "../lib/cli";
import { sensorLabel, projectName } from "../lib/sensors";
import { analyze, focusedReview, numeric, DAY, type Axis, type Event, type Sample } from "./site-audit-model";

const args = parseArgs();
const now = Date.now();
const from = Date.parse(str(args.from) ?? "2025-11-01T00:00:00Z");
const cap = num(args.cap, 20000);
const output = path.resolve(str(args.out) ?? "out/site-audit-2026-11-01");
const config = { id: "dataloggerdev", createdAt: new Date(now).toISOString(), from, until: now, cap, schemaVersion: 1, timeZone: "UTC", readOnly: true };
const known: Record<string, string> = {
  "1E6nK59E5xWEAXKE4Lmv": "אישור קודם: שתי פריזמות בחיישן אחד (יפו 68, 6). לא נמצא אישור לפיצול; נשאר לבדיקת מיפוי.",
  "lCzOkCIT88VwrLQPMAkM": "סקירה קודמת: לא בטוח (יפו 68, 8). אין להניח שהקפיצה היא תנועת מבנה או לגהץ ללא אישור.",
  "0wD0jDKhIH4wJk1s6G8v": "אישור קודם: שתי פריזמות (נבון 7). נדרשת בדיקת מיפוי, לא יישור אוטומטי.",
};
const followup = new Set(["sen-prism-PRISM_JTCS_H0_12A", "sen-prism-prism_JTCS_H0_7B", "sen-prism-PRISM_JTCS_H0_12B", "BvFFi6GLTzf0A2JHFjpk", "W5CWaz4bDuEN6sFWjsNI", "sen-prism-PRISM_JTCS_H0_9A"]);
const prepared = new Set(["sen-prism-PRISM_JTCS_H0_8A", "sen-prism-PRISM_JTCS_H0_8B", "sen-prism-PRISM_JTCS_H0_10A", "sen-prism-PRISM_JTCS_H0_11A", "sen-prism-PRISM_JTCS_H0_11B"]);
const decisions = new Set(["xmXaS7p7cjlRTkoRZhrs", "AG6010IORg3UCFmN0r3A", "XnYw2FlxUawGpur9qXba", "sen-prism-PRISM_JTCS_H0_9B", "sen-prism-prism_JTCS_H2_3F"]);
const excludedMA = (type: string) => type.startsWith("vibration") || type === "battery";
const round = (n: number | null) => n === null ? null : Math.round(n * 10000) / 10000;
const finalize = (payload: any) => {
  for (const project of payload.projects) {
    project.sensors.sort((a: any, b: any) => Number(b.type === "prism") - Number(a.type === "prism") || a.type.localeCompare(b.type) || String(a.name).localeCompare(String(b.name), "he", { numeric: true }));
    for (const s of project.sensors) {
      if (s.analysis?.counts.eligible === 0 && s.readings > 0 && !excludedMA(s.type) && s.axes.length) {
        s.maScope = "יש רשומות, אך אין בהן ערכים בצירי המדידה שנבחרו. ייתכן חיישן טמפרטורה בלבד או סכימה אחרת; נדרשת בדיקה ייעודית, לא השלמת MA אוטומטית.";
        s.noMeasurementValues = true;
        s.expectsMA = false;
        s.partial = true;
        s.analysis.findings = s.analysis.findings.filter((f: any) => !["no-data", "no-thresholds", "measurement-schema"].includes(f.key));
        s.analysis.findings.push({ key: "measurement-schema", kind: "scope", text: s.maScope });
      }
      s.gapThresholdHours = Math.max(2 * s.windowHours, 48);
      s.focus = focusedReview(s, payload.from, payload.until);
    }
  }
  return payload;
};

run(async () => {
  if (str(args.render)) {
    const payload = finalize(JSON.parse(fs.readFileSync(path.resolve(str(args.render)!), "utf8")));
    if (payload.id !== "dataloggerdev" || payload.schemaVersion !== 1 || !payload.finishedAt) throw new Error("A completed audit snapshot is required");
    const template = fs.readFileSync(path.join(__dirname, "site-audit.html"), "utf8");
    const json = JSON.stringify(payload).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    fs.writeFileSync(`${output}.html`, template.replace("__AUDIT_DATA__", json));
    console.log(`${output}.html (offline render; no database queries)`);
    return;
  }
  if (!Number.isFinite(from) || from >= now || !Number.isInteger(cap) || cap < 100) throw new Error("Invalid date or cap");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const projectDocs = (await db.collection("projects").where("isActive", "==", true).get()).docs;
  const registry = new Map<string, any>();
  const projects: any[] = [];
  let totalReads = 0;
  for (const p of projectDocs) {
    const category = p.id === "j7prfbs8Mord8g4cgNb5" ? "test" : p.id === "e39vIWXDt7L0peeTW81q" ? "demo" : "operational";
    const all = (await db.collection("work-sensors").where("location.site", "==", p.id).get()).docs;
    const sections = (await p.ref.collection("sections").get()).docs;
    const sectionNames = new Map(sections.map(d => [d.id, String(d.data().name ?? d.id)]));
    const active = all.filter(d => d.data().active !== false);
    const project: any = { id: p.id, name: projectName(p.data()), category, inactiveSensors: all.length - active.length, sensors: [], snapshotStartedAt: new Date().toISOString() };
    console.log(`\n${project.name}: ${active.length} active sensors (${category})`);
    for (const doc of active) {
      const s = doc.data(), type = String(s.type ?? "unknown");
      if (!registry.has(type)) registry.set(type, (await db.doc(`devices-types/sensors/devices/${type}`).get()).data() ?? null);
      const reg = registry.get(type);
      const ref = doc.ref.collection("data-log");
      const meta: any = { id: doc.id, name: sensorLabel(s, doc.id), type, section: sectionNames.get(s.location?.section) ?? s.location?.section ?? "", confirmed: s.confirmed !== false, readings: null, latest: null, first: null, axes: [], notes: [], completed: [], error: null };
      try {
        const start = Math.max(0, from - 2 * DAY);
        const query = ref.where("time", ">=", start).where("time", "<=", now);
        const [count, earliest, latest, evSnap] = await Promise.all([query.count().get(), ref.orderBy("time").limit(1).get(), ref.where("time", "<=", now).orderBy("time", "desc").limit(10).get(), doc.ref.collection("baseline-events").get()]);
        meta.readings = count.data().count;
        meta.first = earliest.empty ? null : toMs(earliest.docs[0].data().time);
        meta.latest = latest.docs.map(d => ({ id: d.id, data: d.data() })).find(d => !d.id.startsWith("daily::") && d.data.source !== "derived:daily")?.data.time ?? null;
        const events: Event[] = evSnap.docs.map(d => { const x = d.data(); return { id: d.id, time: toMs(x.time) ?? NaN, reason: String(x.reason ?? ""), note: String(x.note ?? ""), continuity: x.continuity === true || x.reason === "iron", initial: x.initial ?? {}, createdAt: toMs(x.createdAt) }; }).filter(e => Number.isFinite(e.time)).sort((a, b) => a.time - b.time);
        const iron = events.filter(e => e.reason === "iron" || /^(iron:|flatten:)/.test(e.note));
        meta.events = events.map(({ initial, ...e }) => e);
        meta.ironCount = iron.length;
        if (p.id === "hmPh7Hg2fjTc9GyNRDYO" && iron.length) meta.completed.push("דה וינצי: אירועי הגיהוץ/האפס ההיסטוריים עדיין קיימים בפרודקשן. 21 כרטיסי הסקירה כבר טופלו ב-20.10; תיקון רציפות MA וריצה נוספת ב-23.10. אין להחיל שוב את הסקירה הישנה.");
        if (decisions.has(doc.id) && events.some(e => e.note.includes("Nathan 2026-10-25"))) meta.completed.push("בחירת הרמה של נתן מ-25.10 יושמה; יש אירועי בייסליין תואמים ורשומת recompute. לא ממתין שוב לאותה החלטה.");
        if (["sen-prism-PRISM_JTCS_H0_12A", "sen-prism-PRISM_JTCS_H0_12B"].includes(doc.id) && iron.length) meta.completed.push("קפיצות ספציפיות יושרו ב-25.10 (אירועים קיימים). אין בכך אישור לכל יתר התקופות בחיישן.");
        if (prepared.has(doc.id)) meta.notes.push(events.some(e => e.note.includes("level") && e.createdAt && e.createdAt >= Date.parse("2026-10-26")) ? "יש תיקוני רמה מאוחרים; נדרש לבדוק התאמה לתוכנית השמורה." : "קיים קובץ החלטות אוטומטיות מ-26.10, אך אין בייסליינים תואמים שמוכיחים החלה. תוכנית בלבד — לא הושלם.");
        if (known[doc.id]) meta.notes.push(known[doc.id]);
        if (followup.has(doc.id)) meta.notes.push("נכלל בסקירת ההמשך של נבון מ-26.10. יש להשוות את התקופות הנוכחיות, ולא להעתיק את טקסט ההקדמה הישן כהוכחת ביצוע.");
        if (!meta.confirmed) meta.notes.push("חיישן לא מאושר (confirmed=false). אין לראות בו חיישן פעיל מאומת.");
        const fields = type === "prism" ? ["EastingDisplacement", "NorthingDisplacement", "HeightDisplacement"] : Object.keys(reg?.axes ?? {}).filter(k => reg.axes[k].role === "measurement" && reg.axes[k].chart !== false);
        if (!fields.length && !excludedMA(type)) fields.push(...Object.keys(s["initial-value"] ?? {}).filter(k => !/temp|battery|volt/i.test(k)));
        const axes: Axis[] = fields.map(key => ({ key, label: reg?.axes?.[key]?.label?.he ?? key, unit: reg?.axes?.[key]?.unit ?? (type === "prism" ? "mm" : ""), jump: numeric(reg?.axes?.[key]?.suspectJump) }));
        meta.axes = axes;
        meta.initial = Object.fromEntries(axes.map(a => [a.key, numeric(s["initial-value"]?.[a.key])]));
        meta.thresholds = Object.fromEntries(axes.map(a => [a.key, s.thresholds?.axes?.[a.key] ?? null]));
        meta.expectsMA = !excludedMA(type) && axes.length > 0 && Object.keys(s.thresholds?.axes ?? {}).length > 0;
        meta.maScope = excludedMA(type) ? "לא נבדק MA: סוג חיישן זה אינו נבחן לפי כללי ה-MA של חיישני תזוזה." : !axes.length ? "לא זוהו צירי מדידה נתמכים; נדרשת בדיקת סכימה ייעודית." : !meta.expectsMA ? "אין ספי צירים פעילים; יש לבדוק אם חישוב MA מוגדר לחיישן." : "MA נבדק לפי הצירים הרשומים. אומדן החוסר אינו הרצת המנוע.";
        const windowHours = numeric(reg?.smoothingWindowHours) ?? (type === "prism" ? 48 : 24);
        meta.windowHours = windowHours;
        meta.partial = meta.readings > cap;
        let data: Sample[] = [];
        if (!excludedMA(type) && axes.length) {
          const snap = await query.orderBy("time", "desc").limit(cap).get();
          totalReads += snap.size;
          data = snap.docs.filter(d => !d.id.startsWith("daily::") && d.data().source !== "derived:daily").map(d => { const x = d.data(); return { t: toMs(x.time) ?? NaN, raw: axes.map(a => numeric(x[a.key])), smooth: axes.map(a => numeric(x.smooth?.[a.key])), suspect: x.suspect === true, reason: String(x.suspect_reason ?? ""), replay: x.isReplay === true || x.source === "replay", worked: x.isWorked === true || x.source === "worked" }; }).filter(x => Number.isFinite(x.t) && x.raw.some(v => v !== null)).sort((a, b) => a.t - b.t);
        }
        meta.assessedFrom = meta.partial ? data[0]?.t ?? null : from;
        const assessed = data.filter(x => x.t >= from);
        meta.analysis = analyze(assessed, axes, events, s["initial-value"] ?? {}, { from, now, window: windowHours * 3600000, type, expectsMA: meta.expectsMA, partial: meta.partial, latest: toMs(meta.latest) });
        meta.analysis.days.forEach((d: any) => { for (const key of ["raw", "smooth", "bad", "min", "max"]) d[key] = d[key].map(round); });
        if (excludedMA(type) || !axes.length) {
          meta.analysis.findings = meta.analysis.findings.filter((f: any) => f.key !== "no-data" && f.key !== "partial");
          meta.analysis.findings.push({ key: "unsupported", kind: "scope", text: meta.maScope });
          if (!meta.latest) meta.analysis.findings.push({ key: "no-data", kind: "field", text: "אין רשומה בעלת זמן מדידה בטווח ההיסטורי." });
          meta.partial = true;
        } else if (!meta.expectsMA) meta.analysis.findings.push({ key: "no-thresholds", kind: "technical", text: meta.maScope });
        if (known[doc.id] || followup.has(doc.id)) meta.analysis.findings.push({ key: "previous-review", kind: "human", text: known[doc.id] ?? "שאלת רמה מהסקירה הקודמת עדיין דורשת הכרעה מתועדת." });
        if (prepared.has(doc.id)) meta.analysis.findings.push({ key: "prepared", kind: "technical", text: "תוכנית שמורה ללא הוכחת החלה: לבדיקת הצוות לפני כל כתיבה." });
        meta.fingerprint = createHash("sha256").update(JSON.stringify({ events, latest: meta.latest, counts: meta.analysis.counts, shifts: meta.analysis.shifts })).digest("hex").slice(0, 16);
        console.log(`  ${meta.name} [${type}] ${assessed.length}/${meta.readings} records; ${meta.analysis.findings.map((f: any) => f.key).join(",") || "no finding"}`);
      } catch (error) {
        meta.error = error instanceof Error ? error.message : String(error);
        meta.partial = true;
        console.error(`  ${meta.name}: ${meta.error}`);
      }
      project.sensors.push(meta);
    }
    project.snapshotFinishedAt = new Date().toISOString();
    projects.push(project);
    fs.writeFileSync(`${output}.json`, JSON.stringify({ ...config, finishedAt: null, reads: totalReads, projects }, null, 1));
  }
  const payload = finalize({ ...config, finishedAt: new Date().toISOString(), reads: totalReads, projects });
  const template = fs.readFileSync(path.join(__dirname, "site-audit.html"), "utf8");
  const json = JSON.stringify(payload).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  fs.writeFileSync(`${output}.json`, JSON.stringify(payload, null, 1));
  fs.writeFileSync(`${output}.html`, template.replace("__AUDIT_DATA__", json));
  console.log(`\n${projects.length} sites; ${projects.reduce((n, p) => n + p.sensors.length, 0)} active sensors; ${totalReads} sample reads.\n${output}.html`);
});
