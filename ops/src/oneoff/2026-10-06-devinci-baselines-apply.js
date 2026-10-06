const path = require("path");
const L = (m) => require(path.join(process.cwd(), "lib", m));
const { applyBaseline } = L("setBaseline");
const { recomputeSmoothingCore } = L("recomputeSmoothing");
const { recompute, plan } = require("/tmp/devinci-baselines-plan.json");
const BY = "hillel@scanin (oneoff 2026-10-06-devinci-baselines)";
(async () => {
  for (const r of recompute) {
    const s = await recomputeSmoothingCore({ sensorId: r.id, fromTime: r.from, apply: true });
    console.log(`✓ recompute ${r.name}:`, JSON.stringify(s).slice(0, 140));
  }
  let ok = 0;
  for (const p of plan) {
    try {
      const out = await applyBaseline({ sensorId: p.id, time: p.time, reason: "ats-setup", initial: p.initial, note: "DeVinci station re-setup 07.09–16.09 (Nathan, 2026-10-06): 4th sample after the gap, median of 24h" }, BY);
      ok++; console.log(`✓ ${p.name}: event ${out.eventId}, recompute ${JSON.stringify(out.recompute).slice(0, 90)}`);
    } catch (e) { console.log(`✗ ${p.name}: ${e.message}`); }
  }
  console.log(`done: ${ok}/${plan.length} baselines`);
  process.exit(0);
})();
