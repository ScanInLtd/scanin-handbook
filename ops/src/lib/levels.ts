/** Level clustering for prisms that flip between levels (shared by review/level-review.ts and oneoff/2026-10-25-level-decisions.ts). */
export const LEVEL_TH = 150; // mm: samples within this (max over axes) of a level centre belong to it

export type Pt = { t: number; v: number[]; suspect: boolean };

export function clusterLevels(pts: Pt[]) {
  const levels: { c: number[]; n: number }[] = [];
  const label: number[] = [];
  for (const p of pts) {
    let best = -1, bestD = Infinity;
    levels.forEach((l, i) => {
      const d = Math.max(...p.v.map((x, k) => (Number.isFinite(x) ? Math.abs(x - l.c[k]) : 0)));
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0 && bestD <= LEVEL_TH) {
      const l = levels[best];
      l.n++;
      const w = 1 / Math.min(l.n, 50);
      l.c = l.c.map((c, k) => (Number.isFinite(p.v[k]) ? c + (p.v[k] - c) * w : c));
      label.push(best);
    } else {
      levels.push({ c: p.v.map((x) => (Number.isFinite(x) ? x : 0)), n: 1 });
      label.push(levels.length - 1);
    }
  }
  // small clusters → noise (-1); renumber the rest by first appearance
  const minN = Math.max(5, Math.round(pts.length * 0.01));
  const keep = levels.map((l) => l.n >= minN);
  const order: number[] = [];
  label.forEach((l) => { if (keep[l] && !order.includes(l)) order.push(l); });
  return label.map((l) => (keep[l] ? order.indexOf(l) : -1));
}

export function periods(pts: Pt[], lab: number[]) {
  // run-length over the time-ordered labels (noise ignored); runs < 3 samples absorbed into neighbours
  const runs: { level: number; from: number; to: number; n: number }[] = [];
  pts.forEach((p, i) => {
    if (lab[i] < 0) return;
    const last = runs[runs.length - 1];
    if (last && last.level === lab[i]) { last.to = p.t; last.n++; }
    else runs.push({ level: lab[i], from: p.t, to: p.t, n: 1 });
  });
  const merged: typeof runs = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (r.n < 3 && last) { last.to = r.to; continue; }
    if (last && last.level === r.level) { last.to = r.to; last.n += r.n; } else merged.push({ ...r });
  }
  return merged;
}
