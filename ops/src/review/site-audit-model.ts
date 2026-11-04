import { median } from "../lib/signal";
import { clusterLevels, periods } from "../lib/levels";

export const DAY = 86400000;
export type Axis = { key: string; label: string; unit: string; jump: number | null };
export type Event = { id: string; time: number; reason: string; note: string; continuity: boolean; initial: Record<string, number>; createdAt: number | null };
export type Sample = { t: number; raw: (number | null)[]; smooth: (number | null)[]; suspect: boolean; reason: string; replay: boolean; worked: boolean };
export type Finding = { key: string; kind: "human" | "technical" | "field" | "scope"; text: string };
export const numeric = (v: unknown): number | null => (typeof v === "number" || typeof v === "string" && v.trim() !== "") && Number.isFinite(Number(v)) ? Number(v) : null;
export const med = (v: (number | null)[]) => { const x = v.filter((n): n is number => n !== null && Number.isFinite(n)); return x.length ? median(x) : null; };
const low = (a: number[], t: number) => { let l = 0, h = a.length; while (l < h) { const m = (l + h) >>> 1; if (a[m] < t) l = m + 1; else h = m; } return l; };
export function baselineAt(events: Event[], initial: Record<string, number>, t: number): Record<string, number> {
  let value = initial;
  for (const event of events) { if (event.time > t) break; value = event.initial; }
  return value;
}
export function gate(times: number[], t: number, window: number, reset: number | null): "candidate" | "sparse" | "coverage" | "reset" {
  const start = Math.max(t - window, reset ?? -Infinity);
  const win = times.slice(low(times, start), low(times, t + 1));
  const spacing = win.slice(1).map((x, i) => x - win[i]).filter(x => x > 0);
  const interval = spacing.length ? median(spacing) : 0;
  const minN = Math.max(3, Math.ceil(interval ? window / interval / 4 : 0));
  const cut = reset !== null && reset > t - window;
  if (win.length < minN) return cut ? "reset" : "sparse";
  const quarters = new Set(win.map(x => { const offset = x - (t - window); let f = ((offset % DAY) + DAY) % DAY; if (f === 0 && offset > 0) f = DAY; return Math.min(3, Math.floor(f / (DAY / 4))); }));
  return quarters.size < 3 ? cut ? "reset" : "coverage" : "candidate";
}
export function analyze(samples: Sample[], axes: Axis[], events: Event[], initial: Record<string, number>, options: { from: number; now: number; window: number; type: string; expectsMA: boolean; partial: boolean; latest: number | null }) {
  const counts = { eligible: 0, suspect: 0, replay: 0, worked: 0, anyMA: 0, fullMA: 0, candidate: 0, sparse: 0, coverage: 0, reset: 0, missingBaseline: 0 };
  const eligible = samples.filter(s => !s.replay && s.raw.some(v => v !== null));
  const validTimes = eligible.filter(s => !s.suspect).map(s => s.t);
  const resets = events.filter(e => !e.continuity && e.reason !== "iron").map(e => e.time);
  const reasons: Record<string, number> = {};
  const daily = new Map<number, { n: number; clean: number; ma: number; fullMA: number; suspect: number; raw: (number | null)[][]; smooth: (number | null)[][]; bad: (number | null)[][]; min: (number | null)[]; max: (number | null)[]; candidate: number }>();
  const gaps: { from: number; to: number; days: number; trailing: boolean }[] = [];
  const windowCache = new Map<number, ReturnType<typeof gate>>();
  const gapThreshold = Math.max(2 * options.window, 2 * DAY);
  let previous: number | null = null;
  for (const s of samples) {
    if (s.replay) { counts.replay++; continue; }
    if (!s.raw.some(v => v !== null)) continue;
    counts.eligible++; if (s.worked) counts.worked++;
    if (previous !== null && s.t - previous >= gapThreshold) gaps.push({ from: previous, to: s.t, days: (s.t - previous) / DAY, trailing: false });
    previous = s.t;
    const base = baselineAt(events, initial, s.t);
    const adjusted = axes.map((a, i) => s.raw[i] === null || numeric(base[a.key]) === null ? null : s.raw[i]! - Number(base[a.key]));
    if (adjusted.every(x => x === null)) counts.missingBaseline++;
    const day = Math.floor(s.t / DAY) * DAY;
    const row = daily.get(day) ?? { n: 0, clean: 0, ma: 0, fullMA: 0, suspect: 0, raw: axes.map(() => []), smooth: axes.map(() => []), bad: axes.map(() => []), min: axes.map(() => null), max: axes.map(() => null), candidate: 0 };
    row.n++;
    if (s.suspect) { counts.suspect++; row.suspect++; reasons[s.reason || "unspecified"] = (reasons[s.reason || "unspecified"] || 0) + 1; }
    else {
      row.clean++;
      const has = s.smooth.some(v => v !== null);
      if (has) { counts.anyMA++; row.ma++; }
      if (s.raw.every((v, i) => v === null || s.smooth[i] !== null)) { counts.fullMA++; row.fullMA++; }
      if (!has && options.expectsMA) {
        const reset = resets.filter(t => t <= s.t).at(-1) ?? null;
        const cacheKey = samples.length > 5000 ? Math.floor(s.t / (DAY / 4)) : s.t;
        let reason = windowCache.get(cacheKey);
        if (!reason) { reason = gate(validTimes, s.t, options.window, reset); windowCache.set(cacheKey, reason); }
        counts[reason]++; if (reason === "candidate") row.candidate++;
      }
    }
    axes.forEach((_, i) => {
      (s.suspect ? row.bad[i] : row.raw[i]).push(adjusted[i]);
      if (!s.suspect && adjusted[i] !== null) { row.min[i] = row.min[i] === null ? adjusted[i] : Math.min(row.min[i]!, adjusted[i]!); row.max[i] = row.max[i] === null ? adjusted[i] : Math.max(row.max[i]!, adjusted[i]!); }
      if (!s.suspect) row.smooth[i].push(s.smooth[i]);
    });
    daily.set(day, row);
  }
  const days = [...daily].sort((a, b) => a[0] - b[0]).map(([t, r]) => ({ t, n: r.n, ma: r.ma, fullMA: r.fullMA, suspect: r.suspect, candidate: r.candidate, raw: r.raw.map(med), smooth: r.smooth.map(med), bad: r.bad.map(med), min: r.min, max: r.max }));
  if (options.latest !== null && options.now - options.latest >= gapThreshold) gaps.push({ from: options.latest, to: options.now, days: (options.now - options.latest) / DAY, trailing: true });
  const shifts: { time: number; axis: string; delta: number; before: number; after: number }[] = [];
  for (let i = 3; i + 3 <= days.length; i++) {
    if (days[i - 1].t - days[i - 3].t > 5 * DAY || days[i + 2].t - days[i].t > 5 * DAY || days[i].t - days[i - 1].t > 14 * DAY) continue;
    axes.forEach((a, k) => {
      const before = med(days.slice(i - 3, i).map(d => d.raw[k]));
      const after = med(days.slice(i, i + 3).map(d => d.raw[k]));
      const limit = options.type === "prism" ? 100 : a.jump;
      if (limit === null || before === null || after === null || Math.abs(after - before) < limit) return;
      if (events.some(e => Math.abs(e.time - days[i].t) < 2 * DAY)) return;
      if (shifts.some(s => s.axis === a.key && Math.abs(s.time - days[i].t) < 7 * DAY)) return;
      shifts.push({ time: days[i].t, axis: a.key, delta: after - before, before, after });
    });
  }
  let levels: { label: string; n: number; values: (number | null)[]; periods: { from: number; to: number; n: number }[] }[] = [];
  if (options.type === "prism") {
    const pts = days.filter(d => d.raw.some(x => x !== null)).map(d => ({ t: d.t, v: d.raw.map(x => x ?? NaN), suspect: false }));
    const labels = clusterLevels(pts), runs = periods(pts, labels);
    const unique = [...new Set(labels.filter(l => l >= 0))];
    levels = unique.map(l => ({ label: String.fromCharCode(65 + l), n: labels.filter(x => x === l).length, values: axes.map((_, k) => med(pts.filter((_, i) => labels[i] === l).map(p => Number.isFinite(p.v[k]) ? p.v[k] : null))), periods: runs.filter(r => r.level === l).map(({ from, to, n }) => ({ from, to, n })) }));
  }
  const findings: Finding[] = [];
  if (options.partial) findings.push({ key: "partial", kind: "scope", text: "היסטוריה חלקית: נבדקו רק הרשומות האחרונות במגבלת הסריקה. אין להסיק על התקופה שלא נקראה." });
  if (!samples.length) findings.push({ key: "no-data", kind: "field", text: "לא נמצאו מדידות בטווח שנבדק. יש לבדוק תאריכים, חיבור וייעוד החיישן." });
  if (counts.missingBaseline) findings.push({ key: "baseline", kind: "technical", text: "חסרה נקודת אפס לפחות לחלק מהמדידות; אין לייחס להן תזוזה מאפס משוער." });
  if (levels.length > 1 || shifts.length) findings.push({ key: "levels", kind: "human", text: "נמצאו רמות או שינויי רמה גדולים אחרי יישום הבייסליינים הקיימים. זוהי אינדיקציה לבדיקה, לא אישור לגיהוץ." });
  if (counts.candidate > Math.max(5, counts.eligible * 0.02)) findings.push({ key: "ma", kind: "technical", text: "יש מדידות בלי MA שנראות מתאימות לבדיקה באמצעות recompute dry-run. האומדן אינו בודק MAD או נעילת ייחוס." });
  if (counts.suspect > Math.max(5, counts.eligible * 0.03)) findings.push({ key: "suspect", kind: "human", text: "חלק משמעותי מהמדידות מסומן חשוד. אין להסיר סימונים לפני בדיקת הסיבה והתקופה." });
  if (gaps.some(g => g.trailing)) findings.push({ key: "stale", kind: "field", text: "אין מדידה עדכנית ביחס לחלון שנבדק. יש לאמת לוח מדידות ותקשורת, לא להמציא נתונים." });
  if (gaps.some(g => !g.trailing)) findings.push({ key: "gaps", kind: "field", text: "פערים אמיתיים בין מדידות: recompute לא יוכל להשלים אותם." });
  if (counts.sparse + counts.coverage + counts.reset > Math.max(5, counts.eligible * 0.05)) findings.push({ key: "window", kind: "technical", text: "חלונות דלילים, כיסוי יומי חסר או מילוי אחרי איפוס מסבירים חלק מחוסר ה-MA." });
  return { counts, reasons, days, gaps, shifts, levels, findings, gateEstimatedBySixHours: samples.length > 5000 };
}

export type FocusSensor = {
  id: string; type: string; axes: Axis[]; expectsMA: boolean; partial: boolean;
  assessedFrom?: number | null; first?: number | null; latest?: number | null;
  readings?: number | null; error?: string | null; noMeasurementValues?: boolean;
  events?: { time: number }[]; analysis?: ReturnType<typeof analyze>;
};
export type JumpChange = { axis: string; before: number; after: number; delta: number; limit: number };
export type JumpProposal = { id: string; time: number; lastBeforeDay: number; firstAfterDay: number; acrossGap: boolean; changes: JumpChange[] };
export function focusedReview(sensor: FocusSensor, from: number, until: number) {
  const a = sensor.analysis;
  const supported = !sensor.error && !!a && sensor.axes.length > 0 && !sensor.noMeasurementValues && !sensor.type.startsWith("vibration") && sensor.type !== "battery";
  const days = supported ? a!.days.filter(d => d.n > 0) : [];
  const start = Math.max(from, sensor.assessedFrom ?? from, sensor.first ?? from);
  const rawGaps: { from: number; to: number; trailing: boolean; dailyEstimate: boolean }[] = [];
  if (supported) {
    for (let i = 1; i < days.length; i++) {
      if (days[i].t - days[i - 1].t > DAY) rawGaps.push({ from: Math.max(start, days[i - 1].t + DAY), to: days[i].t, trailing: false, dailyEstimate: true });
    }
    for (const g of a!.gaps.filter(g => !g.trailing)) {
      if (!rawGaps.some(r => r.from < g.to && r.to > g.from)) rawGaps.push({ from: Math.max(start, g.from), to: Math.min(until, g.to), trailing: false, dailyEstimate: false });
    }
    if (sensor.latest && until - sensor.latest >= 2 * DAY) rawGaps.push({ from: Math.max(start, sensor.latest), to: until, trailing: true, dailyEstimate: false });
    else if (!days.length && start < until) rawGaps.push({ from: start, to: until, trailing: true, dailyEstimate: true });
  }
  const c = a?.counts;
  const clean = c ? c.eligible - c.suspect : 0;
  const maMissing = supported && sensor.expectsMA ? Math.max(0, clean - c!.fullMA) : 0;
  const maGaps: { from: number; to: number; missing: number; axes: string[] }[] = [];
  if (supported && sensor.expectsMA) for (const d of days) {
    const cleanDay = d.n - d.suspect;
    const missing = Math.max(0, cleanDay - (d.fullMA ?? d.ma));
    const missingAxes = sensor.axes.filter((_, k) => d.raw[k] !== null && d.smooth[k] === null).map(ax => ax.key);
    if (!cleanDay || !missing && !missingAxes.length) continue;
    const last = maGaps.at(-1);
    if (last && last.to === d.t && last.axes.join() === missingAxes.join()) { last.to += DAY; last.missing += missing; }
    else maGaps.push({ from: d.t, to: d.t + DAY, missing, axes: missingAxes });
  }
  const cleanDays = days.filter(d => d.raw.some(v => v !== null));
  const proposals: JumpProposal[] = [];
  for (let i = 3; i + 3 <= cleanDays.length; i++) {
    const beforeDays = cleanDays.slice(i - 3, i), afterDays = cleanDays.slice(i, i + 3);
    if (beforeDays[2].t - beforeDays[0].t > 7 * DAY || afterDays[2].t - afterDays[0].t > 7 * DAY) continue;
    const boundary = cleanDays[i].t;
    if (sensor.events?.some(e => e.time >= cleanDays[i - 1].t - DAY && e.time <= boundary + DAY)) continue;
    const changes: JumpChange[] = [];
    sensor.axes.forEach((ax, k) => {
      const b = beforeDays.map(d => d.raw[k]), f = afterDays.map(d => d.raw[k]);
      if (b.some(v => v === null) || f.some(v => v === null)) return;
      const before = med(b)!, after = med(f)!, delta = after - before;
      const baseLimit = sensor.type === "prism" ? 3 : ax.jump && ax.jump > 0 ? ax.jump : null;
      if (baseLimit === null) return;
      const neighboring = cleanDays.slice(Math.max(0, i - 10), Math.min(cleanDays.length, i + 10));
      const noise = med(neighboring.slice(1).map((d, j) => d.t - neighboring[j].t <= 2 * DAY && d.raw[k] !== null && neighboring[j].raw[k] !== null ? Math.abs(d.raw[k]! - neighboring[j].raw[k]!) : null)) ?? 0;
      const spread = Math.max(...b.map(v => Math.abs(v! - before)), ...f.map(v => Math.abs(v! - after)));
      const limit = Math.max(baseLimit, 6 * noise, 4 * spread);
      if (Math.abs(delta) < limit || Math.abs(cleanDays[i].raw[k]! - cleanDays[i - 1].raw[k]!) < Math.abs(delta) * 0.6) return;
      if (proposals.some(p => Math.abs(p.time - boundary) <= 4 * DAY && p.changes.some(change => change.axis === ax.key))) return;
      changes.push({ axis: ax.key, before, after, delta, limit });
    });
    if (changes.length) proposals.push({ id: `${sensor.id}:${boundary}`, time: boundary, lastBeforeDay: cleanDays[i - 1].t, firstAfterDay: boundary, acrossGap: boundary - cleanDays[i - 1].t > DAY, changes });
  }
  const mappingHold = a?.findings.some(f => f.key === "previous-review" && /שתי פריזמות|מיפוי|לא בטוח/.test(f.text)) ?? false;
  const unresolvedLevels = !!a && (a.levels.length > 1 || a.shifts.length > 0) && !proposals.length;
  const referenceDay = cleanDays.at(-1)?.t ?? null;
  const reference = sensor.axes.map((_, k) => med(cleanDays.filter(d => referenceDay !== null && d.t >= referenceDay - 2 * DAY).slice(-3).map(d => d.raw[k])));
  return {
    supported, partial: sensor.partial, from: start, rawGaps: rawGaps.filter(g => g.to > g.from).sort((x, y) => x.from - y.from),
    maMissing, maGaps, maDatesIncomplete: maMissing > maGaps.reduce((sum, gap) => sum + gap.missing, 0),
    proposals, mappingHold, unresolvedLevels, referenceDay, reference,
    needsJumpReview: supported && (proposals.length > 0 || mappingHold || unresolvedLevels),
  };
}

export function ironingOffset(proposals: JumpProposal[], axis: string, t: number, anchor: number) {
  const cumulative = (time: number) => proposals.reduce((sum, p) => sum + (p.time <= time ? p.changes.find(change => change.axis === axis)?.delta ?? 0 : 0), 0);
  return cumulative(anchor) - cumulative(t);
}
