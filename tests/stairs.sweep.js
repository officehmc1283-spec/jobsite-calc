/* Stair calculator sweep: checks C.stairs() against independent math for
 * every total rise from 6" to 20' in 1/16" steps, with several option sets,
 * plus edge-case inputs.   Run: node tests/stairs.sweep.js */
const C = require('../calc.js');
let bad = [], n = 0;
const close = (a, b, t) => Math.abs(a - b) <= (t || 1e-9);
for (let r16 = 16 * 6; r16 <= 16 * 240; r16++) {
  const R = r16 / 16;
  for (const opt of [{}, { riser: 7 }, { riser: 7.75 }, { riser: 8 }, { tread: 11 }, { runLimit: R * 1.3 }, { runLimit: 60 }]) {
    n++;
    const s = C.stairs(Object.assign({ totalRise: R }, opt));
    const T = opt.tread || 10, want = opt.riser || 7.5;
    const minN = Math.ceil(R / 7.75 - 1e-9);
    const err = (m) => bad.push(R + '" ' + JSON.stringify(opt) + ': ' + m);
    if (!close(s.risers * s.riserHeight, R, 1e-6)) err('risers x height != total rise');
    if (s.riserHeight > 7.75 + 1e-9) err('riser over 7-3/4" on auto count');
    if (s.risers < minN) err('too few risers');
    const nearest = Math.max(1, Math.round(R / want));
    if (s.risers !== Math.max(nearest, minN)) err('unexpected count ' + s.risers);
    if (s.treads !== s.risers - 1) err('treads != risers-1');
    const expTread = opt.runLimit && s.treads * T > opt.runLimit ? opt.runLimit / s.treads : T;
    if (!close(s.treadDepth, expTread)) err('tread depth');
    if (!close(s.totalRun, s.treads * s.treadDepth, 1e-9)) err('total run');
    if (!close(s.stringer, Math.sqrt(R * R + s.totalRun * s.totalRun), 1e-9)) err('stringer');
    if (opt.runLimit && s.totalRun > opt.runLimit + 1e-9) err('run over limit');
    if (s.ok !== (s.warnings.length === 0)) err('ok flag');
    if (s.treads > 0 && s.treadDepth < 10 - 1e-9 && s.ok) err('short tread not flagged');
    if (s.stringerBuy * 12 < s.stringer - 1e-9) err('stringer stock too short');
  }
}
const tryS = (o) => {
  try {
    const s = C.stairs(o);
    return JSON.stringify({ n: s.risers, h: +s.riserHeight.toFixed(4), t: s.treads, tread: +s.treadDepth.toFixed(3), run: +s.totalRun.toFixed(3), str: +s.stringer.toFixed(3), ok: s.ok, w: s.warnings });
  } catch (e) { return 'ERROR: ' + e.message; }
};
const edges = [
  { totalRise: 108, risers: 0.3 }, { totalRise: 108, risers: 1 }, { totalRise: 108, risers: 14.6 },
  { totalRise: 4 }, { totalRise: 0 }, { totalRise: -5 }, { totalRise: 108, tread: 0 },
  { totalRise: 108, runLimit: 0.001 }, { totalRise: 108, riser: 0.01 }, { totalRise: 108, riser: 7.5, tread: 10 }
];
console.log(n + ' cases checked, ' + bad.length + ' problems');
if (bad.length) console.log(bad.slice(0, 15).join('\n'));
edges.forEach((o) => console.log(JSON.stringify(o) + ' -> ' + tryS(o)));
