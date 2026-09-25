/* Jobsite Calc — UI. Depends on calc.js (window.Calc). */
(function () {
  'use strict';
  const C = window.Calc;
  const APP_VERSION = '6';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ================================================================ storage
  const store = {
    get(k, def) {
      try { const v = localStorage.getItem('jsc.' + k); return v == null ? def : JSON.parse(v); }
      catch (e) { return def; }
    },
    set(k, v) { try { localStorage.setItem('jsc.' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
  };
  const settings = Object.assign({ precision: 16, theme: 'dark', conv: { 0: 0, 1: 0, 2: 0, 3: 0 } }, store.get('settings', {}));
  const inputs = store.get('inputs', {});   // raw field text, keyed "tool.field"
  const modes = store.get('modes', {});     // selected mode per tool
  let tape = store.get('tape', []);
  const saveSettings = () => store.set('settings', settings);
  const saveInputs = () => store.set('inputs', inputs);
  const saveTape = () => { if (tape.length > 300) tape = tape.slice(-300); store.set('tape', tape); };

  const prec = () => settings.precision;
  const wasteSetting = (key, def) => {
    try {
      const raw = (inputs['settings.' + key] || '').trim();
      if (!raw) return def;
      const v = C.evaluate(raw);
      return v.d === 0 && v.v >= 0 ? v.v : def;
    } catch (e) { return def; }
  };
  const concreteWaste = () => wasteSetting('concreteWaste', 10);
  const sheetWaste = () => wasteSetting('sheetWaste', 10);

  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    $('meta[name="theme-color"]').setAttribute('content', settings.theme === 'light' ? '#ECEAE5' : '#121416');
  }

  const buzz = () => { if (navigator.vibrate) navigator.vibrate(8); };
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 1600);
  }

  const fmtVal = (val) => C.format(val, settings.conv[val.d] || 0, prec());
  const fmtLen = (inches, style) => style === 'in' ? C.formatInches(inches, prec()) : C.formatFtIn(inches, prec());

  // ================================================================ calculator
  const st = { expr: '', last: null, lastExpr: '', justEvaluated: false, error: '' };

  function addToTape(e, val) {
    tape.push({ e, v: val.v, d: val.d });
    saveTape();
    renderTape();
  }

  function renderTape() {
    const ol = $('#tape');
    if (!tape.length) {
      ol.innerHTML = '<li class="empty">Results show here</li>';
      return;
    }
    const start = Math.max(0, tape.length - 40);
    let html = '';
    for (let i = start; i < tape.length; i++) {
      const t = tape[i];
      html += '<li data-i="' + i + '" role="button" tabindex="0" title="' + esc(t.e) + '"' + (i === tape.length - 1 ? ' class="latest"' : '') + '>' +
        esc(fmtVal({ v: t.v, d: t.d })) + '</li>';
    }
    ol.innerHTML = html;
    ol.scrollLeft = ol.scrollWidth;
  }

  const SHORT = {
    num: 'NUMBER', ftin: 'FT-IN', in: 'IN-FRAC', ftdec: 'DEC FT', indec: 'DEC IN', yd: 'YARDS', m: 'METERS', cm: 'CM', mm: 'MM',
    sqft: 'SQ FT', sqin: 'SQ IN', sqyd: 'SQ YD', sqm: 'SQ M', cuyd: 'CU YD', cuft: 'CU FT', cuin: 'CU IN', cum: 'CU M'
  };
  const ALT = { 1: ['ftdec', 'indec'], 2: ['sqyd', 'sqm'], 3: ['cuft', 'cum'] };
  function altText(val, id) {
    const m = (C.MODES[val.d] || []).find((x) => x.id === id);
    return m ? m.fmt(val.v, prec()).toUpperCase() : '';
  }

  function currentValue() {
    if (st.justEvaluated) return st.last;
    if (!st.expr.trim()) return null;
    try { return C.evaluate(st.expr); } catch (e) { return null; }
  }

  function renderCalc() {
    const exprEl = $('#expr');
    const resEl = $('#result');
    resEl.className = 'result';
    if (st.justEvaluated) {
      exprEl.textContent = st.lastExpr + ' =';
    } else {
      exprEl.innerHTML = esc(pretty(st.expr)) + (/\s$/.test(st.expr) ? ' ' : '') + '<span class="cursor"></span>';
    }
    let val = null;
    if (st.error) {
      resEl.textContent = st.error;
      resEl.classList.add('error');
    } else if (st.justEvaluated) {
      val = st.last;
      resEl.textContent = fmtVal(val);
    } else {
      val = currentValue();
      if (val) { resEl.textContent = fmtVal(val); resEl.classList.add('preview'); }
      else resEl.textContent = st.expr.trim() ? '…' : '0';
    }
    const d = val ? val.d : 1;
    const list = C.MODES[d];
    const mode = list[(settings.conv[d] || 0) % list.length];
    $('#modeLabel').textContent = SHORT[mode.id] || mode.label;
    $('#precLabel').textContent = '1/' + prec() + '"';
    const alts = val && !st.error ? (ALT[d] || []) : [];
    $('#metaL').textContent = alts[0] ? altText(val, alts[0]) : '';
    $('#metaR').textContent = alts[1] ? altText(val, alts[1]) : '';
  }

  // 7" 3/8 → 7-3/8"  (display only; both forms parse the same)
  const pretty = (s) => s.replace(/(\d+)" (\d+\/\d+)(?![\d/.])/g, '$1-$2"').replace(/\s+/g, ' ').trim();

  const endsWithOperator = (s) => /[+\-−×÷(√]\s*$/.test(s);

  function startFromLast() {
    // After "=", operators continue from the previous result.
    if (st.justEvaluated && st.last) st.expr = fmtVal(st.last);
    st.justEvaluated = false;
  }
  function freshIfEvaluated() {
    if (st.justEvaluated) { st.expr = ''; st.justEvaluated = false; }
  }

  function calcKey(k) {
    st.error = '';
    if (/^[0-9.]$/.test(k)) {
      freshIfEvaluated();
      st.expr += k;
    } else if (k === 'ft' || k === 'in') {
      freshIfEvaluated();
      st.expr = st.expr.trimEnd() + (k === 'ft' ? "' " : '" ');
    } else if (['yd', 'm', 'cm', 'mm', 'sq ft', 'sq in', 'sq yd', 'sq m', 'cu ft', 'cu yd', 'cu in', 'cu m'].indexOf(k) >= 0) {
      freshIfEvaluated();
      st.expr = st.expr.trimEnd() + ' ' + k + ' ';
      $('#more').hidden = true;
    } else if (k === '/') {
      freshIfEvaluated();
      st.expr = st.expr.trimEnd() + '/';
    } else if (['+', '−', '×', '÷'].indexOf(k) >= 0) {
      startFromLast();
      const t = st.expr.trimEnd();
      if (!t) {
        if (k === '−') st.expr = '-';
        else if (st.last) st.expr = fmtVal(st.last) + ' ' + k + ' ';
      } else if (endsWithOperator(t)) {
        if (k === '−') st.expr = t + ' -';                   // negative number
        else st.expr = t.replace(/[+\-−×÷]$/, '').trimEnd() + ' ' + k + ' ';
      } else {
        st.expr = t + ' ' + k + ' ';
      }
    } else if (k === '(' || k === '√') {
      freshIfEvaluated();
      st.expr += k;
      $('#more').hidden = true;
    } else if (k === ')' || k === '²') {
      startFromLast();
      st.expr = st.expr.trimEnd() + k;
      $('#more').hidden = true;
    } else if (k === 'neg') {
      startFromLast();
      if (st.expr.trim()) st.expr = '-(' + st.expr.trim() + ')';
      $('#more').hidden = true;
    } else if (k === 'bs') {
      if (st.justEvaluated) { st.expr = st.lastExpr; st.justEvaluated = false; }
      else {
        st.expr = st.expr.trimEnd().slice(0, -1).trimEnd();
        if (endsWithOperator(st.expr) && !/[(√-]$/.test(st.expr)) st.expr += ' ';
      }
    } else if (k === 'ac') {
      st.expr = ''; st.justEvaluated = false; // st.last is kept for Ans
    } else if (k === 'conv') {
      const val = currentValue();
      const d = val ? val.d : 1;
      settings.conv[d] = ((settings.conv[d] || 0) + 1) % C.MODES[d].length;
      saveSettings();
      renderTape();
    } else if (k === 'more') {
      $('#more').hidden = !$('#more').hidden;
    } else if (k === 'close') {
      $('#more').hidden = true;
    } else if (k === '=') {
      if (!st.expr.trim() || st.justEvaluated) return renderCalc();
      try {
        const val = C.evaluate(st.expr);
        st.last = val;
        st.lastExpr = pretty(st.expr);
        st.justEvaluated = true;
        addToTape(st.lastExpr, val);
      } catch (e) {
        st.error = e.message;
      }
    }
    renderCalc();
  }

  function useTapeEntry(i) {
    const t = tape[i];
    if (!t) return;
    const val = { v: t.v, d: t.d };
    const text = fmtVal(val);
    if (st.justEvaluated || !st.expr.trim() || !endsWithOperator(st.expr.trimEnd())) {
      st.expr = text;
    } else {
      st.expr = st.expr.trimEnd() + ' ' + text;
    }
    st.justEvaluated = false;
    st.error = '';
    buzz();
    showScreen('calc');
    renderCalc();
  }

  // ================================================================ tools
  const len = (id, label, unit, x) => Object.assign({ id, label, kind: 'len', unit }, x);
  const num = (id, label, x) => Object.assign({ id, label, kind: 'num' }, x);
  const choice = (id, label, options, def) => ({ id, label, kind: 'choice', options, def });
  const waste = (fn) => num('waste', 'Waste %', { def: fn, hint: 'default from Settings' });

  // row builders
  const L = (label, v, o) => Object.assign({ label, len: v }, o);
  const A = (label, v, o) => Object.assign({ label, area: v }, o);
  const V = (label, v, unit, o) => Object.assign({ label, vol: v, unit }, o);
  const N = (label, v, dec, suffix, o) => Object.assign({ label, num: v, dec, suffix: suffix || '' }, o);
  const T = (label, text, o) => Object.assign({ label, text }, o);
  const W = (text) => ({ warn: text });
  const OK = (text) => ({ ok: text });
  const I = (text) => ({ info: text });
  const LIST = (label, items) => ({ label, list: items });

  function concreteRows(cuIn, wastePct) {
    const s = C.concreteSummary(cuIn, wastePct);
    return [
      V('Concrete to order', C.withWaste(cuIn, wastePct), 'cuyd', { big: true, net: cuIn }),
      V('Without waste', cuIn, 'cuyd'),
      N('80 lb bags (0.60 cu ft each)', s.bags80, 0),
      N('60 lb bags (0.45 cu ft each)', s.bags60, 0),
      N('Ready-mix trucks (10 yd)', Math.ceil(s.cuyd / 10 - C.EPS), 0),
      I('Includes ' + C.fmtNum(wastePct, 1) + '% waste.')
    ];
  }

  function areaRows(area, perimeter, depth) {
    const rows = [A('Area', area, { big: true })];
    if (perimeter != null) rows.push(L('Perimeter', perimeter));
    if (depth) {
      rows.push(V('Volume', area * depth, 'cuft'));
      rows.push(V('Volume', area * depth, 'cuyd'));
    }
    return rows;
  }
  const soilChoice = () => choice('soil', 'Material', Object.keys(C.SOILS).map((k) => [k, C.SOILS[k].label]), 'earth');
  const materialChoice = () => choice('mat', 'Material', Object.keys(C.MATERIALS).map((k) => [k, C.MATERIALS[k].label]), 'gravel');
  const barChoice = () => choice('bar', 'Bar size', [['3', '#3'], ['4', '#4'], ['5', '#5'], ['6', '#6'], ['7', '#7'], ['8', '#8']], '4');

  function gravelRows(volCuIn, v) {
    const tpy = v.tpy != null ? v.tpy : C.MATERIALS[v.mat].tpy;
    const t = C.tonnage(volCuIn, tpy, v.comp);
    const rows = [
      N('Tons', t.tons, 2, ' tons', { big: true }),
      V('Cubic yards to order', t.cuyd * C.CUYD, 'cuyd'),
      N('Truck loads', Math.ceil(t.tons / v.trk - C.EPS), 0, ' @ ' + C.fmtNum(v.trk, 1) + ' tons')
    ];
    if (v.price != null) rows.push(T('Cost', '$' + (t.tons * v.price).toFixed(2)));
    rows.push(I(C.fmtNum(tpy, 2) + ' tons per cu yd (' + C.MATERIALS[v.mat].label + ')' +
      (v.comp ? ', plus ' + C.fmtNum(v.comp, 1) + '% for compaction' : '') + '. Ask your supplier for their weight.'));
    return rows;
  }

  function rebarRows(r, v) {
    return [
      N('Total length', r.lf, 1, ' LF', { big: true }),
      N('Stock bars (' + C.fmtNum(v.stock / 12, 1) + "')", r.sticks, 0, '', { big: true }),
      N('Weight', r.lbs, 0, ' lb'),
      N('Bars cut', r.bars, 0),
      N('Lap splices', r.splices, 0, ' @ ' + C.formatInches(r.lap, prec()))
    ];
  }
  const depthField = len('depth', 'Depth / thickness', 'in', { hint: 'for volume' });

  const TOOLS = [
    {
      id: 'rightangle', title: 'Right Angle', desc: 'Rise · run · diagonal · pitch',
      note: 'Enter any two: two lengths, or one length plus one angle (pitch, degrees or %).',
      modes: [{
        id: 'main', anyTwo: true,
        fields: [
          len('rise', 'Rise', 'ft'), len('run', 'Run', 'ft'), len('diag', 'Diagonal', 'ft'),
          num('pitch', 'Pitch (x in 12)'), num('deg', 'Angle (degrees)'), num('pct', 'Slope (%)')
        ],
        compute(v) {
          const r = C.rightAngle(v);
          const names = { rise: 'rise', run: 'run', diag: 'diagonal', angle: 'angle' };
          return [
            I('Solved from ' + r.used.map((u) => names[u]).join(' + ') + '.'),
            L('Rise', r.rise), L('Run', r.run), L('Diagonal', r.diag, { big: true }),
            N('Pitch', r.pitch, 3, ' / 12'), N('Angle', r.deg, 2, '°'),
            N('Slope', r.pct, 2, '%'), N('Other angle', r.compDeg, 2, '°')
          ];
        }
      }]
    },
    {
      id: 'grade', title: 'Grade & Slope', desc: 'Rise/run → % grade · elevations · pipe fall',
      modes: [
        {
          id: 'rr', label: 'Rise + Run', anyTwo: true,
          note: 'Enter any two: rise and run, or one of them plus grade % or slope ratio (H:1V, e.g. 3 for a 3:1 bank).',
          fields: [
            len('rise', 'Rise (or fall)', 'ft'), len('run', 'Run (horizontal)', 'ft'),
            num('pct', 'Grade %'), num('ratio', 'Slope ratio H : 1V')
          ],
          compute(v) {
            const g = C.grade(v);
            const names = { rise: 'rise', run: 'run', angle: 'grade' };
            return [
              I('Solved from ' + g.used.map((u) => names[u]).join(' + ') + '.'),
              N('Grade', g.pct, 2, '%', { big: true, sub: C.fmtNum(g.ratio, 2) + ' : 1 slope  ·  ' + C.formatInches(g.inPerFt, prec()) + ' per ft  ·  ' + C.fmtNum(g.deg, 2) + '°' }),
              T('Slope ratio', C.fmtNum(g.ratio, 2) + ' : 1  (H:V)'),
              L('Rise per foot', g.inPerFt, { fmt: 'in' }),
              N('Rise per 100 ft', g.ftPer100, 2, ' ft'),
              N('Angle', g.deg, 2, '°'), N('Pitch', g.pitch, 2, ' / 12'),
              L('Rise', g.rise, { fmt: 'ftdec' }), L('Run', g.run, { fmt: 'ftdec' }),
              L('Slope length', g.slopeLen, { fmt: 'ftdec' })
            ];
          }
        },
        {
          id: 'elev', label: 'Elevations',
          note: 'Enter three of the four: start elevation, end elevation, distance, grade %. Elevations in feet (e.g. 7703.45). Add a station interval to get a grade-stake list.',
          fields: [
            len('start', 'Start elevation', 'ft'), len('end', 'End elevation', 'ft'),
            len('dist', 'Horizontal distance', 'ft'), num('pct', 'Grade %'),
            choice('dir', 'Grade direction (when entering grade %)', [['up', 'Up ↗'], ['down', 'Down ↘']], 'down'),
            len('interval', 'Station interval', 'ft', { hint: 'optional, e.g. 25 or 50' })
          ],
          compute(v) {
            const pct = v.pct == null ? null : (v.dir === 'down' ? -v.pct : v.pct);
            const g = C.gradeElevations({ start: v.start, end: v.end, dist: v.dist, pct, interval: v.interval });
            const rows = [
              N('Grade', Math.abs(g.pct), 3, '% ' + (g.pct < 0 ? 'down ↘' : g.pct > 0 ? 'up ↗' : 'flat'), { big: true }),
              L('Start elevation', g.start, { fmt: 'ftdec' }),
              L('End elevation', g.end, { fmt: 'ftdec', big: true }),
              L('Elevation change', g.change, { fmt: 'ftdec' }),
              L('Horizontal distance', g.dist, { fmt: 'ftdec' }),
              L('Change per foot', Math.abs(g.inPerFt), { fmt: 'in' })
            ];
            if (g.stations.length) {
              rows.push(LIST('Stations (station — elevation)', g.stations.map((st) =>
                C.station(st.x / 12) + '  —  ' + (st.elev / 12).toFixed(2) + "'")));
            }
            return rows;
          }
        },
        {
          id: 'pipe', label: 'Pipe fall',
          note: 'IPC minimum drain slope: 2-1/2" pipe and smaller 1/4" per ft; 3"–6" pipe 1/8" per ft; 8" and larger 1/16" per ft. Check your local code and sewer district specs.',
          fields: [
            len('pl', 'Pipe run length', 'ft', { req: true }),
            num('slope', 'Slope (inches per foot)', { def: 0.25, hint: 'e.g. 1/8, 1/4' }),
            num('pct', 'Or grade %', { hint: 'overrides inches per foot' }),
            len('inv', 'Start invert elevation', 'ft', { hint: 'optional' })
          ],
          compute(v) {
            const slope = v.pct != null ? v.pct / 100 * 12 : v.slope;
            const p = C.pipeFall({ length: v.pl, slope, startInvert: v.inv });
            const rows = [
              L('Total fall', p.fall, { big: true }),
              N('Grade', p.pct, 3, '%'),
              L('Slope per foot', p.slope, { fmt: 'in' })
            ];
            if (p.endInvert != null) rows.push(L('End invert elevation', p.endInvert, { fmt: 'ftdec', big: true }));
            return rows;
          }
        }
      ]
    },
    {
      id: 'rafters', title: 'Rafters', desc: 'Common · hip/valley · jacks',
      note: 'Line lengths along the top edge, level overhang measured from the wall. Commons are to the ridge face (half the ridge deducted). Hips and jacks are to the theoretical centerline: deduct half the 45° thickness of the ridge (hips) or hip (jacks).',
      modes: [{
        id: 'main',
        fields: [
          num('pitch', 'Pitch (x in 12)', { req: true }),
          len('span', 'Building span', 'ft', { req: true, hint: 'outside wall to outside wall' }),
          len('ridge', 'Ridge thickness', 'in', { def: 1.5 }),
          len('overhang', 'Overhang (level)', 'in', { def: 0 }),
          choice('oc', 'Jack spacing (O.C.)', [['16', '16"'], ['24', '24"'], ['19.2', '19.2"'], ['12', '12"']], '16')
        ],
        compute(v) {
          const r = C.rafters(Object.assign({}, v, { oc: +v.oc }));
          return [
            L('Common rafter', r.common, { big: true }),
            L('Common tail', r.tail),
            L('Common total', r.commonTotal),
            T('Common stock', r.commonBuy + "' board"),
            L('Total rise', r.rise),
            N('Plumb cut', r.plumbDeg, 1, '°'), N('Seat cut', r.seatDeg, 1, '°'),
            L('Hip / valley rafter', r.hip, { big: true }),
            L('Hip tail', r.hipTail),
            L('Hip total', r.hipTotal),
            T('Hip stock', r.hipBuy + "' board"),
            N('Hip plumb cut', r.hipPlumbDeg, 1, '°'),
            T('Hip pitch', v.pitch + ' / 17'),
            L('Jack common difference', r.jackDiff),
            LIST('Jack rafters (line length, + tail)', r.jacks.map((j) =>
              fmtLen(j) + (r.tail ? '  →  ' + fmtLen(j + r.tail) : '')))
          ];
        }
      }]
    },
    {
      id: 'stairs', title: 'Stairs', desc: 'Risers · treads · stringer',
      note: 'Treads = risers − 1 (the upper floor is the last step). Stringer is the line length from floor to upper floor; buy stock longer to allow for cuts. IRC R311.7.5: riser 7-3/4" max, tread 10" min.',
      modes: [{
        id: 'main',
        fields: [
          len('totalRise', 'Total rise (floor to floor)', 'in', { req: true }),
          len('runLimit', 'Max total run', 'in', {}),
          len('riser', 'Target riser height', 'in', { def: 7.5 }),
          len('tread', 'Tread depth', 'in', { def: 10 }),
          num('risers', 'Force number of risers', {})
        ],
        compute(v) {
          const s = C.stairs(v);
          const rows = s.ok ? [OK('✓ Meets IRC: riser ≤ 7-3/4", tread ≥ 10"')] : s.warnings.map((w) => W('⚠ ' + w));
          return rows.concat([
            N('Risers', s.risers, 0, '', { big: true }),
            N('Treads', s.treads, 0),
            L('Riser height', s.riserHeight, { fmt: 'in', big: true }),
            L('Tread depth', s.treadDepth, { fmt: 'in', big: true }),
            L('Total run', s.totalRun),
            L('Stringer length', s.stringer, { big: true }),
            T('Stringer stock', s.stringerBuy + "' board (min.)"),
            N('Stair angle', s.angleDeg, 1, '°'),
            I('2R + T = ' + C.fmtNum(s.comfort, 2) + '"' + (s.comfortOk ? ' — comfortable (24–25½")' : ' — outside the comfortable 24–25½" range'))
          ]);
        }
      }]
    },
    {
      id: 'concrete', title: 'Concrete', desc: 'Slabs · footings · tubes · steps',
      modes: [
        {
          id: 'slab', label: 'Slab',
          fields: [
            len('L', 'Length', 'ft', { req: true }), len('W', 'Width', 'ft', { req: true }),
            len('thick', 'Thickness', 'in', { def: 4 }), num('qty', 'Quantity', { def: 1 }), waste(concreteWaste)
          ],
          compute: (v) => concreteRows(C.box(v.L, v.W, v.thick, v.qty), v.waste)
        },
        {
          id: 'footing', label: 'Footing',
          fields: [
            len('L', 'Total length', 'ft', { req: true }), len('fw', 'Footing width', 'in', { def: 20 }),
            len('fd', 'Footing depth', 'in', { def: 10 }), num('qty', 'Quantity', { def: 1 }), waste(concreteWaste)
          ],
          compute: (v) => concreteRows(C.box(v.L, v.fw, v.fd, v.qty), v.waste)
        },
        {
          id: 'column', label: 'Column / Tube',
          fields: [
            len('dia', 'Diameter', 'in', { req: true }), len('colH', 'Height', 'ft', { req: true }),
            num('qty', 'Quantity', { def: 1 }), waste(concreteWaste)
          ],
          compute: (v) => concreteRows(C.column(v.dia, v.colH, v.qty), v.waste)
        },
        {
          id: 'stairs', label: 'Steps',
          note: 'Solid steps on grade. Each lower step is one tread deep; the top step is the landing depth.',
          fields: [
            len('sw', 'Stair width', 'ft', { req: true }), num('steps', 'Number of risers', { req: true }),
            len('sr', 'Riser height', 'in', { def: 7 }), len('st', 'Tread depth', 'in', { def: 11 }),
            len('landing', 'Top landing depth', 'in', { hint: 'blank = one tread' }), waste(concreteWaste)
          ],
          compute: (v) => concreteRows(C.concreteStairs(v.sw, v.steps, v.sr, v.st, v.landing), v.waste)
        },
        {
          id: 'wall', label: 'Wall',
          fields: [
            len('L', 'Wall length', 'ft', { req: true }), len('wh', 'Wall height', 'ft', { req: true }),
            len('wt', 'Wall thickness', 'in', { def: 8 }), waste(concreteWaste)
          ],
          compute: (v) => concreteRows(C.box(v.L, v.wh, v.wt, 1), v.waste)
        },
        {
          id: 'edge', label: 'Thick-edge slab',
          note: 'Monolithic slab with a turned-down edge. Edge depth is the total depth at the edge (slab included).',
          fields: [
            len('L', 'Length', 'ft', { req: true }), len('W', 'Width', 'ft', { req: true }),
            len('thick', 'Slab thickness', 'in', { def: 4 }),
            len('ed', 'Edge depth (total)', 'in', { def: 12 }), len('ew', 'Edge width (bottom)', 'in', { def: 12 }),
            waste(concreteWaste)
          ],
          compute: (v) => concreteRows(C.thickEdgeSlab(v.L, v.W, v.thick, v.ed, v.ew), v.waste)
        },
        {
          id: 'pads', label: 'Pads',
          note: 'Square or rectangular footing pads (e.g. under posts or piers).',
          fields: [
            len('pl', 'Pad length', 'in', { def: 24 }), len('pw', 'Pad width', 'in', { def: 24 }),
            len('pd', 'Pad depth', 'in', { def: 12 }), num('qty', 'Number of pads', { req: true }), waste(concreteWaste)
          ],
          compute: (v) => concreteRows(C.box(v.pl, v.pw, v.pd, v.qty), v.waste)
        }
      ]
    },
    {
      id: 'dirt', title: 'Excavation', desc: 'Trench · pit · cut/fill · swell & trucks',
      modes: [
        {
          id: 'trench', label: 'Trench',
          note: 'Side slope is horizontal per 1 vertical on each side (0 = vertical walls, 1 = 1:1, 1.5 = 1-1/2:1). Bank = in the ground; loose = in the truck.',
          fields: [
            len('tl', 'Trench length', 'ft', { req: true }), len('tw', 'Bottom width', 'in', { def: 24 }),
            len('td', 'Depth', 'ft', { req: true }), num('side', 'Side slope H : 1V', { def: 0 }),
            len('pipe', 'Pipe outside diameter', 'in', { hint: 'optional, for backfill' }),
            soilChoice(), num('swell', 'Swell %', { hint: 'blank = material default' }),
            num('truck', 'Truck capacity (loose cu yd)', { def: 12 })
          ],
          compute(v) {
            const t = C.trench({ length: v.tl, width: v.tw, depth: v.td, side: v.side, pipe: v.pipe });
            const f = C.soilFactors(v.soil, v.swell, null);
            const loose = t.bank * (1 + f.swell / 100);
            const rows = [
              V('Excavation (bank)', t.bank, 'cuyd', { big: true }),
              V('Hauled (loose)', loose, 'cuyd'),
              N('Truck loads', C.loads(loose, v.truck), 0, ' @ ' + C.fmtNum(v.truck, 1) + ' yd'),
              L('Top width', t.topWidth)
            ];
            if (t.pipe) rows.push(V('Backfill (bank, less pipe)', t.backfill, 'cuyd'));
            rows.push(I('Swell ' + C.fmtNum(f.swell, 1) + '% (' + C.SOILS[v.soil].label + ').'));
            return rows;
          }
        },
        {
          id: 'pit', label: 'Pit / Basement',
          note: 'Bottom is the footprint; overdig adds working room on every side. Sides slope back at H:1V. Uses the prismoidal formula.',
          fields: [
            len('pl', 'Bottom length', 'ft', { req: true }), len('pw', 'Bottom width', 'ft', { req: true }),
            len('pd', 'Depth', 'ft', { req: true }), num('side', 'Side slope H : 1V', { def: 1 }),
            len('over', 'Overdig each side', 'ft', { def: 2 }),
            soilChoice(), num('swell', 'Swell %', { hint: 'blank = material default' }),
            num('truck', 'Truck capacity (loose cu yd)', { def: 12 })
          ],
          compute(v) {
            const p = C.pit({ length: v.pl, width: v.pw, depth: v.pd, side: v.side, over: v.over });
            const f = C.soilFactors(v.soil, v.swell, null);
            const loose = p.bank * (1 + f.swell / 100);
            return [
              V('Excavation (bank)', p.bank, 'cuyd', { big: true }),
              V('Hauled (loose)', loose, 'cuyd'),
              N('Truck loads', C.loads(loose, v.truck), 0, ' @ ' + C.fmtNum(v.truck, 1) + ' yd'),
              T('Bottom of hole', C.formatFtIn(p.bottomL, prec()) + ' × ' + C.formatFtIn(p.bottomW, prec())),
              T('Top of hole', C.formatFtIn(p.topL, prec()) + ' × ' + C.formatFtIn(p.topW, prec())),
              I('Swell ' + C.fmtNum(f.swell, 1) + '% (' + C.SOILS[v.soil].label + ').')
            ];
          }
        },
        {
          id: 'pad', label: 'Cut / Fill pad',
          note: 'Enter the cut or fill depth at up to 4 points (e.g. the corners); the average is used. Fill: compacted volume in place, the bank yards needed to make it (shrink), and the loose yards to haul (swell).',
          fields: [
            choice('cf', 'Cut or fill', [['cut', 'Cut'], ['fill', 'Fill']], 'fill'),
            len('L', 'Pad length', 'ft', { req: true }), len('W', 'Pad width', 'ft', { req: true }),
            len('d1', 'Depth 1', 'ft', { req: true }), len('d2', 'Depth 2', 'ft'), len('d3', 'Depth 3', 'ft'), len('d4', 'Depth 4', 'ft'),
            soilChoice(), num('swell', 'Swell %', { hint: 'blank = material default' }), num('shrink', 'Shrink %', { hint: 'blank = material default' }),
            num('truck', 'Truck capacity (loose cu yd)', { def: 12 })
          ],
          compute(v) {
            const ds = [v.d1, v.d2, v.d3, v.d4].filter((x) => x != null);
            const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
            const vol = v.L * v.W * avg;
            const f = C.soilFactors(v.soil, v.swell, v.shrink);
            const rows = [L('Average depth', avg, { fmt: 'ftdec' }), A('Pad area', v.L * v.W)];
            if (v.cf === 'cut') {
              const loose = vol * (1 + f.swell / 100);
              rows.push(V('Cut (bank)', vol, 'cuyd', { big: true }), V('Hauled (loose)', loose, 'cuyd'),
                N('Truck loads', C.loads(loose, v.truck), 0, ' @ ' + C.fmtNum(v.truck, 1) + ' yd'));
            } else {
              const x = C.swellShrink(vol, 'compacted', f);
              rows.push(V('Fill (compacted in place)', vol, 'cuyd', { big: true }),
                V('Bank yards needed', x.bank, 'cuyd'), V('Loose yards to haul', x.loose, 'cuyd', { big: true }),
                N('Truck loads', C.loads(x.loose, v.truck), 0, ' @ ' + C.fmtNum(v.truck, 1) + ' yd'));
            }
            rows.push(I('Swell ' + C.fmtNum(f.swell, 1) + '%, shrink ' + C.fmtNum(f.shrink, 1) + '% (' + C.SOILS[v.soil].label + '). Typical values — soils vary.'));
            return rows;
          }
        },
        {
          id: 'endarea', label: 'Avg end area',
          note: 'Road/ditch cut or fill between two cross sections: (area 1 + area 2) ÷ 2 × distance. Get section areas from the Area tool (tap a result to put it on the tape, then use Ans).',
          fields: [
            num('a1', 'End area 1 (sq ft)', { req: true }), num('a2', 'End area 2 (sq ft)', { req: true }),
            len('el', 'Distance between sections', 'ft', { req: true })
          ],
          compute(v) {
            const vol = C.averageEndArea(v.a1 * C.SQFT, v.a2 * C.SQFT, v.el);
            return [V('Volume', vol, 'cuyd', { big: true }), V('Volume', vol, 'cuft')];
          }
        },
        {
          id: 'swell', label: 'Bank / Loose / Compacted',
          note: 'Convert yards between in-the-ground (bank), in-the-truck (loose) and compacted.',
          fields: [
            num('vol', 'Volume (cu yd)', { req: true }),
            choice('from', 'That volume is', [['bank', 'Bank'], ['loose', 'Loose'], ['compacted', 'Compacted']], 'bank'),
            soilChoice(), num('swell', 'Swell %', { hint: 'blank = material default' }), num('shrink', 'Shrink %', { hint: 'blank = material default' }),
            num('truck', 'Truck capacity (loose cu yd)', { def: 12 })
          ],
          compute(v) {
            const f = C.soilFactors(v.soil, v.swell, v.shrink);
            const x = C.swellShrink(v.vol * C.CUYD, v.from, f);
            return [
              V('Bank (in the ground)', x.bank, 'cuyd', { big: v.from !== 'bank' }),
              V('Loose (in the truck)', x.loose, 'cuyd', { big: v.from !== 'loose' }),
              V('Compacted', x.compacted, 'cuyd', { big: v.from !== 'compacted' }),
              N('Truck loads', C.loads(x.loose, v.truck), 0, ' @ ' + C.fmtNum(v.truck, 1) + ' yd'),
              I('Swell ' + C.fmtNum(f.swell, 1) + '%, shrink ' + C.fmtNum(f.shrink, 1) + '% (' + C.SOILS[v.soil].label + '). Typical values — soils vary.')
            ];
          }
        }
      ]
    },
    {
      id: 'gravel', title: 'Gravel & Fill', desc: 'Tons · yards · truck loads',
      modes: [
        {
          id: 'area', label: 'By area',
          fields: [
            len('L', 'Length', 'ft', { req: true }), len('W', 'Width', 'ft', { req: true }),
            len('D', 'Depth', 'in', { def: 4 }), materialChoice(),
            num('tpy', 'Tons per cu yd', { hint: 'blank = material default' }),
            num('comp', 'Compaction extra %', { def: 0, hint: 'e.g. 15–20 for road base' }),
            num('trk', 'Truck capacity (tons)', { def: 14 }), num('price', 'Price per ton ($)', {})
          ],
          compute: (v) => gravelRows(v.L * v.W * v.D, v)
        },
        {
          id: 'vol', label: 'By volume',
          fields: [
            num('cy', 'Volume (cu yd)', { req: true }), materialChoice(),
            num('tpy', 'Tons per cu yd', { hint: 'blank = material default' }),
            num('comp', 'Compaction extra %', { def: 0 }),
            num('trk', 'Truck capacity (tons)', { def: 14 }), num('price', 'Price per ton ($)', {})
          ],
          compute: (v) => gravelRows(v.cy * C.CUYD, v)
        }
      ]
    },
    {
      id: 'rebar', title: 'Rebar', desc: 'Slab grid · footing bars · weight',
      modes: [
        {
          id: 'grid', label: 'Slab grid',
          note: 'Bars both ways. Lap defaults to 40 bar diameters (e.g. 20" for #4) — use your engineer\'s spec. Stock count assumes short bars are cut from full sticks.',
          fields: [
            len('L', 'Slab length', 'ft', { req: true }), len('W', 'Slab width', 'ft', { req: true }),
            len('sp', 'Bar spacing (O.C.)', 'in', { def: 18 }), len('cov', 'Edge cover', 'in', { def: 3 }),
            barChoice(), len('stock', 'Stock length', 'ft', { def: 20 }), len('lap', 'Lap splice', 'in', { hint: 'blank = 40 bar dia.' })
          ],
          compute(v) {
            const r = C.rebarGrid({ L: v.L, W: v.W, spacing: v.sp, cover: v.cov, size: +v.bar, stock: v.stock, lap: v.lap });
            return rebarRows(r, v).concat([
              I(r.nAlongL + ' bars @ ' + C.formatFtIn(r.barL, prec()) + ' + ' + r.nAlongW + ' bars @ ' + C.formatFtIn(r.barW, prec()) + '.')
            ]);
          }
        },
        {
          id: 'line', label: 'Footing / Wall',
          note: 'Continuous horizontal bars, plus optional vertical dowels at a spacing.',
          fields: [
            len('fl', 'Footing length', 'ft', { req: true }), num('n', 'Number of continuous bars', { def: 2 }),
            barChoice(), len('stock', 'Stock length', 'ft', { def: 20 }), len('lap', 'Lap splice', 'in', { hint: 'blank = 40 bar dia.' }),
            len('dsp', 'Dowel spacing', 'in', { hint: 'optional' }), len('dl', 'Dowel length', 'in', { hint: 'optional' })
          ],
          compute(v) {
            const r = C.rebarLinear({ length: v.fl, count: v.n, size: +v.bar, stock: v.stock, lap: v.lap, dowelSpacing: v.dsp, dowelLength: v.dl });
            const rows = rebarRows(r, v);
            if (r.dowels) rows.push(N('Dowels', r.dowels, 0, ''));
            return rows;
          }
        }
      ]
    },
    {
      id: 'block', title: 'Block (CMU)', desc: 'Block count · mortar · grout',
      note: 'Standard 8"×16" face = 1.125 block per sq ft. Mortar and grout are estimates — grout is for fully grouted walls (typical NCMA volumes).',
      modes: [{
        id: 'main',
        fields: [
          len('L', 'Wall length', 'ft', { req: true }), len('H', 'Wall height', 'ft', { req: true }),
          num('open', 'Openings to deduct (sq ft)', { def: 0 }),
          choice('bw', 'Block width', [['6', '6"'], ['8', '8"'], ['10', '10"'], ['12', '12"']], '8'),
          choice('grout', 'Grout', [['none', 'None / cells only'], ['solid', 'Solid grouted']], 'none'),
          num('bwaste', 'Waste %', { def: 5 }), num('perBag', 'Blocks per 80 lb mortar bag', { def: 12 })
        ],
        compute(v) {
          const b = C.blockWall({ length: v.L, height: v.H, openings: v.open * C.SQFT, width: +v.bw, grout: v.grout, waste: v.bwaste, perBag: v.perBag });
          const rows = [
            N('Blocks', b.blocks, 0, '', { big: true }),
            A('Net wall area', b.net),
            N('Courses (8")', b.courses, 0),
            N('Mortar mix bags (80 lb)', b.mortarBags, 0)
          ];
          if (v.grout === 'solid') rows.push(V('Grout', b.groutCuFt * C.CUFT, 'cuyd', { big: true }));
          return rows;
        }
      }]
    },
    {
      id: 'lumber', title: 'Lumber', desc: 'Board feet · wall studs',
      modes: [
        {
          id: 'bf', label: 'Board Feet',
          fields: [
            num('t', 'Thickness (in, nominal)', { def: 2 }), num('w', 'Width (in, nominal)', { req: true }),
            len('bl', 'Length', 'ft', { req: true }), num('bq', 'Pieces', { def: 1 }),
            num('price', 'Price per board foot ($)', {})
          ],
          compute(v) {
            const bf = C.boardFeet(v.t, v.w, v.bl, v.bq);
            const rows = [N('Board feet', bf, 2, ' BF', { big: true }), N('Lineal feet', v.bl / 12 * v.bq, 2, ' LF')];
            if (v.price != null) rows.push(T('Cost', '$' + (bf * v.price).toFixed(2)));
            return rows;
          }
        },
        {
          id: 'studs', label: 'Wall Studs',
          note: 'Layout studs plus 2 per corner/tee and 2 per opening (king + jack). Plates: 1 bottom + 2 top.',
          fields: [
            len('wl', 'Wall length', 'ft', { req: true }),
            choice('oc', 'Stud spacing', [['16', '16" O.C.'], ['24', '24" O.C.']], '16'),
            num('corners', 'Corners / tees', { def: 0 }), num('openings', 'Doors / windows', { def: 0 }),
            len('stock', 'Plate stock length', 'ft', { def: 16 }), num('swaste', 'Waste %', { def: 0 })
          ],
          compute(v) {
            const s = C.studs({ length: v.wl, oc: +v.oc, corners: v.corners, openings: v.openings, waste: v.swaste, plateStock: v.stock });
            return [
              N('Studs', s.total, 0, '', { big: true }),
              I(s.base + ' on layout + ' + s.extras + ' for corners/openings' + (v.swaste ? ' + ' + v.swaste + '% waste' : '')),
              N('Plate lineal feet', s.plateLf, 1, ' LF'),
              N('Plate pieces', s.platePieces, 0, ' @ ' + C.fmtNum(v.stock / 12, 1) + "'")
            ];
          }
        }
      ]
    },
    {
      id: 'sheets', title: 'Sheet Goods', desc: 'Drywall · sheathing · subfloor',
      note: 'Enter length × height, or a total area. Area is multiplied by the number of surfaces, then openings are deducted.',
      modes: [{
        id: 'main',
        fields: [
          len('sl', 'Length', 'ft'), len('sh', 'Height / width', 'ft'),
          num('area', 'Or total area (sq ft)', {}),
          num('surf', 'Number of identical surfaces', { def: 1 }),
          num('open', 'Openings to deduct (sq ft)', { def: 0 }),
          choice('size', 'Sheet size', [['4x8', "4×8"], ['4x9', "4×9"], ['4x10', "4×10"], ['4x12', "4×12"]], '4x8'),
          waste(sheetWaste)
        ],
        compute(v) {
          let a;
          if (v.area != null) a = v.area * C.SQFT;
          else if (v.sl != null && v.sh != null) a = v.sl * v.sh;
          else throw new Error('Enter length and height, or a total area');
          a = a * v.surf - v.open * C.SQFT;
          const [w, h] = v.size.split('x').map(Number);
          const s = C.sheets(a, w * h * C.SQFT, v.waste);
          return [
            N('Sheets', s.count, 0, ' × ' + v.size.replace('x', '×'), { big: true }),
            A('Net area', s.net), A('With waste', s.gross),
            I('One ' + v.size.replace('x', '×') + ' sheet = ' + (w * h) + ' sq ft. Includes ' + C.fmtNum(v.waste, 1) + '% waste.')
          ];
        }
      }]
    },
    {
      id: 'area', title: 'Area & Volume', desc: 'Rectangles · triangles · circles · irregular',
      modes: [
        {
          id: 'rect', label: 'Rectangle',
          fields: [len('al', 'Length', 'ft', { req: true }), len('aw', 'Width', 'ft', { req: true }), depthField],
          compute: (v) => areaRows(C.area.rect(v.al, v.aw), 2 * (v.al + v.aw), v.depth)
        },
        {
          id: 'tri', label: 'Triangle',
          fields: [len('tb', 'Base', 'ft', { req: true }), len('th', 'Height', 'ft', { req: true }), depthField],
          compute: (v) => areaRows(C.area.triangle(v.tb, v.th), null, v.depth)
        },
        {
          id: 'tri3', label: 'Triangle (3 sides)',
          fields: [len('s1', 'Side A', 'ft', { req: true }), len('s2', 'Side B', 'ft', { req: true }), len('s3', 'Side C', 'ft', { req: true }), depthField],
          compute: (v) => areaRows(C.area.triangle3(v.s1, v.s2, v.s3), v.s1 + v.s2 + v.s3, v.depth)
        },
        {
          id: 'circle', label: 'Circle',
          fields: [len('cd', 'Diameter', 'ft', { req: true }), depthField],
          compute: (v) => areaRows(C.area.circle(v.cd), Math.PI * v.cd, v.depth)
        },
        {
          id: 'trap', label: 'Trapezoid',
          fields: [len('ta', 'Side A (parallel)', 'ft', { req: true }), len('tb2', 'Side B (parallel)', 'ft', { req: true }), len('tz', 'Height between them', 'ft', { req: true }), depthField],
          compute: (v) => areaRows(C.area.trapezoid(v.ta, v.tb2, v.tz), null, v.depth)
        },
        {
          id: 'quad', label: 'Irregular 4-side',
          note: 'Measure all 4 sides and one diagonal. Sides A and B meet at one end of the diagonal; C and D meet at the other. For bigger shapes, split them into pieces and add the results on the tape.',
          fields: [
            len('qa', 'Side A', 'ft', { req: true }), len('qb', 'Side B', 'ft', { req: true }),
            len('qc', 'Side C', 'ft', { req: true }), len('qd', 'Side D', 'ft', { req: true }),
            len('qp', 'Diagonal', 'ft', { req: true }), depthField
          ],
          compute: (v) => areaRows(C.area.quad(v.qa, v.qb, v.qc, v.qd, v.qp), v.qa + v.qb + v.qc + v.qd, v.depth)
        }
      ]
    },
    {
      id: 'circles', title: 'Circles & Arcs', desc: 'Circumference · arc length · radius',
      modes: [
        {
          id: 'circ', label: 'Circle',
          fields: [len('cd', 'Diameter', 'ft', { req: true })],
          compute(v) {
            const c = C.circle(v.cd);
            return [L('Circumference', c.circumference, { big: true }), L('Radius', c.radius), A('Area', c.area)];
          }
        },
        {
          id: 'ch', label: 'Chord + Height',
          note: 'Chord = straight distance across the arc. Height (rise) = from the chord midpoint up to the arc.',
          fields: [len('cc', 'Chord', 'in', { req: true }), len('chh', 'Height (rise)', 'in', { req: true })],
          compute(v) {
            const a = C.arcFromChordHeight(v.cc, v.chh);
            return [L('Radius', a.radius, { big: true }), L('Diameter', a.diameter), L('Arc length', a.arc, { big: true }), N('Arc angle', a.deg, 2, '°')];
          }
        },
        {
          id: 'ang', label: 'Radius + Angle',
          fields: [len('cr', 'Radius', 'in', { req: true }), num('cang', 'Arc angle (degrees)', { req: true })],
          compute(v) {
            const a = C.arcFromAngle(v.cr, v.cang);
            return [L('Arc length', a.arc, { big: true }), L('Chord', a.chord), L('Height (rise)', a.height), A('Sector area', a.sectorArea)];
          }
        },
        {
          id: 'rc', label: 'Radius + Chord',
          fields: [len('cr', 'Radius', 'in', { req: true }), len('cc', 'Chord', 'in', { req: true })],
          compute(v) {
            const a = C.arcFromRadiusChord(v.cr, v.cc);
            return [L('Height (rise)', a.height, { big: true }), L('Arc length', a.arc, { big: true }), N('Arc angle', a.deg, 2, '°')];
          }
        }
      ]
    },
    {
      id: 'convert', title: 'Convert', desc: 'Length · area · volume units',
      note: 'Units typed in the value win over the "From" setting. Tap any result to send it to the tape.',
      modes: [{
        id: 'main',
        fields: [
          { id: 'val', label: 'Value', kind: 'any', req: true },
          choice('from', 'From (if no unit typed)', [
            ['in', 'in'], ['ft', 'ft'], ['yd', 'yd'], ['m', 'm'], ['cm', 'cm'], ['mm', 'mm'],
            ['sqft', 'sq ft'], ['sqin', 'sq in'], ['sqyd', 'sq yd'], ['sqm', 'sq m'],
            ['cuyd', 'cu yd'], ['cuft', 'cu ft'], ['cuin', 'cu in'], ['cum', 'cu m']
          ], 'ft')
        ],
        compute(v) {
          let val = v.val;
          if (val.d === 0) {
            const m = /^(sq|cu)?(.+)$/.exec(v.from);
            const d = m[1] === 'sq' ? 2 : m[1] === 'cu' ? 3 : 1;
            val = { v: val.v * Math.pow(C.IN[m[2]], d), d };
          }
          return C.MODES[val.d].map((mode) => {
            const r = { label: mode.label, fixed: mode.fmt(val.v, prec()), raw: val };
            return r;
          });
        }
      }]
    }
  ];
  const TOOL = {};
  TOOLS.forEach((t) => { TOOL[t.id] = t; });

  // ================================================================ icons, groups, search words
  const svg = (inner, cls) => '<svg viewBox="0 0 24 24" aria-hidden="true"' + (cls ? ' class="' + cls + '"' : '') + '>' + inner + '</svg>';
  const ICON = {
    rightangle: '<path d="M5 19V5l14 14z"/>',
    grade: '<path d="M3 19h18M3 19l18-10"/>',
    rafters: '<path d="M3 13l9-8 9 8M6 11v8h12v-8"/>',
    stairs: '<path d="M4 20h4v-4h4v-4h4V8h4"/>',
    concrete: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    dirt: '<path d="M3 9h18M6 9v6a3 3 0 003 3h6a3 3 0 003-3V9"/>',
    gravel: '<circle cx="8" cy="15" r="3"/><circle cx="16" cy="14" r="4"/><circle cx="11" cy="8" r="3"/>',
    rebar: '<path d="M4 8h16M4 12h16M4 16h16M8 4v16M16 4v16"/>',
    block: '<path d="M3 7h18v10H3z"/><path d="M3 12h18M9 7v5M15 12v5"/>',
    lumber: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M8 8v8M13 8v8"/>',
    sheets: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M5 12h14"/>',
    area: '<path d="M4 4h16v16H4z"/><path d="M4 4l16 16"/>',
    circles: '<circle cx="12" cy="12" r="8"/><path d="M12 12h8"/>',
    convert: '<path d="M5 8h13l-3-3M19 16H6l3 3"/>'
  };
  const JOB_ICON = '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 11h6M9 15h4"/>';
  const CHEV = svg('<path d="M9 6l6 6-6 6"/>', 'chev');
  const PLUS = svg('<path d="M12 5v14M5 12h14"/>');
  const SHARE = svg('<path d="M12 4v11M8 8l4-4 4 4M5 14v5h14v-5"/>');
  const LIST_ICON = svg('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>');
  const ARROW = svg('<path d="M5 12h14M13 6l6 6-6 6"/>');
  const XICON = svg('<path d="M6 6l12 12M18 6L6 18"/>');
  const GROUPS = [
    ['Sitework', ['grade', 'dirt', 'gravel']],
    ['Concrete & Masonry', ['concrete', 'rebar', 'block']],
    ['Framing', ['rightangle', 'rafters', 'stairs', 'lumber', 'sheets']],
    ['Geometry & Units', ['area', 'circles', 'convert']]
  ];
  const KEYWORDS = {
    rightangle: 'pythagorean diagonal square triangle hypotenuse',
    grade: 'slope percent elevation station pipe sewer drain invert fall',
    rafters: 'roof pitch hip valley jack common birdsmouth',
    stairs: 'stair riser tread stringer irc code',
    concrete: 'slab footing wall pad pier sonotube tube steps ready mix truck yards',
    dirt: 'excavation trench dig pit basement cut fill swell shrink truck loads dirt earthwork',
    gravel: 'gravel rock base tons fill sand asphalt',
    rebar: 'steel bar reinforcing lap dowel',
    block: 'cmu masonry mortar grout',
    lumber: 'board feet studs plates framing',
    sheets: 'drywall plywood osb sheathing subfloor',
    area: 'area volume square footage',
    circles: 'circle arc radius chord',
    convert: 'units metric conversion'
  };
  let recent = store.get('recent', []);

  // ================================================================ fields
  const currentMode = (tool) => tool.modes.find((m) => m.id === modes[tool.id]) || tool.modes[0];
  const fieldKey = (toolId, f) => toolId + '.' + f.id;

  function defaultOf(f) { return typeof f.def === 'function' ? f.def() : f.def; }

  // Parse a field's raw text into a number (inches for lengths). null = blank.
  function readField(toolId, f) {
    const raw = (inputs[fieldKey(toolId, f)] || '').trim();
    if (f.kind === 'choice') return raw || f.def;
    if (!raw) {
      const def = defaultOf(f);
      if (def == null) return null;
      return f.kind === 'len' ? def * C.IN[f.unit] : def;
    }
    const val = C.evaluate(raw);
    if (f.kind === 'any') return val;
    if (f.kind === 'len') {
      if (val.d === 0) return val.v * C.IN[f.unit];
      if (val.d !== 1) throw new Error('needs a length');
      return val.v;
    }
    if (val.d !== 0) throw new Error('enter a plain number (no units)');
    return val.v;
  }

  function defaultText(f) {
    const def = defaultOf(f);
    if (def == null) return null;
    return f.kind === 'len' ? fmtLen(def * C.IN[f.unit], f.unit === 'in' ? 'in' : 'ftin') : C.fmtNum(def, 3);
  }
  function placeholderOf(f) { const d = defaultText(f); return d != null ? d : '—'; }
  function unitOf(f) {
    if (f.kind === 'len') return f.unit.toUpperCase();
    if (/%$/.test(f.label)) return '%';
    return '';
  }
  const displayName = (f) => unitOf(f) === '%' ? f.label.replace(/\s*%$/, '') : f.label;

  function fieldHint(f) {
    const parts = [];
    if (f.kind === 'len') parts.push('no unit = ' + (f.unit === 'ft' ? 'feet' : 'inches'));
    if (f.hint) parts.push(f.hint);
    else if (!f.req && defaultOf(f) == null) parts.push('optional');
    return parts.join(' · ');
  }

  function fieldHTML(toolId, f) {
    const key = fieldKey(toolId, f);
    if (f.kind === 'choice') {
      const cur = inputs[key] || f.def;
      return '<div class="choice"><div class="choice-label">' + esc(f.label) + '</div><div class="opts">' +
        f.options.map(([val, lab]) => '<button data-choice="' + esc(key) + '" data-val="' + esc(val) + '" class="' + (val === cur ? 'on' : '') + '" aria-pressed="' + (val === cur) + '">' + esc(lab) + '</button>').join('') +
        '</div></div>';
    }
    const unit = unitOf(f);
    return '<button class="field" data-key="' + esc(key) + '" data-tool="' + esc(toolId) + '" data-field="' + esc(f.id) + '">' +
      '<span class="f-label"><span class="f-name">' + esc(displayName(f)) + '</span>' + (f.hint ? '<span class="f-hint">' + esc(f.hint) + '</span>' : '') + '</span>' +
      '<span class="f-val"></span>' + (unit ? '<span class="unit-chip">' + esc(unit) + '</span>' : '') + '</button>';
  }

  function paintField(el, f) {
    const raw = (inputs[el.dataset.key] || '').trim();
    const v = $('.f-val', el);
    v.classList.remove('placeholder', 'default');
    const chip = $('.unit-chip', el);
    if (chip) chip.hidden = /['"a-z]/i.test(raw);   // a typed unit wins over the default unit
    if (raw) { v.textContent = raw; return; }
    const d = defaultText(f);
    v.textContent = d != null ? d : '—';
    v.classList.add(d != null ? 'default' : 'placeholder');
  }

  // ================================================================ tool screen
  let curToolId = null;
  let curRows = [];
  let heroIndex = -1;

  function renderTool(id) {
    const tool = TOOL[id];
    if (!tool) return showScreen('tools');
    curToolId = id;
    recent = [id].concat(recent.filter((x) => x !== id && TOOL[x])).slice(0, 3);
    store.set('recent', recent);
    const mode = currentMode(tool);
    $('#toolTitle').textContent = tool.title;
    let html = '';
    if (tool.modes.length > 1) {
      html += '<div class="' + (tool.modes.length <= 3 ? 'seg' : 'pills') + ' modes" role="tablist" aria-label="Mode">' + tool.modes.map((m) =>
        '<button role="tab" aria-selected="' + (m === mode) + '" data-mode="' + m.id + '" class="' + (m === mode ? 'on' : '') + '">' + esc(m.label) + '</button>').join('') + '</div>';
    }
    html += '<div class="out" id="outHero"></div>';
    html += '<h2 class="label">' + (mode.anyTwo ? 'Enter any two' : 'Inputs') + '</h2>';
    html += '<div class="fields">' + mode.fields.map((f) => fieldHTML(id, f)).join('') + '</div>';
    html += '<div class="out" id="out"></div>';
    html += '<p class="tap-note">Tap any result to send it to the calculator tape.</p>';
    const note = mode.note || tool.note;
    if (note) html += '<p class="note">' + esc(note) + '</p>';
    $('#toolBody').innerHTML = html;
    $$('.field', $('#toolBody')).forEach((el) => paintField(el, mode.fields.find((f) => f.id === el.dataset.field)));
    computeTool();
  }

  const hasValue = (r) => r.len != null || r.area != null || r.vol != null || r.num != null || r.fixed != null || r.text != null;

  function computeTool() {
    const tool = TOOL[curToolId];
    if (!tool) return;
    const mode = currentMode(tool);
    const heroEl = $('#outHero');
    const out = $('#out');
    const vals = {};
    const missing = [];
    let problem = null;
    mode.fields.forEach((f) => {
      const el = $('.field[data-field="' + f.id + '"]', $('#toolBody'));
      if (el) el.classList.remove('bad');
      try {
        vals[f.id] = readField(tool.id, f);
        if (vals[f.id] == null && f.req) missing.push(displayName(f));
      } catch (e) {
        if (el) el.classList.add('bad');
        if (!problem) problem = displayName(f) + ': ' + (e.message === 'Incomplete entry' ? 'finish the entry' : e.message);
      }
    });
    let rows;
    try {
      if (problem) throw new Error(problem);
      if (missing.length) throw new Error('Enter: ' + missing.join(', '));
      rows = mode.compute(vals);
    } catch (e) {
      const bad = !!problem || !missing.length;
      heroEl.innerHTML = '<div class="hero empty"><div class="hint' + (bad ? ' bad' : '') + '">' + esc(e.message) + '</div></div>';
      out.innerHTML = '';
      curRows = [];
      heroIndex = -1;
      return;
    }
    curRows = rows;
    heroIndex = rows.findIndex((r) => r.big && hasValue(r));
    if (heroIndex < 0) heroIndex = rows.findIndex(hasValue);
    let notes = '', tiles = '', infos = '';
    rows.forEach((r, i) => {
      if (i === heroIndex) return;
      if (r.warn || r.ok) notes += noteHTML(r);
      else if (r.info) infos += noteHTML(r);
      else tiles += rowHTML(r, i);
    });
    heroEl.innerHTML = (heroIndex >= 0 ? heroHTML(rows[heroIndex], heroIndex) : '') + notes;
    out.innerHTML = tiles + infos;
  }

  // Display text for one result row: { val, sub, tap }
  function rowParts(r) {
    let val, sub = '', tap = null;
    if (r.len != null) {
      const v = r.len;
      if (r.fmt === 'in') {
        val = C.formatInches(v, prec());
        sub = C.fmtNum(v, 3) + '" · ' + C.fmtNum(v * 25.4, 1) + ' mm';
      } else if (r.fmt === 'ftdec') {
        val = (Math.abs(v) < 0.006 ? 0 : v / 12).toFixed(2) + "'";
        sub = C.formatFtIn(v, prec()) + ' · ' + C.fmtNum(v * 0.0254, 3) + ' m';
      } else {
        val = C.formatFtIn(v, prec());
        sub = C.fmtNum(v / 12, 3) + "' · " + C.fmtNum(v, 3) + '" · ' + C.fmtNum(v * 0.0254, 3) + ' m';
      }
      tap = { v, d: 1 };
    } else if (r.area != null) {
      val = C.fmtNum(r.area / C.SQFT, 2) + ' sq ft';
      sub = C.fmtNum(r.area / C.SQYD, 2) + ' sq yd · ' + C.fmtNum(r.area / C.SQM, 2) + ' sq m';
      tap = { v: r.area, d: 2 };
    } else if (r.vol != null) {
      if (r.unit === 'cuyd') {
        val = C.fmtNum(r.vol / C.CUYD, 2) + ' cu yd';
        sub = C.fmtNum(r.vol / C.CUFT, 1) + ' cu ft · ' + C.fmtNum(r.vol / C.CUM, 2) + ' cu m';
      } else {
        val = C.fmtNum(r.vol / C.CUFT, 2) + ' cu ft';
        sub = C.fmtNum(r.vol / C.CUYD, 2) + ' cu yd · ' + C.fmtNum(r.vol / C.CUM, 2) + ' cu m';
      }
      tap = { v: r.vol, d: 3 };
    } else if (r.num != null) {
      val = C.fmtNum(r.num, r.dec == null ? 3 : r.dec) + r.suffix;
      tap = { v: r.num, d: 0 };
    } else if (r.fixed != null) {
      val = r.fixed;
      tap = r.raw;
    } else {
      val = r.text;
    }
    if (r.sub) sub = r.sub;
    return { val, sub, tap };
  }
  const tapAttrs = (tap, i) => tap ? ' data-v="' + tap.v + '" data-d="' + tap.d + '" data-i="' + i + '" role="button" tabindex="0"' : '';

  function heroHTML(r, i) {
    const p = rowParts(r);
    return '<div class="hero"' + tapAttrs(p.tap, i) + '>' +
      '<div class="r-label">' + esc(r.label) + '</div><div class="r-val">' + esc(p.val) + '</div>' +
      (p.sub ? '<div class="r-sub">' + esc(p.sub) + '</div>' : '') +
      (p.tap ? '<div class="hero-actions"><button data-act="job">' + PLUS + 'Add to job</button><button data-act="tape">' + LIST_ICON + 'Send to tape</button></div>' : '') +
      '</div>';
  }

  function noteHTML(r) {
    const kind = r.warn ? 'warn' : r.ok ? 'ok' : 'info';
    return '<div class="note-row ' + kind + '">' + esc(r.warn || r.ok || r.info) + '</div>';
  }

  function rowHTML(r, i) {
    if (r.list) {
      return '<div class="row list"><div class="r-label">' + esc(r.label) + '</div>' +
        (r.list.length ? '<ol>' + r.list.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol>' : '<div class="r-sub">None at this spacing</div>') + '</div>';
    }
    const p = rowParts(r);
    const wide = String(p.val).length > 13 || r.text != null;
    return '<div class="row' + (wide ? ' wide' : '') + (r.big ? ' big' : '') + '"' + tapAttrs(p.tap, i) + '>' +
      '<div class="r-label">' + esc(r.label) + '</div><div class="r-val">' + esc(p.val) + '</div>' +
      (p.sub ? '<div class="r-sub">' + esc(p.sub) + '</div>' : '') + '</div>';
  }

  // ================================================================ tools list
  function renderTools() {
    const q = ($('#toolSearch').value || '').trim().toLowerCase();
    const match = (t) => !q || (t.title + ' ' + t.desc + ' ' + (KEYWORDS[t.id] || '')).toLowerCase().indexOf(q) >= 0;
    let html = '';
    const rec = recent.filter((id) => TOOL[id]);
    if (!q && rec.length) {
      html += '<h2 class="label">Recent</h2><div class="recent">' + rec.map((id) =>
        '<button class="recent-card" data-tool-open="' + id + '">' + svg(ICON[id]) + '<span>' + esc(TOOL[id].title) + '</span></button>').join('') + '</div>';
    }
    let any = false;
    GROUPS.forEach(([name, ids]) => {
      const ts = ids.map((id) => TOOL[id]).filter(match);
      if (!ts.length) return;
      any = true;
      html += '<h2 class="label">' + esc(name) + '</h2><div class="list">' + ts.map((t) =>
        '<button class="tool-row" data-tool-open="' + t.id + '"><span class="ico">' + svg(ICON[t.id]) + '</span>' +
        '<span class="names"><span class="n">' + esc(t.title) + '</span><span class="d">' + esc(t.desc) + '</span></span>' + CHEV + '</button>').join('') + '</div>';
    });
    if (!any) html += '<p class="no-match">No tools match “' + esc(q) + '”.</p>';
    $('#tiles').innerHTML = html;
  }

  // ================================================================ jobs
  let jobs = store.get('jobs', []);
  let activeJob = store.get('activeJob', null);
  let curJobId = null;
  const saveJobs = () => { store.set('jobs', jobs); store.set('activeJob', activeJob); };
  const jobById = (id) => jobs.find((j) => j.id === id);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function whenText(t) {
    const d = new Date(t);
    if (d.toDateString() === new Date().toDateString()) return 'today';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function createJob(name) {
    const j = { id: newId(), name, items: [], updated: Date.now() };
    jobs.unshift(j);
    activeJob = j.id;
    saveJobs();
    return j;
  }

  function askNewJob() {
    const name = prompt('Name this job', 'Job ' + (jobs.length + 1));
    if (name == null) return null;
    return createJob(name.trim() || 'Job ' + (jobs.length + 1));
  }

  function inputSummary(tool, mode) {
    const parts = [];
    mode.fields.forEach((f) => {
      if (f.kind === 'choice') {
        const cur = readField(tool.id, f);
        const opt = f.options.find((o) => o[0] === cur);
        if (opt && f.options.length > 1) parts.push(opt[1]);
        return;
      }
      const typed = (inputs[fieldKey(tool.id, f)] || '').trim();
      if (!typed && /^(qty|waste|swaste|bwaste|truck|trk|perBag|stock)$/.test(f.id)) return;  // routine defaults
      let v;
      try { v = readField(tool.id, f); } catch (e) { return; }
      if (v == null) return;
      const t = f.kind === 'len' ? fmtLen(v, f.unit === 'in' ? 'in' : 'ftin').replace(/' 0"$/, "'") : f.kind === 'any' ? fmtVal(v) : C.fmtNum(v, 3) + (unitOf(f) === '%' ? '%' : '');
      parts.push(displayName(f) + ' ' + t);
    });
    return parts.join(' · ');
  }

  const ROW_KEYS = ['label', 'len', 'area', 'vol', 'unit', 'num', 'dec', 'suffix', 'fmt'];
  function plainRow(r) {
    const o = {};
    ROW_KEYS.forEach((k) => { if (r[k] != null) o[k] = r[k]; });
    return o;
  }
  const rowKind = (r) => r.len != null ? 'len' : r.area != null ? 'area' : r.vol != null ? 'vol' : r.num != null ? 'num' : null;

  function addHeroToJob() {
    const tool = TOOL[curToolId];
    const r = curRows[heroIndex];
    if (!tool || !r || !rowKind(r)) return;
    const mode = currentMode(tool);
    let job = jobById(activeJob);
    if (!job) job = askNewJob();
    if (!job) return;
    job.items.push({
      id: newId(), tool: tool.id,
      title: tool.modes.length > 1 ? tool.title + ' — ' + mode.label : tool.title,
      row: plainRow(r), desc: inputSummary(tool, mode), net: r.net != null ? r.net : null
    });
    job.updated = Date.now();
    saveJobs();
    buzz();
    toast('Added to ' + job.name);
  }

  function jobGroups(job) {
    const groups = [];
    job.items.forEach((it) => {
      const r = it.row, kind = rowKind(r);
      if (!kind) return;
      const key = [it.tool, r.label, kind, r.unit || '', r.suffix || ''].join('|');
      let g = groups.find((x) => x.key === key);
      if (!g) { g = { key, tool: it.tool, row: Object.assign({}, r), kind, sum: 0, net: 0, hasNet: true, count: 0 }; groups.push(g); }
      g.sum += r[kind];
      g.count++;
      if (it.net != null) g.net += it.net; else g.hasNet = false;
      g.row[kind] = g.sum;
    });
    return groups;
  }

  function renderJobs() {
    let html = '<button class="btn-primary" data-act="newjob">' + PLUS + 'NEW JOB</button>';
    if (!jobs.length) {
      html += '<div class="empty-state" style="margin-top:12px">No jobs yet. A job collects results from any tool — every slab, footing and pad — and adds them up into one order.</div>';
    } else {
      html += '<h2 class="label">Your jobs</h2><div class="list">' + jobs.map((j) =>
        '<button class="tool-row" data-job-open="' + j.id + '"><span class="ico">' + svg(JOB_ICON) + '</span>' +
        '<span class="names"><span class="n">' + esc(j.name) + '</span><span class="d">' + plural(j.items.length, 'item') + ' · updated ' + whenText(j.updated) + '</span></span>' +
        (j.id === activeJob ? '<span class="badge">ACTIVE</span>' : '') + CHEV + '</button>').join('') + '</div>';
      html += '<p class="note">“Add to job” on any tool result goes to the active job. Open a job to make it active.</p>';
    }
    $('#jobsBody').innerHTML = html;
  }

  function renderJob(id) {
    const job = jobById(id);
    if (!job) return showScreen('jobs');
    curJobId = id;
    if (activeJob !== id) { activeJob = id; saveJobs(); }
    $('#jobTitle').textContent = job.name;
    let html = '<div class="sub-line">' + plural(job.items.length, 'item') + ' · updated ' + whenText(job.updated) + ' · active</div>';
    const groups = jobGroups(job);
    if (!job.items.length) {
      html += '<div class="empty-state">No items yet. Open a tool, get a result, and tap <b>Add to job</b>.</div>';
    } else {
      html += '<div class="out">';
      groups.forEach((g, gi) => {
        const p = rowParts(g.row);
        if (gi === 0) {
          html += '<div class="hero"><div class="r-label">' + esc(g.row.label) + '</div><div class="r-val">' + esc(p.val) + '</div>' +
            '<div class="r-sub">Total of ' + plural(g.count, 'item') + '</div>';
          if (g.tool === 'concrete' && g.kind === 'vol' && g.hasNet && g.net > 0) {
            const yd = g.sum / C.CUYD;
            html += '<div class="mini"><div><span>Net</span><span>' + C.fmtNum(g.net / C.CUYD, 2) + ' yd</span></div>' +
              '<div><span>Waste</span><span>' + C.fmtNum((g.sum / g.net - 1) * 100, 1) + '%</span></div>' +
              '<div><span>Trucks</span><span>' + Math.ceil(yd / 10 - C.EPS) + ' @ 10 yd</span></div></div>';
          }
          html += '</div>';
        } else {
          html += '<div class="row wide"><div class="r-label">Total · ' + esc(g.row.label) + '</div><div class="r-val">' + esc(p.val) + '</div><div class="r-sub">' + plural(g.count, 'item') + '</div></div>';
        }
      });
      html += '</div><h2 class="label">Items</h2><div class="list">' + job.items.map((it) =>
        '<div class="item-row"><span class="names"><span class="n">' + esc(it.title) + '</span><span class="d">' + esc(it.desc || '') + '</span></span>' +
        '<span class="v">' + esc(rowParts(it.row).val) + '</span>' +
        '<button class="icon-btn" data-remove="' + it.id + '" aria-label="Remove ' + esc(it.title) + '">' + XICON + '</button></div>').join('') + '</div>';
    }
    html += '<div class="stack">' +
      '<button class="btn-outline" data-go="tools">' + PLUS + 'Add item from a tool</button>' +
      (job.items.length ? '<button class="btn-primary" id="jobShare2">' + SHARE + 'SEND ORDER / TAKEOFF</button>' : '') +
      '<button class="btn-wide" id="jobRename">Rename job</button>' +
      '<button class="btn-wide danger" id="jobDelete">Delete job</button></div>';
    $('#jobBody').innerHTML = html;
  }

  function takeoffText(job) {
    const lines = [job.name + ' — takeoff', ''];
    job.items.forEach((it) => lines.push('• ' + it.title + ': ' + rowParts(it.row).val + (it.desc ? '  (' + it.desc + ')' : '')));
    const groups = jobGroups(job);
    if (groups.length) lines.push('');
    groups.forEach((g) => {
      let t = 'TOTAL ' + g.row.label + ': ' + rowParts(g.row).val;
      if (g.tool === 'concrete' && g.kind === 'vol' && g.hasNet && g.net > 0) {
        t += ' — ' + Math.ceil(g.sum / C.CUYD / 10 - C.EPS) + ' trucks @ 10 yd, net ' + C.fmtNum(g.net / C.CUYD, 2) + ' cu yd';
      }
      lines.push(t);
    });
    lines.push('', 'Jobsite Calc');
    return lines.join('\n');
  }

  function shareJob() {
    const job = jobById(curJobId);
    if (!job || !job.items.length) return;
    const text = takeoffText(job);
    if (navigator.share) {
      navigator.share({ title: job.name + ' takeoff', text }).catch(() => { /* cancelled */ });
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Takeoff copied'), () => toast('Could not copy'));
    } else {
      toast('Sharing not available here');
    }
  }

  // ================================================================ settings screen
  const SETTINGS_FIELDS = [
    num('concreteWaste', 'Concrete waste %', { def: 10 }),
    num('sheetWaste', 'Sheet goods waste %', { def: 10 })
  ];

  function renderSettings() {
    curToolId = null;
    const precBtns = [2, 4, 8, 16, 32, 64].map((p) =>
      '<button data-prec="' + p + '" class="' + (p === prec() ? 'on' : '') + '" aria-pressed="' + (p === prec()) + '">1/' + p + '"</button>').join('');
    const themeBtns = [['dark', 'Graphite (night)'], ['light', 'Daylight (sun)']].map(([v, l]) =>
      '<button data-theme-set="' + v + '" class="' + (settings.theme === v ? 'on' : '') + '" aria-pressed="' + (settings.theme === v) + '">' + l + '</button>').join('');
    const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
    $('#settingsBody').innerHTML =
      '<div class="set-group"><h2 class="label">Fraction precision</h2><div class="grid3">' + precBtns + '</div>' +
      '<p>Results round to the nearest 1/' + prec() + '". Math is done at full precision.</p></div>' +
      '<div class="set-group"><h2 class="label">Look</h2><div class="grid2">' + themeBtns + '</div>' +
      '<p>Daylight is easier to read in direct sun.</p></div>' +
      '<div class="set-group"><h2 class="label">Default waste</h2><div class="fields">' +
      SETTINGS_FIELDS.map((f) => fieldHTML('settings', f)).join('') + '</div>' +
      '<p>Used when a tool\'s own waste % is left blank.</p></div>' +
      '<div class="set-group"><h2 class="label">Data</h2><div class="stack" style="margin-top:0">' +
      '<button class="btn-wide" id="resetInputs">Clear all tool inputs</button>' +
      '<button class="btn-wide danger" id="clearTape2">Clear calculator tape (' + tape.length + ')</button></div></div>' +
      '<div class="set-group"><h2 class="label">Offline</h2><p style="margin-top:0">' + (sw ? '✓ Saved for offline use. Works with no signal.' : 'Not cached yet. Open once over https (e.g. GitHub Pages) and reload to enable offline use.') + '</p></div>' +
      '<p class="about">Jobsite Calc · version ' + APP_VERSION + '</p>';
    $$('.field', $('#settingsBody')).forEach((el) => paintField(el, SETTINGS_FIELDS.find((f) => f.id === el.dataset.field)));
  }

  // ================================================================ measurement entry sheet
  let active = null; // { el, key, f, toolId }

  function fieldDef(toolId, fieldId) {
    if (toolId === 'settings') return SETTINGS_FIELDS.find((f) => f.id === fieldId);
    return currentMode(TOOL[toolId]).fields.find((f) => f.id === fieldId);
  }

  function nextField() {
    if (!active) return null;
    const all = $$('.field', active.el.closest('.screen'));
    return all[all.indexOf(active.el) + 1] || null;
  }

  function openSheet(el) {
    if (active) active.el.classList.remove('active');
    const f = fieldDef(el.dataset.tool, el.dataset.field);
    active = { el, key: el.dataset.key, f, toolId: el.dataset.tool };
    el.classList.add('active');
    const sheet = $('#sheet');
    sheet.hidden = false;
    sheet.classList.toggle('no-units', f.kind === 'num');
    document.body.classList.add('sheet-open');
    paintSheet();
    // keep the field in view above (or beside) the sheet
    requestAnimationFrame(() => {
      const scroller = el.closest('.screen');
      const r = el.getBoundingClientRect();
      const s = sheet.getBoundingClientRect();
      const coveredBelow = s.top > 0 && s.left <= r.left + 1;
      if ((coveredBelow && r.bottom > s.top - 12) || r.top < 70) scroller.scrollTop += r.top - 150;
    });
  }

  function closeSheet() {
    if (active) active.el.classList.remove('active');
    active = null;
    $('#sheet').hidden = true;
    document.body.classList.remove('sheet-open');
  }

  function paintSheet() {
    if (!active) return;
    $('#sheetLabel').textContent = displayName(active.f);
    $('#sheetHint').textContent = fieldHint(active.f);
    const raw = inputs[active.key] || '';
    const v = $('#sheetVal');
    v.textContent = raw || placeholderOf(active.f);
    v.classList.toggle('placeholder', !raw);
    const nx = nextField();
    const nf = nx ? fieldDef(nx.dataset.tool, nx.dataset.field) : null;
    $('#nextKey').innerHTML = nf ? '<span class="next-t">NEXT: ' + esc(displayName(nf).toUpperCase()) + '</span>' + ARROW : 'DONE';
  }

  function fieldKeyPress(k) {
    if (!active) return;
    if (k === 'done') return closeSheet();
    if (k === 'next') {
      const nx = nextField();
      return nx ? openSheet(nx) : closeSheet();
    }
    let s = inputs[active.key] || '';
    if (k === 'bs') s = s.replace(/\s+$/, '').slice(0, -1).replace(/ \+$/, '');
    else if (k === 'clr') s = '';
    else if (k === 'ft') s = s.trimEnd() + "' ";
    else if (k === 'in') s = s.trimEnd() + '" ';
    else if (k === '+' || k === '-') s = s.trimEnd() + ' ' + k + ' ';
    else if (k === ' ') { if (s && !/\s$/.test(s)) s += ' '; }
    else if (k === 'ans') {
      if (!st.last) { toast('No calculator result yet'); return; }
      if (active.f.kind === 'num' && st.last.d !== 0) { toast('Last result has units'); return; }
      s = (s && !/[\s+]$/.test(s) ? '' : s) + fmtVal(st.last).replace(/,/g, '');
    } else s += k;
    s = s.replace(/^\s+/, '');
    if (s) inputs[active.key] = s; else delete inputs[active.key];
    saveInputs();
    paintField(active.el, active.f);
    paintSheet();
    if (active.toolId === 'settings') return;
    computeTool();
  }

  // ================================================================ navigation
  const SCREENS = ['calc', 'tools', 'tool', 'jobs', 'job', 'settings'];

  function showScreen(name, arg) {
    closeSheet();
    $('#more').hidden = true;
    const target = name === 'tool' ? '#/t/' + arg : name === 'job' ? '#/j/' + arg : '#/' + name;
    if (location.hash !== target) { location.hash = target; return; }
    route();
  }

  function route() {
    const h = location.hash.replace(/^#\/?/, '') || 'calc';
    const [a, b] = h.split('/');
    let screen = a;
    if (a === 't' && TOOL[b]) screen = 'tool';
    else if (a === 'j' && jobById(b)) screen = 'job';
    else if (SCREENS.indexOf(a) < 0 || a === 'tool' || a === 'job') screen = 'calc';
    closeSheet();
    $('#more').hidden = true;
    SCREENS.forEach((s) => { $('#screen-' + s).hidden = s !== screen; });
    const tab = screen === 'tool' ? 'tools' : screen === 'job' ? 'jobs' : screen;
    [['calc', '#navCalc'], ['tools', '#navTools'], ['jobs', '#navJobs'], ['settings', '#navSettings']].forEach(([n, sel]) => {
      $(sel).classList.toggle('active', tab === n);
      if (tab === n) $(sel).setAttribute('aria-current', 'page'); else $(sel).removeAttribute('aria-current');
    });
    if (screen !== 'tool') curToolId = null;
    if (screen === 'calc') { renderTape(); renderCalc(); }
    if (screen === 'tools') renderTools();
    if (screen === 'tool') { renderTool(b); $('#screen-tool').scrollTop = 0; }
    if (screen === 'jobs') renderJobs();
    if (screen === 'job') { renderJob(b); $('#screen-job').scrollTop = 0; }
    if (screen === 'settings') renderSettings();
  }

  // ================================================================ events
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button, li[data-i], .row[data-v], .hero[data-v]');
    if (!t) {
      if (active && !ev.target.closest('#sheet')) closeSheet();
      return;
    }
    if (t.dataset.go) return showScreen(t.dataset.go);
    if (t.dataset.k) { buzz(); return calcKey(t.dataset.k); }
    if (t.dataset.fk) { buzz(); return fieldKeyPress(t.dataset.fk); }
    if (t.matches('#tape li[data-i]')) return useTapeEntry(+t.dataset.i);
    if (t.dataset.toolOpen) return showScreen('tool', t.dataset.toolOpen);
    if (t.dataset.jobOpen) return showScreen('job', t.dataset.jobOpen);
    if (t.classList.contains('field')) { buzz(); return openSheet(t); }
    if (t.dataset.mode) {
      modes[curToolId] = t.dataset.mode;
      store.set('modes', modes);
      closeSheet();
      return renderTool(curToolId);
    }
    if (t.dataset.choice) {
      inputs[t.dataset.choice] = t.dataset.val;
      saveInputs();
      closeSheet();
      if (t.dataset.choice.indexOf('settings.') === 0) return renderSettings();
      return renderTool(curToolId);
    }
    if (t.dataset.act === 'job') return addHeroToJob();
    if (t.dataset.act === 'tape' || t.matches('.row[data-v], .hero[data-v]')) {
      const el = t.dataset.act === 'tape' ? t.closest('.hero[data-v]') : t;
      if (!el) return;
      const row = curRows[+el.dataset.i];
      addToTape(TOOL[curToolId].title + ' · ' + row.label, { v: +el.dataset.v, d: +el.dataset.d });
      buzz();
      return toast('Sent to tape');
    }
    if (t.dataset.act === 'newjob') {
      const j = askNewJob();
      if (j) showScreen('job', j.id);
      return;
    }
    if (t.dataset.remove) {
      const job = jobById(curJobId);
      if (job && confirm('Remove this item from ' + job.name + '?')) {
        job.items = job.items.filter((x) => x.id !== t.dataset.remove);
        job.updated = Date.now();
        saveJobs();
        renderJob(curJobId);
      }
      return;
    }
    if (t.id === 'jobShare' || t.id === 'jobShare2') return shareJob();
    if (t.id === 'jobRename') {
      const job = jobById(curJobId);
      const name = job && prompt('Rename job', job.name);
      if (job && name && name.trim()) { job.name = name.trim(); job.updated = Date.now(); saveJobs(); renderJob(curJobId); }
      return;
    }
    if (t.id === 'jobDelete') {
      const job = jobById(curJobId);
      if (job && confirm('Delete "' + job.name + '" and its ' + plural(job.items.length, 'item') + '?')) {
        jobs = jobs.filter((j) => j.id !== job.id);
        if (activeJob === job.id) activeJob = jobs.length ? jobs[0].id : null;
        saveJobs();
        showScreen('jobs');
      }
      return;
    }
    if (t.id === 'precLabel') {
      const list = [8, 16, 32, 64];
      const i = list.indexOf(prec());
      settings.precision = list[(i + 1) % list.length];
      saveSettings();
      renderTape();
      renderCalc();
      return toast('Precision 1/' + settings.precision + '"');
    }
    if (t.id === 'toolClear') {
      Object.keys(inputs).forEach((k) => { if (k.indexOf(curToolId + '.') === 0) delete inputs[k]; });
      saveInputs();
      return renderTool(curToolId);
    }
    if (t.id === 'clearTape2') {
      if (tape.length && confirm('Clear all ' + tape.length + ' tape entries?')) {
        tape = []; saveTape(); renderTape(); renderSettings();
      }
      return;
    }
    if (t.id === 'resetInputs') {
      if (confirm('Clear inputs in every tool?')) {
        Object.keys(inputs).forEach((k) => { if (k.indexOf('settings.') !== 0) delete inputs[k]; });
        saveInputs();
        toast('Tool inputs cleared');
      }
      return;
    }
    if (t.dataset.prec) {
      settings.precision = +t.dataset.prec; saveSettings(); return renderSettings();
    }
    if (t.dataset.themeSet) {
      settings.theme = t.dataset.themeSet; saveSettings(); applyTheme(); return renderSettings();
    }
  });

  $('#toolSearch').addEventListener('input', renderTools);

  // Hardware / desktop keyboard
  document.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.target && ev.target.tagName === 'INPUT') return;
    const k = ev.key;
    if (active) {
      const map = { Backspace: 'bs', Enter: 'next', Escape: 'done', Tab: 'next', "'": 'ft', '"': 'in', Delete: 'clr' };
      const fk = map[k] || (/^[0-9./ +-]$/.test(k) ? k : null);
      if (fk) { ev.preventDefault(); fieldKeyPress(fk); }
      return;
    }
    if ($('#screen-calc').hidden) return;
    const map = {
      Enter: '=', '=': '=', Backspace: 'bs', Escape: 'ac', Delete: 'ac', "'": 'ft', '"': 'in',
      '+': '+', '-': '−', '*': '×', x: '×', '/': '/', '(': '(', ')': ')', c: 'conv', f: 'ft', i: 'in'
    };
    const ck = map[k] || (/^[0-9.]$/.test(k) ? k : null);
    if (ck) { ev.preventDefault(); calcKey(ck); }
  });

  window.addEventListener('hashchange', route);

  // ================================================================ boot
  applyTheme();
  route();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache unavailable */ });
    });
  }
})();
