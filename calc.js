/* Jobsite Calc — pure math engine (no DOM).
 * Works in the browser (window.Calc), Node (require) and JavaScriptCore (load()).
 *
 * Internally every quantity is { v, d }:
 *   d = 0 plain number, 1 length (inches), 2 area (sq in), 3 volume (cu in).
 */
(function (root) {
  'use strict';

  // Inches per unit
  const IN = { in: 1, ft: 12, yd: 36, mm: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254 };

  const UNIT_ALIASES = {
    "'": 'ft', ft: 'ft', feet: 'ft', foot: 'ft',
    '"': 'in', in: 'in', inch: 'in', inches: 'in',
    yd: 'yd', yard: 'yd', yards: 'yd',
    m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
    cm: 'cm', mm: 'mm'
  };

  const EPS = 1e-9;

  // ---------------------------------------------------------------- tokenizer
  const TOKEN_RES = [
    ['ws', /\s+/y],
    // 7-3/8  (mixed number, no spaces around the hyphen)
    ['mixed', /(\d+)-(\d+)\/(\d+)/y],
    // 3/8
    ['frac', /(\d+)\/(\d+)/y],
    ['num', /(\d+\.?\d*|\.\d+)/y],
    // sq ft, cu yd, ft, in, ', " ...
    ['unit', /(?:(sq|cu)\.?\s*)?(feet|foot|ft|inches|inch|in|yards|yard|yd|meters|meter|metres|metre|mm|cm|m)(?![a-z])|['"]/yi],
    ['op', /[-+*/×÷x()√²]/y]
  ];

  function tokenize(src) {
    const s = String(src)
      .replace(/[′‘’]/g, "'")
      .replace(/[″“”]/g, '"')
      .replace(/[−–—]/g, '-')
      .replace(/,/g, '');
    const out = [];
    let i = 0;
    outer: while (i < s.length) {
      for (const [type, re] of TOKEN_RES) {
        re.lastIndex = i;
        const m = re.exec(s);
        if (!m || m.index !== i) continue;
        i = re.lastIndex;
        if (type === 'ws') continue outer;
        if (type === 'mixed') {
          const den = +m[3];
          if (den === 0) throw new Error('Fraction with zero denominator');
          out.push({ t: 'num', v: +m[1] + +m[2] / den });
        } else if (type === 'frac') {
          const den = +m[2];
          if (den === 0) throw new Error('Fraction with zero denominator');
          out.push({ t: 'num', v: +m[1] / den });
        } else if (type === 'num') {
          out.push({ t: 'num', v: parseFloat(m[1]) });
        } else if (type === 'unit') {
          const word = m[0] === "'" || m[0] === '"' ? m[0] : m[2].toLowerCase();
          const base = UNIT_ALIASES[word];
          const pre = m[1] ? m[1].toLowerCase() : '';
          const d = pre === 'sq' ? 2 : pre === 'cu' ? 3 : 1;
          out.push({ t: 'unit', name: base, d, f: Math.pow(IN[base], d) });
        } else {
          let op = m[0];
          if (op === '*' || op === 'x') op = '×';
          if (op === '/') op = '÷';
          out.push({ t: 'op', v: op });
        }
        continue outer;
      }
      throw new Error('Unexpected "' + s[i] + '"');
    }
    return out;
  }

  // ---------------------------------------------------------------- parser
  function evaluate(src) {
    const toks = tokenize(src);
    if (!toks.length) throw new Error('Empty');
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;

    function expr() {
      let a = term();
      while (isOp('+') || isOp('-')) {
        const op = toks[p++].v;
        const b = term();
        a = op === '+' ? add(a, b) : add(a, neg(b));
      }
      return a;
    }
    function term() {
      let a = unary();
      while (isOp('×') || isOp('÷')) {
        const op = toks[p++].v;
        const b = unary();
        a = op === '×' ? mul(a, b) : div(a, b);
      }
      return a;
    }
    function unary() {
      if (isOp('-')) { p++; return neg(unary()); }
      if (isOp('+')) { p++; return unary(); }
      if (isOp('√')) { p++; return sqrt(unary()); }
      let a = primary();
      while (isOp('²')) { p++; a = mul(a, a); }
      return a;
    }
    function primary() {
      const t = peek();
      if (!t) throw new Error('Incomplete entry');
      if (t.t === 'op' && t.v === '(') {
        p++;
        const a = expr();
        if (!isOp(')')) throw new Error('Missing )');
        p++;
        return a;
      }
      if (t.t === 'num') return group();
      if (t.t === 'unit') throw new Error('Unit without a number');
      throw new Error('Unexpected "' + t.v + '"');
    }
    // A run of numbers with optional units, e.g.  12' 7 3/8"
    function group() {
      const parts = [];
      while (peek() && peek().t === 'num') {
        const n = toks[p++].v;
        let u = null;
        if (peek() && peek().t === 'unit') u = toks[p++];
        parts.push({ v: n, u });
      }
      return groupValue(parts);
    }

    const result = expr();
    if (p < toks.length) {
      const t = toks[p];
      throw new Error('Unexpected "' + (t.v !== undefined ? t.v : t.name) + '"');
    }
    if (!isFinite(result.v)) throw new Error('Result is not a number');
    return result;
  }

  function groupValue(parts) {
    if (!parts.some((x) => x.u)) {
      return { v: parts.reduce((s, x) => s + x.v, 0), d: 0 };
    }
    let d = null;
    let total = 0;
    let prev = null;
    parts.forEach((part, i) => {
      let u = part.u;
      if (!u) {
        // Unitless piece inside a measurement: use the next unit given (7 3/8")
        // or, after feet, inches (12' 7); otherwise the previous unit.
        const next = parts.slice(i + 1).find((x) => x.u);
        if (next) u = next.u;
        else if (prev.name === 'ft' && prev.d === 1) u = { name: 'in', d: 1, f: 1 };
        else u = prev;
      }
      if (d === null) d = u.d;
      else if (u.d !== d) throw new Error("Can't mix those units");
      total += part.v * u.f;
      if (part.u) prev = part.u;
    });
    return { v: total, d };
  }

  // ---------------------------------------------------------------- arithmetic
  const DIM_NAMES = ['a number', 'a length', 'an area', 'a volume'];
  function dimName(d) { return DIM_NAMES[d] || 'that'; }

  function add(a, b) {
    if (a.d !== b.d) {
      throw new Error("Can't add " + dimName(a.d) + ' and ' + dimName(b.d) +
        (a.d === 0 || b.d === 0 ? ' — add a unit (ft or in)' : ''));
    }
    return { v: a.v + b.v, d: a.d };
  }
  function neg(a) { return { v: -a.v, d: a.d }; }
  function mul(a, b) {
    const d = a.d + b.d;
    if (d > 3) throw new Error('Result is beyond cubic units');
    return { v: a.v * b.v, d };
  }
  function div(a, b) {
    if (Math.abs(b.v) < 1e-15) throw new Error('Divide by zero');
    const d = a.d - b.d;
    if (d < 0) throw new Error("Can't divide by a larger unit");
    return { v: a.v / b.v, d };
  }
  function sqrt(a) {
    if (a.d % 2) throw new Error('√ needs a number or an area');
    if (a.v < 0) throw new Error('√ of a negative');
    return { v: Math.sqrt(a.v), d: a.d / 2 };
  }

  // ---------------------------------------------------------------- formatting
  function fmtNum(x, dec) {
    if (!isFinite(x)) return '—';
    let s = x.toFixed(dec);
    if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    if (s === '-0') s = '0';
    return s;
  }

  // Split a non-negative inch value into whole + reduced fraction at precision `den`.
  function fraction(x, den) {
    const n = Math.round(x * den + EPS);
    const whole = Math.floor(n / den);
    let num = n - whole * den;
    let d = den;
    while (num && num % 2 === 0 && d % 2 === 0) { num /= 2; d /= 2; }
    return { whole, num, den: num ? d : 0 };
  }

  function inchText(whole, fr, forceWhole) {
    if (!fr.num) return whole + '"';
    if (!whole && !forceWhole) return fr.num + '/' + fr.den + '"';
    return whole + '-' + fr.num + '/' + fr.den + '"';
  }

  // 209.0625 → 17' 5-1/16"
  function formatFtIn(inches, den) {
    den = den || 16;
    const negative = inches < 0;
    const units = Math.round(Math.abs(inches) * den + EPS); // in 1/den inch
    const perFt = 12 * den;
    const ft = Math.floor(units / perFt);
    const fr = fraction((units - ft * perFt) / den, den);
    const s = ft ? ft + "' " + inchText(fr.whole, fr, true) : inchText(fr.whole, fr, false);
    return negative && units ? '-' + s : s;
  }

  // 209.0625 → 209-1/16"
  function formatInches(inches, den) {
    den = den || 16;
    const negative = inches < 0;
    const fr = fraction(Math.abs(inches), den);
    const s = inchText(fr.whole, fr, false);
    return negative && (fr.whole || fr.num) ? '-' + s : s;
  }

  const SQ = (u) => Math.pow(IN[u], 2);
  const CU = (u) => Math.pow(IN[u], 3);

  // Display modes per dimension. Output strings are valid input again.
  const MODES = {
    0: [{ id: 'num', label: 'NUMBER', fmt: (v) => fmtNum(v, 6) }],
    1: [
      { id: 'ftin', label: 'FT-IN-FRAC', fmt: (v, den) => formatFtIn(v, den) },
      { id: 'in', label: 'INCH-FRAC', fmt: (v, den) => formatInches(v, den) },
      { id: 'ftdec', label: 'DECIMAL FT', fmt: (v) => fmtNum(v / 12, 4) + "'" },
      { id: 'indec', label: 'DECIMAL IN', fmt: (v) => fmtNum(v, 4) + '"' },
      { id: 'yd', label: 'YARDS', fmt: (v) => fmtNum(v / 36, 4) + ' yd' },
      { id: 'm', label: 'METERS', fmt: (v) => fmtNum(v / IN.m, 4) + ' m' },
      { id: 'cm', label: 'CENTIMETERS', fmt: (v) => fmtNum(v / IN.cm, 2) + ' cm' },
      { id: 'mm', label: 'MILLIMETERS', fmt: (v) => fmtNum(v / IN.mm, 1) + ' mm' }
    ],
    2: [
      { id: 'sqft', label: 'SQ FEET', fmt: (v) => fmtNum(v / SQ('ft'), 3) + ' sq ft' },
      { id: 'sqin', label: 'SQ INCHES', fmt: (v) => fmtNum(v, 2) + ' sq in' },
      { id: 'sqyd', label: 'SQ YARDS', fmt: (v) => fmtNum(v / SQ('yd'), 3) + ' sq yd' },
      { id: 'sqm', label: 'SQ METERS', fmt: (v) => fmtNum(v / SQ('m'), 3) + ' sq m' }
    ],
    3: [
      { id: 'cuyd', label: 'CU YARDS', fmt: (v) => fmtNum(v / CU('yd'), 3) + ' cu yd' },
      { id: 'cuft', label: 'CU FEET', fmt: (v) => fmtNum(v / CU('ft'), 3) + ' cu ft' },
      { id: 'cuin', label: 'CU INCHES', fmt: (v) => fmtNum(v, 1) + ' cu in' },
      { id: 'cum', label: 'CU METERS', fmt: (v) => fmtNum(v / CU('m'), 3) + ' cu m' }
    ]
  };

  function format(val, modeIndex, den) {
    const list = MODES[val.d] || MODES[0];
    const mode = list[(modeIndex || 0) % list.length];
    return mode.fmt(val.v, den || 16);
  }

  // ---------------------------------------------------------------- geometry helpers
  const RAD = Math.PI / 180;
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  const pos = (x) => x != null && isFinite(x) && x > 0;
  const given = (x) => x != null && isFinite(x);

  // Standard lumber lengths (ft) — next length that fits `inches`.
  function lumberLength(inches) {
    const ft = inches / 12;
    for (let L = 8; L <= 24; L += 2) if (ft <= L + EPS) return L;
    return Math.ceil(ft / 2) * 2;
  }

  // ---------------------------------------------------------------- 1. right angle
  // Lengths in inches; pitch = rise per 12 of run; deg; pct. Any two → all.
  function rightAngle(o) {
    let ang = null;
    if (given(o.pitch)) ang = Math.atan(o.pitch / 12);
    else if (given(o.deg)) ang = o.deg * RAD;
    else if (given(o.pct)) ang = Math.atan(o.pct / 100);
    if (ang !== null) need(ang > 0 && ang < Math.PI / 2, 'Angle must be between 0° and 90°');

    const lens = [['rise', o.rise], ['run', o.run], ['diag', o.diag]].filter((x) => given(x[1]));
    lens.forEach((x) => need(x[1] > 0, 'Lengths must be greater than zero'));
    let rise, run, diag, used;

    if (lens.length >= 2) {
      const k = lens[0][0] + '+' + lens[1][0];
      const a = lens[0][1], b = lens[1][1];
      if (k === 'rise+run') { rise = a; run = b; diag = Math.hypot(a, b); }
      else if (k === 'rise+diag') { need(b > a, 'Diagonal must be longer than rise'); rise = a; diag = b; run = Math.sqrt(b * b - a * a); }
      else { need(b > a, 'Diagonal must be longer than run'); run = a; diag = b; rise = Math.sqrt(b * b - a * a); }
      used = [lens[0][0], lens[1][0]];
    } else if (lens.length === 1 && ang !== null) {
      const [name, L] = lens[0];
      if (name === 'rise') { rise = L; run = L / Math.tan(ang); diag = L / Math.sin(ang); }
      else if (name === 'run') { run = L; rise = L * Math.tan(ang); diag = L / Math.cos(ang); }
      else { diag = L; rise = L * Math.sin(ang); run = L * Math.cos(ang); }
      used = [name, 'angle'];
    } else {
      throw new Error('Enter any two values (e.g. rise and run, or run and pitch)');
    }
    const a = Math.atan2(rise, run);
    return {
      rise, run, diag, used,
      pitch: 12 * rise / run,
      deg: a / RAD,
      pct: 100 * rise / run,
      compDeg: 90 - a / RAD
    };
  }

  // ---------------------------------------------------------------- 2. rafters
  // pitch x/12; span, ridge, overhang (horizontal), oc in inches.
  function rafters(o) {
    need(pos(o.pitch), 'Enter pitch');
    need(pos(o.span), 'Enter building span');
    const ridge = o.ridge || 0;
    const overhang = o.overhang || 0;
    const oc = o.oc || 16;
    const p = o.pitch / 12;
    const theoRun = o.span / 2;               // to ridge centerline
    const run = theoRun - ridge / 2;          // to ridge face
    need(run > 0, 'Ridge is wider than the span');

    const factor = Math.sqrt(1 + p * p);      // common: length per inch of run
    const hipFactor = Math.sqrt(2 + p * p);   // hip/valley: length per inch of common run
    const common = run * factor;
    const tail = overhang * factor;
    const hip = theoRun * hipFactor;
    const hipTail = overhang * hipFactor;

    const jacks = [];
    for (let i = 1; i * oc < theoRun - EPS && jacks.length < 60; i++) {
      jacks.push(i * oc * factor);
    }
    return {
      run, theoRun,
      rise: theoRun * p,
      factor, hipFactor,
      common, tail, commonTotal: common + tail,
      commonBuy: lumberLength(common + tail),
      hip, hipTail, hipTotal: hip + hipTail,
      hipBuy: lumberLength(hip + hipTail),
      jackDiff: oc * factor,
      jacks,
      plumbDeg: Math.atan(p) / RAD,
      seatDeg: 90 - Math.atan(p) / RAD,
      hipPlumbDeg: Math.atan(p / Math.SQRT2) / RAD,
      hipPitch: o.pitch / Math.SQRT2 * (17 / 12) // rise per 17" of hip run
    };
  }

  // ---------------------------------------------------------------- 3. stairs
  const IRC_MAX_RISER = 7.75;
  const IRC_MIN_TREAD = 10;

  function stairs(o) {
    need(pos(o.totalRise), 'Enter total rise');
    const desired = pos(o.riser) ? o.riser : 7.5;
    const wantTread = pos(o.tread) ? o.tread : 10;

    let n;
    if (pos(o.risers)) {
      n = Math.round(o.risers);
      need(n >= 1, 'Number of risers must be at least 1');
    } else {
      n = Math.max(1, Math.round(o.totalRise / desired));
      while (o.totalRise / n > IRC_MAX_RISER + EPS) n++;
    }
    const riserHeight = o.totalRise / n;
    const treads = n - 1;

    let treadDepth = wantTread;
    let runLimited = false;
    if (pos(o.runLimit) && treads > 0 && treads * wantTread > o.runLimit + EPS) {
      treadDepth = o.runLimit / treads;
      runLimited = true;
    }
    const totalRun = treads * treadDepth;
    const stringer = Math.hypot(o.totalRise, totalRun);

    const warnings = [];
    if (riserHeight > IRC_MAX_RISER + EPS) {
      warnings.push('Riser ' + fmtNum(riserHeight, 3) + '" exceeds IRC max 7-3/4"');
    }
    if (n > 1 && riserHeight < 4 - EPS) {
      warnings.push('Riser ' + fmtNum(riserHeight, 3) + '" is under 4" (IBC minimum) — check the target riser or riser count');
    }
    if (treads > 0 && treadDepth < IRC_MIN_TREAD - EPS) {
      warnings.push('Tread ' + fmtNum(treadDepth, 3) + '" is under IRC min 10"' +
        (runLimited ? ' — not enough run for ' + treads + ' treads' : ''));
    }
    const comfort = 2 * riserHeight + treadDepth;
    return {
      risers: n, treads, riserHeight, treadDepth, totalRun, stringer, runLimited,
      angleDeg: Math.atan2(riserHeight, treadDepth) / RAD,
      comfort, comfortOk: comfort >= 24 - EPS && comfort <= 25.5 + EPS,
      stringerBuy: lumberLength(stringer),
      warnings, ok: warnings.length === 0
    };
  }

  // ---------------------------------------------------------------- 4. concrete (cu in)
  function box(l, w, h, qty) { return l * w * h * (qty || 1); }
  function column(diameter, height, qty) {
    return Math.PI * Math.pow(diameter / 2, 2) * height * (qty || 1);
  }
  // Solid stairs on grade: `steps` risers; each lower step is one tread deep,
  // the top step is `landing` deep (defaults to one tread).
  function concreteStairs(width, steps, riser, tread, landing) {
    const n = Math.round(steps);
    const top = pos(landing) ? landing : tread;
    let area = 0; // side profile, sq in
    for (let i = 1; i < n; i++) area += tread * riser * i;
    area += top * riser * n;
    return area * width;
  }
  function withWaste(x, pct) { return x * (1 + (pct || 0) / 100); }
  function concreteSummary(cuIn, wastePct) {
    const total = withWaste(cuIn, wastePct);
    const cuft = total / CU('ft');
    return {
      cuyd: total / CU('yd'), cuft, cum: total / CU('m'),
      bags80: Math.ceil(cuft / 0.6 - EPS),
      bags60: Math.ceil(cuft / 0.45 - EPS),
      netCuyd: cuIn / CU('yd')
    };
  }

  // ---------------------------------------------------------------- 5. lumber
  // thickness & width in inches (nominal), length in inches
  function boardFeet(t, w, lengthIn, qty) {
    return t * w * (lengthIn / 12) / 12 * (qty || 1);
  }
  function studs(o) {
    need(pos(o.length), 'Enter wall length');
    const oc = o.oc || 16;
    const base = Math.ceil(o.length / oc - EPS) + 1;
    const extras = 2 * (o.corners || 0) + 2 * (o.openings || 0);
    const total = Math.ceil((base + extras) * (1 + (o.waste || 0) / 100) - EPS);
    const stock = o.plateStock || 16 * 12;
    return {
      base, extras, total,
      plateLf: 3 * o.length / 12,
      platePieces: 3 * Math.ceil(o.length / stock - EPS)
    };
  }

  // ---------------------------------------------------------------- 6. sheet goods
  function sheets(areaSqIn, sheetSqIn, wastePct) {
    need(areaSqIn > 0, 'Area must be greater than zero');
    const gross = withWaste(areaSqIn, wastePct);
    return { net: areaSqIn, gross, count: Math.ceil(gross / sheetSqIn - EPS) };
  }

  // ---------------------------------------------------------------- 7. area
  function heron(a, b, c) {
    const s = (a + b + c) / 2;
    const q = s * (s - a) * (s - b) * (s - c);
    need(q > 0, "Those sides don't make a triangle");
    return Math.sqrt(q);
  }
  const area = {
    rect: (l, w) => l * w,
    triangle: (b, h) => b * h / 2,
    triangle3: heron,
    circle: (d) => Math.PI * d * d / 4,
    trapezoid: (a, b, h) => (a + b) / 2 * h,
    // quadrilateral: sides a,b meet at one end of diagonal p, sides c,d at the other
    quad: (a, b, c, d, p) => heron(a, b, p) + heron(c, d, p)
  };

  // ---------------------------------------------------------------- 8. circles & arcs
  function circle(d) {
    return { radius: d / 2, diameter: d, circumference: Math.PI * d, area: Math.PI * d * d / 4 };
  }
  function arcFromAngle(r, deg) {
    need(pos(r), 'Enter radius');
    need(deg > 0 && deg <= 360, 'Angle must be 0–360°');
    const t = deg * RAD;
    return {
      radius: r, deg, arc: r * t,
      chord: 2 * r * Math.sin(t / 2),
      height: r * (1 - Math.cos(t / 2)),
      sectorArea: r * r * t / 2
    };
  }
  function arcFromChordHeight(c, h) {
    need(pos(c) && pos(h), 'Enter chord and height');
    const r = (c * c / 4 + h * h) / (2 * h);
    const t = 4 * Math.atan(2 * h / c);
    return { radius: r, diameter: 2 * r, deg: t / RAD, arc: r * t, chord: c, height: h };
  }
  function arcFromRadiusChord(r, c) {
    need(pos(r) && pos(c), 'Enter radius and chord');
    need(c <= 2 * r + EPS, 'Chord cannot exceed the diameter');
    const t = 2 * Math.asin(Math.min(1, c / (2 * r)));
    return { radius: r, deg: t / RAD, arc: r * t, chord: c, height: r - Math.sqrt(Math.max(0, r * r - c * c / 4)) };
  }

  // ================================================================ SITE WORK
  // All lengths in inches, volumes in cu in, like the rest of the engine.

  // ---------------------------------------------------------------- grade & slope
  // Any two of: rise, run (lengths), pct (grade %), ratio (H:1V).
  function grade(o) {
    let pct = null;
    if (given(o.pct)) { need(o.pct > 0, 'Grade must be greater than zero'); pct = o.pct; }
    else if (given(o.ratio)) { need(o.ratio > 0, 'Slope ratio must be greater than zero'); pct = 100 / o.ratio; }
    const count = [o.rise, o.run].filter(given).length + (pct !== null ? 1 : 0);
    need(count >= 2, 'Enter any two: rise, run, grade % or slope ratio');
    const r = rightAngle({ rise: o.rise, run: o.run, pct });
    return {
      rise: r.rise, run: r.run, slopeLen: r.diag, used: r.used,
      pct: r.pct, deg: r.deg, pitch: r.pitch,
      ratio: r.run / r.rise,            // H : 1V
      inPerFt: 12 * r.rise / r.run,     // inches of rise per foot of run
      ftPer100: r.pct                   // feet of rise per 100 ft
    };
  }

  // Elevations along a grade. start/end/dist in inches, pct signed (+ = uphill).
  // Needs three of the four. interval (inches) → station list.
  function gradeElevations(o) {
    let s = o.start, e = o.end, d = o.dist, p = o.pct;
    const has = given;
    if (has(s) && has(e) && has(d)) {
      need(d > 0, 'Distance must be greater than zero');
      p = 100 * (e - s) / d;
    } else if (has(s) && has(p) && has(d)) {
      need(d > 0, 'Distance must be greater than zero');
      e = s + p / 100 * d;
    } else if (has(e) && has(p) && has(d)) {
      need(d > 0, 'Distance must be greater than zero');
      s = e - p / 100 * d;
    } else if (has(s) && has(e) && has(p)) {
      need(Math.abs(p) > EPS, 'Grade must not be zero');
      d = (e - s) / (p / 100);
      need(d > EPS, 'The end elevation is on the wrong side of the start for that direction — switch Up/Down');
    } else {
      throw new Error('Enter three of: start elevation, end elevation, distance, grade %');
    }
    const stations = [];
    if (pos(o.interval)) {
      const step = o.interval;
      for (let x = 0; x < d - EPS && stations.length < 400; x += step) stations.push({ x, elev: s + p / 100 * x });
      stations.push({ x: d, elev: e });
    }
    return { start: s, end: e, dist: d, pct: p, change: e - s, inPerFt: 12 * p / 100, stations };
  }

  // Station text: 125 ft → "1+25"
  function station(ftVal) {
    const neg = ftVal < 0;
    const cents = Math.round(Math.abs(ftVal) * 100);   // work in 0.01 ft so 99.999 → 1+00
    const hundreds = Math.floor(cents / 10000);
    const rest = (cents - hundreds * 10000) / 100;
    return (neg ? '-' : '') + hundreds + '+' + (rest < 10 ? '0' : '') + fmtNum(rest, 2);
  }

  // Pipe / drain fall. length inches, slope in inches per foot. startInvert inches (optional).
  function pipeFall(o) {
    need(pos(o.length), 'Enter pipe length');
    need(pos(o.slope), 'Enter slope');
    const fall = o.length / 12 * o.slope;
    return {
      fall, pct: o.slope / 12 * 100, slope: o.slope,
      endInvert: given(o.startInvert) ? o.startInvert - fall : null
    };
  }

  // ---------------------------------------------------------------- earthwork
  // Typical swell (bank → loose) and shrink (bank → compacted) in %. Rough values; soils vary.
  const SOILS = {
    earth: { label: 'Common earth', swell: 25, shrink: 10 },
    clay: { label: 'Clay', swell: 30, shrink: 15 },
    sand: { label: 'Sand / gravel', swell: 12, shrink: 7 },
    topsoil: { label: 'Topsoil', swell: 43, shrink: 20 },
    rock: { label: 'Rock (blasted)', swell: 50, shrink: -30 }
  };
  function soilFactors(material, swell, shrink) {
    const s = SOILS[material] || SOILS.earth;
    const sw = given(swell) ? swell : s.swell;
    const sh = given(shrink) ? shrink : s.shrink;
    need(sw > -100 && sh < 100, 'Swell/shrink % out of range');
    return { swell: sw, shrink: sh };
  }
  // Convert a volume between bank / loose / compacted states.
  function swellShrink(vol, from, f) {
    const toBank = { bank: 1, loose: 1 / (1 + f.swell / 100), compacted: 1 / (1 - f.shrink / 100) };
    need(toBank[from] != null, 'Unknown state');
    const bank = vol * toBank[from];
    return { bank, loose: bank * (1 + f.swell / 100), compacted: bank * (1 - f.shrink / 100) };
  }
  function loads(vol, capCuYd) {
    return Math.ceil(vol / CU('yd') / capCuYd - EPS);
  }

  // Trench with optional sloped sides (side = H per 1 V each side). Pipe OD removes backfill.
  function trench(o) {
    need(pos(o.length), 'Enter trench length');
    need(pos(o.width), 'Enter bottom width');
    need(pos(o.depth), 'Enter depth');
    const side = o.side || 0;
    need(side >= 0, 'Side slope cannot be negative');
    const avgWidth = o.width + side * o.depth;
    const bank = avgWidth * o.depth * o.length;
    const pipe = pos(o.pipe) ? Math.PI * o.pipe * o.pipe / 4 * o.length : 0;
    need(!pipe || o.pipe < o.depth, 'Pipe is bigger than the trench');
    return { bank, topWidth: o.width + 2 * side * o.depth, pipe, backfill: bank - pipe, sectionArea: avgWidth * o.depth };
  }

  // Pit / basement: rectangular bottom (plus overdig each side), sloped sides, prismoidal formula.
  function pit(o) {
    need(pos(o.length) && pos(o.width), 'Enter bottom length and width');
    need(pos(o.depth), 'Enter depth');
    const side = o.side || 0, over = o.over || 0;
    need(side >= 0 && over >= 0, 'Slope and overdig cannot be negative');
    const bL = o.length + 2 * over, bW = o.width + 2 * over;
    const run = side * o.depth;
    const tL = bL + 2 * run, tW = bW + 2 * run;
    const A1 = bL * bW, A2 = tL * tW, Am = (bL + run) * (bW + run);
    return { bank: o.depth / 6 * (A1 + 4 * Am + A2), bottomL: bL, bottomW: bW, topL: tL, topW: tW };
  }

  // Average end area between two cross sections (areas sq in, length in).
  function averageEndArea(a1, a2, len) {
    need(a1 >= 0 && a2 >= 0 && (a1 + a2) > 0, 'Enter the two end areas');
    need(pos(len), 'Enter distance between sections');
    return (a1 + a2) / 2 * len;
  }

  // ---------------------------------------------------------------- aggregate / material by weight
  // Typical loose weights, tons (2000 lb) per cu yd.
  const MATERIALS = {
    gravel: { label: 'Gravel / crushed stone', tpy: 1.4 },
    base: { label: 'Road base', tpy: 1.5 },
    sand: { label: 'Sand', tpy: 1.35 },
    fill: { label: 'Fill dirt', tpy: 1.2 },
    topsoil: { label: 'Topsoil', tpy: 1.0 },
    rock: { label: 'River rock', tpy: 1.35 },
    asphalt: { label: 'Asphalt (hot mix)', tpy: 2.0 }
  };
  function tonnage(volCuIn, tonsPerCuYd, compactPct) {
    need(volCuIn > 0, 'Volume must be greater than zero');
    need(pos(tonsPerCuYd), 'Enter tons per cu yd');
    const order = volCuIn * (1 + (compactPct || 0) / 100);
    const cuyd = order / CU('yd');
    return { cuyd, tons: cuyd * tonsPerCuYd, netCuyd: volCuIn / CU('yd') };
  }

  // ---------------------------------------------------------------- concrete shapes
  // Slab with a thickened (turned-down) edge. edgeDepth = total depth at the edge.
  function thickEdgeSlab(L, W, t, edgeDepth, edgeWidth) {
    need(pos(L) && pos(W) && pos(t), 'Enter slab length, width and thickness');
    const ed = Math.max(edgeDepth || 0, t);
    const ew = Math.min(edgeWidth || 0, L / 2, W / 2);
    const ringArea = L * W - (L - 2 * ew) * (W - 2 * ew);
    return L * W * t + ringArea * (ed - t);
  }

  // ---------------------------------------------------------------- rebar
  const REBAR = {
    3: { dia: 0.375, lbft: 0.376 }, 4: { dia: 0.5, lbft: 0.668 }, 5: { dia: 0.625, lbft: 1.043 },
    6: { dia: 0.75, lbft: 1.502 }, 7: { dia: 0.875, lbft: 2.044 }, 8: { dia: 1.0, lbft: 2.670 }
  };
  // One run of bar of length len: splices needed with given stock & lap, and length incl. laps.
  function barRun(len, stock, lap) {
    if (len <= stock + EPS) return { splices: 0, total: len };
    need(stock > lap, 'Lap is longer than the stock bar');
    const splices = Math.ceil((len - stock) / (stock - lap) - EPS);
    return { splices, total: len + splices * lap };
  }
  function rebarSummary(size, runs, stock) {
    const b = REBAR[size];
    need(b, 'Unknown bar size');
    let lf = 0, splices = 0, bars = 0, sticks = 0;
    runs.forEach((r) => {
      lf += r.total * r.count; splices += r.splices * r.count; bars += r.count;
      // Short bars: whole bars cut from each stick. Long bars: sticks per spliced run.
      if (!r.splices) sticks += Math.ceil(r.count / Math.max(1, Math.floor(stock / r.total + EPS)) - EPS);
      else sticks += r.count * Math.ceil(r.total / stock - EPS);
    });
    return { bars, lengthIn: lf, lf: lf / 12, splices, sticks, lbs: lf / 12 * b.lbft };
  }
  // Slab grid: L, W, spacing, edge cover (inches); stock (in); lap (in, default 40 bar diameters).
  function rebarGrid(o) {
    need(pos(o.L) && pos(o.W), 'Enter slab length and width');
    need(pos(o.spacing), 'Enter bar spacing');
    const b = REBAR[o.size];
    need(b, 'Unknown bar size');
    const cover = o.cover || 0;
    const stock = o.stock || 240;
    const lap = given(o.lap) ? o.lap : 40 * b.dia;
    const barL = o.L - 2 * cover, barW = o.W - 2 * cover;
    need(barL > 0 && barW > 0, 'Edge cover is bigger than the slab');
    const nAlongL = Math.floor(barW / o.spacing + EPS) + 1;  // bars running the length
    const nAlongW = Math.floor(barL / o.spacing + EPS) + 1;  // bars running the width
    const r1 = Object.assign({ count: nAlongL }, barRun(barL, stock, lap));
    const r2 = Object.assign({ count: nAlongW }, barRun(barW, stock, lap));
    return Object.assign(rebarSummary(o.size, [r1, r2], stock), { nAlongL, nAlongW, barL, barW, lap });
  }
  // Continuous bars in a footing/wall plus optional dowels.
  function rebarLinear(o) {
    need(pos(o.length), 'Enter footing length');
    need(pos(o.count), 'Enter number of bars');
    const b = REBAR[o.size];
    need(b, 'Unknown bar size');
    const stock = o.stock || 240;
    const lap = given(o.lap) ? o.lap : 40 * b.dia;
    const runs = [Object.assign({ count: Math.round(o.count) }, barRun(o.length, stock, lap))];
    let dowels = 0;
    if (pos(o.dowelSpacing) && pos(o.dowelLength)) {
      dowels = Math.floor(o.length / o.dowelSpacing + EPS) + 1;
      runs.push({ count: dowels, splices: 0, total: o.dowelLength });
    }
    return Object.assign(rebarSummary(o.size, runs, stock), { dowels, lap });
  }

  // ---------------------------------------------------------------- CMU block
  // Grout (cu ft per sq ft of wall, fully grouted), typical NCMA figures.
  const CMU_GROUT = { 6: 0.167, 8: 0.258, 10: 0.34, 12: 0.42 };
  function blockWall(o) {
    need(pos(o.length) && pos(o.height), 'Enter wall length and height');
    const gross = o.length * o.height;                    // sq in
    const net = gross - (o.openings || 0);
    need(net > 0, 'Openings are bigger than the wall');
    const perSqFt = 144 / (16 * 8);                        // 8x16 face = 1.125 per sq ft
    const blocks = Math.ceil(net / SQ('ft') * perSqFt * (1 + (o.waste || 0) / 100) - EPS);
    const groutCuFt = o.grout === 'solid' ? net / SQ('ft') * (CMU_GROUT[o.width] || 0) : 0;
    return {
      net, blocks,
      courses: Math.ceil(o.height / 8 - EPS),
      mortarBags: pos(o.perBag) ? Math.ceil(blocks / o.perBag - EPS) : null,
      groutCuFt, groutCuYd: groutCuFt / 27
    };
  }

  const Calc = {
    grade, gradeElevations, station, pipeFall,
    SOILS, soilFactors, swellShrink, loads, trench, pit, averageEndArea,
    MATERIALS, tonnage, thickEdgeSlab,
    REBAR, barRun, rebarGrid, rebarLinear, CMU_GROUT, blockWall,
    IN, MODES, EPS, IRC_MAX_RISER, IRC_MIN_TREAD,
    tokenize, evaluate, format, formatFtIn, formatInches, fmtNum, fraction, dimName,
    add, mul, div,
    lumberLength, rightAngle, rafters, stairs,
    box, column, concreteStairs, concreteSummary, withWaste,
    boardFeet, studs, sheets, area, heron,
    circle, arcFromAngle, arcFromChordHeight, arcFromRadiusChord,
    SQFT: SQ('ft'), CUFT: CU('ft'), CUYD: CU('yd'), SQYD: SQ('yd'), SQM: SQ('m'), CUM: CU('m')
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(typeof globalThis !== 'undefined' ? globalThis : this);
