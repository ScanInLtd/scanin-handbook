/**
 * Signal helpers for analysis/backtests (pure functions, no I/O).
 * Series are sorted by time; windows are TRAILING (causal) unless stated — what a live system can compute.
 */
export type Pt = { t: number; v: number };
export type Status = "ok" | "warn" | "alarm";
export const H = 3.6e6;
export const DAY = 24 * H;
const SEV: Record<Status, number> = { ok: 0, warn: 1, alarm: 2 };

export const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const mad = (a: number[]) => {
  const m = median(a);
  return median(a.map((x) => Math.abs(x - m)));
};
export const trimmedMean = (a: number[], pct: number) => {
  const s = [...a].sort((x, y) => x - y);
  const k = Math.floor(s.length * pct);
  const mid = k * 2 >= s.length ? [s[s.length >> 1]] : s.slice(k, s.length - k);
  return mid.reduce((x, y) => x + y, 0) / mid.length;
};
export const quantile = (a: number[], p: number) => {
  const s = [...a].filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN;
};

/** Apply fn to each trailing window (t-hours, t] — two-pointer, O(n·w). */
export function trailing(pts: Pt[], hours: number, fn: (vals: number[]) => number, minCount = 1): Pt[] {
  const out: Pt[] = [];
  let lo = 0;
  for (let i = 0; i < pts.length; i++) {
    while (pts[lo].t <= pts[i].t - hours * H) lo++;
    const vals: number[] = [];
    for (let j = lo; j <= i; j++) vals.push(pts[j].v);
    out.push({ t: pts[i].t, v: vals.length >= minCount ? fn(vals) : NaN });
  }
  return out;
}

/** Centred window (t-h/2, t+h/2] — for offline anatomy only (not causal). */
export function centred(pts: Pt[], hours: number, fn: (vals: number[]) => number): Pt[] {
  const half = (hours * H) / 2;
  const out: Pt[] = [];
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < pts.length; i++) {
    while (pts[lo].t < pts[i].t - half) lo++;
    while (hi < pts.length - 1 && pts[hi + 1].t <= pts[i].t + half) hi++;
    const vals: number[] = [];
    for (let j = lo; j <= hi; j++) vals.push(pts[j].v);
    out.push({ t: pts[i].t, v: fn(vals) });
  }
  return out;
}

const hourIL = (t: number) => Number(new Date(t).toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" })) % 24;

/** Offline anatomy: drift, diurnal peak-to-peak, residual noise σ, spike rate. */
export function anatomy(pts: Pt[]) {
  const c24 = centred(pts, 24, median);
  const detr = pts.map((p, i) => p.v - c24[i].v);
  const bins: number[][] = Array.from({ length: 24 }, () => []);
  pts.forEach((p, i) => bins[hourIL(p.t)].push(detr[i]));
  const profile = bins.map((b) => (b.length >= 3 ? median(b) : NaN));
  const pf = profile.filter(Number.isFinite);
  const diurnalPP = pf.length >= 6 ? Math.max(...pf) - Math.min(...pf) : NaN;
  const resid = pts.map((p, i) => detr[i] - (Number.isFinite(profile[hourIL(p.t)]) ? profile[hourIL(p.t)] : 0));
  const sigma = 1.4826 * mad(resid);
  const spikeRate = resid.filter((r) => Math.abs(r) > 5 * sigma).length / pts.length;
  const weekly: number[] = [];
  for (let w = pts[0].t; w < pts[pts.length - 1].t; w += 7 * DAY) {
    const vs = pts.filter((p) => p.t >= w && p.t < w + 7 * DAY).map((p) => p.v);
    if (vs.length >= 5) weekly.push(median(vs));
  }
  const drift = weekly.length >= 2 ? Math.max(...weekly) - Math.min(...weekly) : NaN;
  return { diurnalPP, sigma, spikeRate, drift, profile, level: c24[c24.length - 1]?.v };
}

/** TODAY's rule (checkThresholds): every raw sample, alert on worsening, 24h throttle per axis. */
export function simulateCurrent(series: Pt[], warn: number, alarm: number) {
  let status: Status = "ok";
  let lastAlert = -Infinity;
  let alerts = 0;
  let nonOk = 0;
  for (let i = 0; i < series.length; i++) {
    const { t, v } = series[i];
    if (i > 0 && status !== "ok") nonOk += t - series[i - 1].t;
    if (!Number.isFinite(v)) continue;
    const a = Math.abs(v);
    const next: Status = a > alarm ? "alarm" : a > warn ? "warn" : "ok";
    if (next !== status) {
      if (SEV[next] > SEV[status] && t - lastAlert >= DAY) {
        alerts++;
        lastAlert = t;
      }
      status = next;
    }
  }
  return { alerts, pctNonOk: pct(nonOk, series) };
}

/**
 * Tier 2 (sensitive, "stable change"): smoothed series vs warn/alarm with
 *  - persistence: must be beyond the level for ≥ persistHours AND ≥ 2 evaluations
 *  - hysteresis: leave a level only below hyst × its gap
 *  - one alert per escalation (no re-alerting while the episode lasts)
 */
export function simulateTier2(smoothed: Pt[], warn: number, alarm: number, persistHours = 3, hyst = 0.8) {
  let status: Status = "ok";
  let alerts = 0;
  let nonOk = 0;
  let cand: Status | null = null;
  let candSince = 0;
  let candCount = 0;
  const level = (a: number): Status => (a > alarm ? "alarm" : a > warn ? "warn" : "ok");
  for (let i = 0; i < smoothed.length; i++) {
    const { t, v } = smoothed[i];
    if (i > 0 && status !== "ok") nonOk += t - smoothed[i - 1].t;
    if (!Number.isFinite(v)) continue;
    const a = Math.abs(v);
    let next = level(a);
    // hysteresis on the way down
    if (SEV[next] < SEV[status]) {
      const gap = status === "alarm" ? alarm : warn;
      if (a > gap * hyst) next = status;
    }
    if (next === status) {
      cand = null;
      continue;
    }
    if (cand !== next) {
      cand = next;
      candSince = t;
      candCount = 1;
    } else candCount++;
    if (candCount >= 2 && t - candSince >= persistHours * H) {
      if (SEV[next] > SEV[status]) alerts++;
      status = next;
      cand = null;
    }
  }
  return { alerts, pctNonOk: pct(nonOk, smoothed), finalStatus: status };
}

/**
 * Tier 1 (instant, "significant movement"): raw departs from the trailing-24h smoothed baseline
 * (computed BEFORE the sample) by more than `jump`, confirmed by the next sample too.
 * Episode ends when raw returns within jump/2 of baseline. One alert per episode.
 */
export function simulateTier1(raw: Pt[], baseline: Pt[], jump: number) {
  let alerts = 0;
  let inEpisode = false;
  let pendingIdx = -1;
  const events: number[] = [];
  for (let i = 1; i < raw.length; i++) {
    const b = baseline[i - 1].v;
    if (!Number.isFinite(b)) continue;
    const d = Math.abs(raw[i].v - b);
    if (inEpisode) {
      if (d < jump / 2) inEpisode = false;
      continue;
    }
    if (d > jump) {
      if (pendingIdx === i - 1) {
        alerts++;
        events.push(raw[i].t);
        inEpisode = true;
        pendingIdx = -1;
      } else pendingIdx = i;
    } else pendingIdx = -1;
  }
  return { alerts, events };
}

/** Same as tier1 but WITHOUT confirmation — shows what confirmation buys. */
export function simulateTier1Unconfirmed(raw: Pt[], baseline: Pt[], jump: number) {
  let alerts = 0;
  let inEpisode = false;
  for (let i = 1; i < raw.length; i++) {
    const b = baseline[i - 1].v;
    if (!Number.isFinite(b)) continue;
    const d = Math.abs(raw[i].v - b);
    if (inEpisode) {
      if (d < jump / 2) inEpisode = false;
    } else if (d > jump) {
      alerts++;
      inEpisode = true;
    }
  }
  return { alerts };
}

function pct(ms: number, s: Pt[]) {
  const span = s.length > 1 ? s[s.length - 1].t - s[0].t : 1;
  return (ms / span) * 100;
}
