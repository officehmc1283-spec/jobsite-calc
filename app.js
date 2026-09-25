/* Jobsite Calc — UI. Depends on calc.js (window.Calc). */
(function () {
  'use strict';
  const C = window.Calc;
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
  const settings = Object.assign({ precision: 16, theme: 'light', conv: { 0: 0, 1: 0, 2: 0, 3: 0 } }, store.get('settings', {}));
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
    $('meta[name="theme-color"]').setAttribute('content', settings.theme === 'dark' ? '#000000' : '#ffffff');
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
      ol.innerHTML = '<li class="empty">Results show here. Tap one to reuse it.</li>';
      return;
    }
    ol.innerHTML = tape.map((t, i) =>
      '<li data-i="' + i + '"><div class="t-expr">' + esc(t.e) + '</div><div class="t-res">= ' +
      esc(fmtVal({ v: t.v, d: t.d })) + '</div></li>').join('');
    ol.scrollTop = ol.scrollHeight;
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
    $('#modeLabel').textContent = list[(settings.conv[d] || 0) % list.length].label;
    $('#precLabel').textContent = 'PRECISION 1/' + prec() + '"';
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
      V('Concrete to order', C.withWaste(cuIn, wastePct), 'cuyd', { big: true }),
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
        id: 'main',
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
          id: 'rr', label: 'Rise + Run',
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
              N('Grade', g.pct, 2, '%', { big: true }),
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

  function placeholderOf(f) {
    const def = defaultOf(f);
    if (def != null) {
      const txt = f.kind === 'len' ? fmtLen(def * C.IN[f.unit], f.unit === 'in' ? 'in' : 'ftin') : C.fmtNum(def, 3);
      return txt + ' (default)';
    }
    return f.req ? 'tap to enter' : 'optional';
  }

  function fieldHint(f) {
    const parts = [];
    if (f.kind === 'len') parts.push('no unit = ' + (f.unit === 'ft' ? 'feet' : 'inches'));
    if (f.hint) parts.push(f.hint);
    return parts.join(' · ');
  }

  function fieldHTML(toolId, f) {
    const key = fieldKey(toolId, f);
    if (f.kind === 'choice') {
      const cur = inputs[key] || f.def;
      return '<div class="choice"><div class="choice-label">' + esc(f.label) + '</div><div class="seg">' +
        f.options.map(([val, lab]) => '<button data-choice="' + esc(key) + '" data-val="' + esc(val) + '" class="' + (val === cur ? 'on' : '') + '">' + esc(lab) + '</button>').join('') +
        '</div></div>';
    }
    const hint = fieldHint(f);
    return '<button class="field" data-key="' + esc(key) + '" data-tool="' + esc(toolId) + '" data-field="' + esc(f.id) + '">' +
      '<span><span class="f-label">' + esc(f.label) + '</span>' + (hint ? '<span class="f-hint">' + esc(hint) + '</span>' : '') + '</span>' +
      '<span class="f-val"></span></button>';
  }

  function paintField(el, f) {
    const raw = (inputs[el.dataset.key] || '').trim();
    const v = $('.f-val', el);
    if (raw) { v.textContent = raw; v.classList.remove('placeholder'); }
    else { v.textContent = placeholderOf(f); v.classList.add('placeholder'); }
  }

  let curToolId = null;

  function renderTool(id) {
    const tool = TOOL[id];
    if (!tool) return showScreen('tools');
    curToolId = id;
    const mode = currentMode(tool);
    $('#toolTitle').textContent = tool.title;
    let html = '';
    if (tool.modes.length > 1) {
      html += '<div class="seg">' + tool.modes.map((m) =>
        '<button data-mode="' + m.id + '" class="' + (m === mode ? 'on' : '') + '">' + esc(m.label) + '</button>').join('') + '</div>';
    }
    html += '<div class="fields">' + mode.fields.map((f) => fieldHTML(id, f)).join('') + '</div>';
    html += '<div class="out" id="out"></div>';
    html += '<p class="tap-note">Tap a result to send it to the calculator tape.</p>';
    const note = mode.note || tool.note;
    if (note) html += '<p class="note">' + esc(note) + '</p>';
    $('#toolBody').innerHTML = html;
    $$('.field', $('#toolBody')).forEach((el) => paintField(el, mode.fields.find((f) => f.id === el.dataset.field)));
    computeTool();
  }

  function computeTool() {
    const tool = TOOL[curToolId];
    if (!tool) return;
    const mode = currentMode(tool);
    const out = $('#out');
    const vals = {};
    const missing = [];
    let problem = null;
    mode.fields.forEach((f) => {
      const el = $('.field[data-field="' + f.id + '"]', $('#toolBody'));
      if (el) el.classList.remove('bad');
      try {
        vals[f.id] = readField(tool.id, f);
        if (vals[f.id] == null && f.req) missing.push(f.label);
      } catch (e) {
        if (el) el.classList.add('bad');
        if (!problem) problem = f.label + ': ' + (e.message === 'Incomplete entry' ? 'finish the entry' : e.message);
      }
    });
    let rows;
    try {
      if (problem) throw new Error(problem);
      if (missing.length) throw new Error('Enter: ' + missing.join(', '));
      rows = mode.compute(vals);
    } catch (e) {
      out.innerHTML = '<div class="hint-box">' + esc(e.message) + '</div>';
      out._rows = [];
      return;
    }
    out._rows = rows;
    out.innerHTML = rows.map(rowHTML).join('');
  }

  function rowHTML(r, i) {
    if (r.warn) return '<div class="row warn">' + esc(r.warn) + '</div>';
    if (r.ok) return '<div class="row ok">' + esc(r.ok) + '</div>';
    if (r.info) return '<div class="row info">' + esc(r.info) + '</div>';
    if (r.list) {
      return '<div class="row list"><div class="r-label">' + esc(r.label) + '</div>' +
        (r.list.length ? '<ol>' + r.list.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol>' : '<div class="r-sub">None at this spacing</div>') + '</div>';
    }
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
    return '<div class="row' + (r.big ? ' big' : '') + '"' + (tap ? ' data-v="' + tap.v + '" data-d="' + tap.d + '" data-i="' + i + '"' : '') + '>' +
      '<div class="r-label">' + esc(r.label) + '</div><div class="r-val">' + esc(val) + '</div>' +
      (sub ? '<div class="r-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function renderTiles() {
    $('#tiles').innerHTML = TOOLS.map((t, i) =>
      '<button class="tile" data-tool-open="' + t.id + '"><span class="num">' + (i + 1) + '</span>' +
      '<span class="name">' + esc(t.title) + '</span><span class="desc">' + esc(t.desc) + '</span></button>').join('');
  }

  // ================================================================ settings screen
  const SETTINGS_FIELDS = [
    num('concreteWaste', 'Concrete waste %', { def: 10 }),
    num('sheetWaste', 'Sheet goods waste %', { def: 10 })
  ];

  function renderSettings() {
    curToolId = null;
    const precBtns = [2, 4, 8, 16, 32, 64].map((p) =>
      '<button data-prec="' + p + '" class="' + (p === prec() ? 'on' : '') + '">1/' + p + '</button>').join('');
    const themeBtns = [['light', '☀ Sun (light)'], ['dark', '☾ Night (dark)']].map(([v, l]) =>
      '<button data-theme-set="' + v + '" class="' + (settings.theme === v ? 'on' : '') + '">' + l + '</button>').join('');
    const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
    $('#settingsBody').innerHTML =
      '<div class="set-group"><h2>Fraction precision</h2><div class="seg grid3">' + precBtns + '</div>' +
      '<p>Results round to the nearest 1/' + prec() + '". Math is done at full precision.</p></div>' +
      '<div class="set-group"><h2>Display</h2><div class="seg">' + themeBtns + '</div></div>' +
      '<div class="set-group"><h2>Default waste</h2><div class="fields">' +
      SETTINGS_FIELDS.map((f) => fieldHTML('settings', f)).join('') + '</div>' +
      '<p>Used when a tool\'s own waste % is left blank.</p></div>' +
      '<div class="set-group"><h2>Data</h2>' +
      '<button class="btn-wide" id="resetInputs">Clear all tool inputs</button>' +
      '<button class="btn-wide danger" id="clearTape2">Clear calculator tape (' + tape.length + ')</button></div>' +
      '<div class="set-group"><h2>Offline</h2><p>' + (sw ? '✓ Saved for offline use. Works with no signal.' : 'Not cached yet. Open once over https (e.g. GitHub Pages) and reload to enable offline use.') + '</p></div>';
    $$('.field', $('#settingsBody')).forEach((el) => paintField(el, SETTINGS_FIELDS.find((f) => f.id === el.dataset.field)));
  }

  // ================================================================ field keypad sheet
  let active = null; // { el, key, f }

  function fieldDef(toolId, fieldId) {
    if (toolId === 'settings') return SETTINGS_FIELDS.find((f) => f.id === fieldId);
    return currentMode(TOOL[toolId]).fields.find((f) => f.id === fieldId);
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
    // keep the field visible above the sheet
    requestAnimationFrame(() => {
      const scroller = el.closest('.screen');
      const r = el.getBoundingClientRect();
      const sheetTop = sheet.getBoundingClientRect().top;
      if (r.bottom > sheetTop - 12 || r.top < 60) scroller.scrollTop += r.top - 90;
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
    $('#sheetLabel').textContent = active.f.label + (fieldHint(active.f) ? ' — ' + fieldHint(active.f) : '');
    const raw = inputs[active.key] || '';
    $('#sheetVal').textContent = raw || ' ';
  }

  function fieldKeyPress(k) {
    if (!active) return;
    if (k === 'done') return closeSheet();
    if (k === 'next') {
      const all = $$('.field', active.el.closest('.screen'));
      const next = all[all.indexOf(active.el) + 1];
      return next ? openSheet(next) : closeSheet();
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
      s = (s && !/[\s+]$/.test(s) ? '' : s) + fmtVal(st.last);
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
  function showScreen(name, arg) {
    closeSheet();
    $('#more').hidden = true;
    const target = name === 'tool' ? '#/t/' + arg : '#/' + name;
    if (location.hash !== target) { location.hash = target; return; }
    route();
  }

  function route() {
    const h = location.hash.replace(/^#\/?/, '') || 'calc';
    const [a, b] = h.split('/');
    let screen = a;
    if (a === 't' && TOOL[b]) screen = 'tool';
    else if (['calc', 'tools', 'settings'].indexOf(a) < 0) screen = 'calc';
    closeSheet();
    ['calc', 'tools', 'tool', 'settings'].forEach((s) => { $('#screen-' + s).hidden = s !== screen; });
    $('#navCalc').classList.toggle('active', screen === 'calc');
    $('#navTools').classList.toggle('active', screen === 'tools' || screen === 'tool');
    $('#navSettings').classList.toggle('active', screen === 'settings');
    if (screen === 'calc') { renderTape(); renderCalc(); }
    if (screen === 'tools') { curToolId = null; renderTiles(); }
    if (screen === 'tool') { renderTool(b); $('#screen-tool').scrollTop = 0; }
    if (screen === 'settings') renderSettings();
  }

  // ================================================================ events
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button, li[data-i], .row[data-v]');
    if (!t) {
      if (active && !ev.target.closest('#sheet')) closeSheet();
      return;
    }
    if (t.dataset.go) return showScreen(t.dataset.go);
    if (t.dataset.k) { buzz(); return calcKey(t.dataset.k); }
    if (t.dataset.fk) { buzz(); return fieldKeyPress(t.dataset.fk); }
    if (t.matches('#tape li[data-i]')) return useTapeEntry(+t.dataset.i);
    if (t.dataset.toolOpen) return showScreen('tool', t.dataset.toolOpen);
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
      return renderTool(curToolId);
    }
    if (t.matches('.row[data-v]')) {
      const row = $('#out')._rows[+t.dataset.i];
      addToTape(TOOL[curToolId].title + ' · ' + row.label, { v: +t.dataset.v, d: +t.dataset.d });
      buzz();
      return toast('Sent to tape');
    }
    if (t.id === 'toolClear') {
      Object.keys(inputs).forEach((k) => { if (k.indexOf(curToolId + '.') === 0) delete inputs[k]; });
      saveInputs();
      return renderTool(curToolId);
    }
    if (t.id === 'clearTape' || t.id === 'clearTape2') {
      if (tape.length && confirm('Clear all ' + tape.length + ' tape entries?')) {
        tape = []; saveTape(); renderTape();
        if (t.id === 'clearTape2') renderSettings();
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

  // Hardware / desktop keyboard
  document.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
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
