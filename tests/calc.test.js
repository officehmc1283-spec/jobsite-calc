/* Unit tests for calc.js — no dependencies.
 * Run with any of:
 *   node tests/calc.test.js
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc calc.js tests/calc.test.js   (macOS)
 *   open tests/index.html in a browser
 */
(function () {
  'use strict';
  const C = typeof require !== 'undefined' && typeof module !== 'undefined'
    ? require('../calc.js')
    : globalThis.Calc;
  const log = typeof console !== 'undefined' ? (s) => console.log(s) : print;

  let pass = 0, fail = 0;
  const failures = [];
  function test(name, fn) {
    try { fn(); pass++; }
    catch (e) { fail++; failures.push(name + ' — ' + e.message); }
  }
  function eq(actual, expected, msg) {
    if (actual !== expected) throw new Error((msg || '') + ' expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
  function near(actual, expected, tol, msg) {
    tol = tol || 1e-6;
    if (!(Math.abs(actual - expected) <= tol)) throw new Error((msg || '') + ' expected ≈' + expected + ', got ' + actual);
  }
  function throws(fn, re) {
    try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error('wrong error: ' + e.message); return; }
    throw new Error('expected an error');
  }
  const ev = (s) => C.evaluate(s);
  const ftin = (s, den) => C.formatFtIn(ev(s).v, den || 16);

  // ---------------------------------------------------------------- parsing
  test('parse feet-inch-fraction', () => {
    near(ev(`12' 7-3/8"`).v, 151.375);
    eq(ev(`12' 7-3/8"`).d, 1);
  });
  test('parse variants of the same length', () => {
    [`12'7-3/8"`, `12' 7 3/8"`, `12' 7" 3/8`, `12' 7 3/8`, `12 ft 7.375 in`, `151.375"`, `12.614583333'`]
      .forEach((s) => near(ev(s).v, 151.375, 1e-6, s));
  });
  test('parse bare fraction inch', () => near(ev(`3/8"`).v, 0.375));
  test('unitless mixed number stays a number', () => { const r = ev('5 3/8'); near(r.v, 5.375); eq(r.d, 0); });
  test('spaced minus is subtraction, not a mixed number', () => near(ev('10 - 3/8').v, 9.625));
  test('unicode primes and minus', () => near(ev('12′ 6″ − 6″').v, 144));
  test('metric', () => {
    near(ev('1 m').v, 39.37007874, 1e-6);
    near(ev('2.54 cm').v, 1);
    near(ev('25.4mm').v, 1);
    near(ev('3 yd').v, 108);
  });
  test('area and volume units', () => {
    const a = ev('10 sq ft'); eq(a.d, 2); near(a.v, 1440);
    const v = ev('1 cu yd'); eq(v.d, 3); near(v.v, 46656);
    near(ev('1 sqm').v / 144, 10.7639104, 1e-6);
  });

  // ---------------------------------------------------------------- fraction math
  test('add: 12\' 7-3/8" + 4\' 9-11/16" = 17\' 5-1/16"', () => eq(ftin(`12' 7-3/8" + 4' 9-11/16"`), `17' 5-1/16"`));
  test('subtract: 12\' 7-3/8" − 4\' 9-11/16" = 7\' 9-11/16"', () => eq(ftin(`12' 7-3/8" - 4' 9-11/16"`), `7' 9-11/16"`));
  test('multiply length by number', () => eq(ftin(`12' 6" × 3`), `37' 6"`));
  test('divide length by number', () => eq(ftin(`10' ÷ 3`), `3' 4"`));
  test('divide rounds to precision', () => eq(ftin(`10' ÷ 7`), `1' 5-1/8"`));
  test('length ÷ length is a count', () => { const r = ev(`12' ÷ 6"`); eq(r.d, 0); near(r.v, 24); });
  test('length × length is area', () => { const r = ev(`12' × 10'`); eq(r.d, 2); near(r.v / C.SQFT, 120); });
  test('area × length is volume', () => near(ev(`12' × 10' × 4"`).v / C.CUYD, 40 / 27));
  test('square root of area is length', () => eq(ftin('√144 sq ft'), `12' 0"`));
  test('squared', () => near(ev(`3'²`).v / C.SQFT, 9));
  test('parentheses and precedence', () => {
    eq(ftin(`(2' + 1') × 2`), `6' 0"`);
    eq(ftin(`2' + 1' × 2`), `4' 0"`);
  });
  test('negative results', () => eq(ftin(`3" - 1'`), `-9"`));
  test('mismatched units throw', () => {
    throws(() => ev(`12' + 5`), /add a unit/);
    throws(() => ev(`12' + 4 sq ft`), /add a length and an area/);
  });
  test('divide by zero throws', () => throws(() => ev('5 ÷ 0'), /zero/));
  test('garbage throws', () => { throws(() => ev('5 +')); throws(() => ev('ft')); throws(() => ev('(5')); throws(() => ev('5 @')); });

  // ---------------------------------------------------------------- formatting
  test('fraction reduces', () => {
    eq(C.formatInches(7.5, 16), `7-1/2"`);
    eq(C.formatInches(0.25, 64), `1/4"`);
    eq(C.formatInches(0.375, 16), `3/8"`);
  });
  test('precision settings', () => {
    const x = 7.3; // 7-19/64 is closest at 1/64
    eq(C.formatInches(x, 2), `7-1/2"`);
    eq(C.formatInches(x, 4), `7-1/4"`);
    eq(C.formatInches(x, 8), `7-1/4"`);
    eq(C.formatInches(x, 16), `7-5/16"`);
    eq(C.formatInches(x, 32), `7-5/16"`);
    eq(C.formatInches(x, 64), `7-19/64"`);
  });
  test('rounding carries into feet', () => {
    eq(C.formatFtIn(11.999, 16), `1' 0"`);
    eq(C.formatFtIn(23.97, 16), `2' 0"`);
    eq(C.formatInches(0.999, 16), `1"`);
  });
  test('zero inches and fraction-only with feet', () => {
    eq(C.formatFtIn(144, 16), `12' 0"`);
    eq(C.formatFtIn(144.375, 16), `12' 0-3/8"`);
    eq(C.formatFtIn(0.375, 16), `3/8"`);
  });
  test('every display mode round-trips through the parser', () => {
    [[151.375, 1], [1440, 2], [46656, 3], [7.25, 0]].forEach(([v, d]) => {
      C.MODES[d].forEach((m, i) => {
        const s = C.format({ v, d }, i, 64);
        const back = ev(s);
        eq(back.d, d, s);
        near(back.v, v, Math.max(1 / 64, v * 1e-3), s);
      });
    });
  });
  test('conversions', () => {
    const v = { v: 151.375, d: 1 };
    eq(C.format(v, 2), `12.6146'`);
    eq(C.format(v, 3), `151.375"`);
    eq(C.format(v, 5), '3.8449 m');
    eq(C.format({ v: 144 * 120, d: 2 }, 0), '120 sq ft');
    eq(C.format({ v: 144 * 120, d: 2 }, 2), '13.333 sq yd');
    eq(C.format({ v: 1728 * 27, d: 3 }, 0), '1 cu yd');
  });

  // ---------------------------------------------------------------- right angle
  test('right angle: 3-4-5', () => {
    const r = C.rightAngle({ rise: 36, run: 48 });
    near(r.diag, 60); near(r.pitch, 9); near(r.pct, 75); near(r.deg, 36.8698976, 1e-6);
  });
  test('right angle: run + pitch', () => {
    const r = C.rightAngle({ run: 144, pitch: 6 });
    near(r.rise, 72); near(r.diag, Math.hypot(72, 144));
  });
  test('right angle: diag + degrees', () => {
    const r = C.rightAngle({ diag: 100, deg: 30 });
    near(r.rise, 50); near(r.run, 86.6025404, 1e-6);
  });
  test('right angle: rise + diag, percent', () => {
    near(C.rightAngle({ rise: 30, diag: 50 }).run, 40);
    near(C.rightAngle({ run: 100, pct: 25 }).rise, 25);
  });
  test('right angle: bad input', () => {
    throws(() => C.rightAngle({ rise: 5 }), /two/);
    throws(() => C.rightAngle({ rise: 50, diag: 30 }), /longer/);
  });

  // ---------------------------------------------------------------- rafters
  test('rafters: 6/12, 24\' span, no ridge', () => {
    const r = C.rafters({ pitch: 6, span: 288, ridge: 0, overhang: 12, oc: 16 });
    near(r.run, 144); near(r.rise, 72);
    near(r.common, 144 * Math.sqrt(1.25));          // 160.997"
    near(r.tail, 12 * Math.sqrt(1.25));
    near(r.hip, 144 * Math.sqrt(2.25));             // 216"
    near(r.jackDiff, 16 * Math.sqrt(1.25));         // 17.889"
    eq(r.jacks.length, 8);                          // 16..128 < 144
    near(r.plumbDeg, 26.5650512, 1e-6);
    eq(r.commonBuy, 16);
  });
  test('rafters: ridge deduction', () => {
    const r = C.rafters({ pitch: 12, span: 288, ridge: 1.5 });
    near(r.run, 143.25);
  });

  // ---------------------------------------------------------------- stairs
  test('stairs: 108" rise', () => {
    const s = C.stairs({ totalRise: 108 });
    eq(s.risers, 14); eq(s.treads, 13);
    near(s.riserHeight, 108 / 14); near(s.treadDepth, 10); near(s.totalRun, 130);
    near(s.stringer, Math.hypot(108, 130));
    eq(s.ok, true);
  });
  test('stairs: exact 7-1/2" risers', () => {
    const s = C.stairs({ totalRise: 105 });
    eq(s.risers, 14); near(s.riserHeight, 7.5);
  });
  test('stairs: bumps riser count to stay under 7-3/4"', () => {
    const s = C.stairs({ totalRise: 40 });  // 5 risers would be 8"
    eq(s.risers, 6); near(s.riserHeight, 40 / 6); eq(s.ok, true);
  });
  test('stairs: exactly 7-3/4" is allowed', () => {
    const s = C.stairs({ totalRise: 31, risers: 4 });
    near(s.riserHeight, 7.75); eq(s.ok, true);
  });
  test('stairs: forced riser count over IRC is flagged', () => {
    const s = C.stairs({ totalRise: 108, risers: 12 });
    near(s.riserHeight, 9); eq(s.ok, false);
    eq(/riser/i.test(s.warnings[0]), true);
  });
  test('stairs: run limit shrinks treads and flags', () => {
    const s = C.stairs({ totalRise: 108, runLimit: 120 });
    near(s.treadDepth, 120 / 13); near(s.totalRun, 120);
    eq(s.ok, false); eq(/tread/i.test(s.warnings[0]), true);
  });
  test('stairs: generous run limit keeps desired tread', () => {
    const s = C.stairs({ totalRise: 108, runLimit: 200, tread: 11 });
    near(s.treadDepth, 11); eq(s.ok, true);
  });
  test('stairs: requires rise', () => throws(() => C.stairs({}), /rise/));
  test('stairs: forced riser count below 1 is rejected', () => throws(() => C.stairs({ totalRise: 108, risers: 0.3 }), /at least 1/));
  test('stairs: very low risers are flagged', () => {
    const s = C.stairs({ totalRise: 108, riser: 2 });
    eq(s.ok, false);
    if (!/under 4"/.test(s.warnings.join())) throw new Error('no low-riser warning');
  });
  test('stairs: 9\' 1-1/2" rise → 15 risers @ 7.3", 14 treads, 140" run', () => {
    const s = C.stairs({ totalRise: 109.5 });
    eq(s.risers, 15); eq(s.treads, 14); near(s.riserHeight, 7.3); near(s.totalRun, 140);
    near(s.stringer, Math.hypot(109.5, 140)); eq(s.ok, true);
  });

  // ---------------------------------------------------------------- concrete
  test('concrete slab 10x10x4" = 1.2346 cu yd', () => {
    const c = C.concreteSummary(C.box(120, 120, 4), 0);
    near(c.cuyd, 100 * (4 / 12) / 27);
  });
  test('concrete waste %', () => {
    const c = C.concreteSummary(C.box(120, 120, 4), 10);
    near(c.cuyd, 1.1 * 100 * (4 / 12) / 27);
  });
  test('sonotube 12" x 4\' x 3', () => {
    near(C.column(12, 48, 3) / C.CUFT, Math.PI * 0.25 * 4 * 3);
  });
  test('concrete stairs', () => {
    // 3 steps, 7" rise, 11" tread, 36" wide, landing = tread
    near(C.concreteStairs(36, 3, 7, 11), 36 * 11 * 7 * (1 + 2 + 3));
    near(C.concreteStairs(36, 3, 7, 11, 48), 36 * (11 * 7 * (1 + 2) + 48 * 21));
  });
  test('bags', () => {
    const c = C.concreteSummary(C.CUFT * 6, 0);
    eq(c.bags80, 10); eq(c.bags60, 14);
  });

  // ---------------------------------------------------------------- lumber & sheets
  test('board feet', () => {
    near(C.boardFeet(2, 4, 96, 1), 5.3333333, 1e-6);
    near(C.boardFeet(2, 12, 144, 10), 240);
  });
  test('studs 16" OC', () => {
    eq(C.studs({ length: 96, oc: 16 }).total, 7);
    eq(C.studs({ length: 100, oc: 16 }).total, 8);
    eq(C.studs({ length: 240, oc: 24 }).total, 11);
    eq(C.studs({ length: 240, oc: 16, corners: 2, openings: 1 }).total, 16 + 6);
  });
  test('sheets', () => {
    eq(C.sheets(32 * 144, 32 * 144, 0).count, 1);
    eq(C.sheets(33 * 144, 32 * 144, 0).count, 2);
    eq(C.sheets(320 * 144, 32 * 144, 10).count, 11);
  });

  // ---------------------------------------------------------------- area & circles
  test('areas', () => {
    near(C.area.triangle3(3, 4, 5), 6);
    near(C.area.trapezoid(4, 6, 2), 10);
    near(C.area.quad(3, 4, 3, 4, 5), 12);
    throws(() => C.area.triangle3(1, 1, 5), /triangle/);
  });
  test('arc from chord & height', () => {
    const a = C.arcFromChordHeight(48, 6);
    near(a.radius, 51); near(a.deg, 56.1455, 1e-3);
  });
  test('semicircle from chord & height', () => {
    const a = C.arcFromChordHeight(20, 10);
    near(a.radius, 10); near(a.deg, 180); near(a.arc, Math.PI * 10);
  });
  test('arc from angle', () => {
    const a = C.arcFromAngle(10, 90);
    near(a.arc, 5 * Math.PI); near(a.chord, 10 * Math.SQRT2);
  });
  test('arc from radius & chord', () => near(C.arcFromRadiusChord(10, 20).deg, 180));
  test('circle', () => near(C.circle(10).circumference, 10 * Math.PI));

  // ---------------------------------------------------------------- report
  failures.forEach((f) => log('FAIL  ' + f));
  log(pass + ' passed, ' + fail + ' failed');
  globalThis.TEST_RESULT = { pass, fail, failures };
  if (fail && typeof process !== 'undefined') process.exitCode = 1;
})();
