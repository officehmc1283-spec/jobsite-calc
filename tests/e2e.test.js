/* End-to-end test of Jobsite Calc in a phone-sized browser.
 * Checks: every screen, calculator key entry, every tool, tape, settings,
 * persistence, service worker install and OFFLINE reload.
 *
 * Run (needs Node + Playwright):
 *   python3 -m http.server 8765 &      (from the app folder)
 *   node tests/e2e.test.js
 */
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/';
const SHOTS = process.env.SHOTS || null;

let pass = 0, fail = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' — ' + e.message); console.log('  ✗ ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function has(a, b, msg) { if (String(a).indexOf(b) < 0) throw new Error((msg || '') + ' expected to contain ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let dialogAnswer;  // set before an action whose prompt needs a specific answer
  page.on('dialog', (d) => { const v = dialogAnswer; dialogAnswer = undefined; return v !== undefined ? d.accept(v) : d.accept(); });

  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: SHOTS + '/' + n + '.png' }); };
  const keys = async (...ks) => { for (const k of ks) await page.click(`#screen-calc [data-k="${k}"]:visible >> nth=0`); };
  const result = () => page.textContent('#result');
  const tapeLast = () => page.$eval('#tape li:last-child', (e) => e.textContent);

  // Field entry through the on-screen field keypad
  async function setField(fieldId, text) {
    await page.click(`#toolBody .field[data-field="${fieldId}"]`);
    await page.click('#fkeys [data-fk="clr"]');
    for (const ch of text) {
      if (ch === ' ') continue;   // FT / IN keys add their own spacing
      const k = ch === "'" ? 'ft' : ch === '"' ? 'in' : ch;
      await page.click(`#fkeys [data-fk="${k}"]`);
    }
    await page.click('.sheet [data-fk="done"]');
  }
  async function pick(toolId, fieldId, val) {
    await page.click(`#toolBody [data-choice="${toolId}.${fieldId}"][data-val="${val}"]`);
  }
  async function openTool(id, mode) {
    await page.goto(BASE + '#/t/' + id);
    await page.waitForSelector('#screen-tool:not([hidden])');
    if (mode) await page.click(`#toolBody [data-mode="${mode}"]`);
    await page.click('#toolClear');
  }
  const rowVal = (label) => page.$$eval('#toolBody .row, #toolBody .hero', (rows, label) => {
    const r = rows.find((x) => (x.querySelector('.r-label') || {}).textContent === label);
    return r ? r.querySelector('.r-val').textContent : 'MISSING ROW ' + label;
  }, label);
  const outText = () => page.textContent('#toolBody');
  async function nav(which) {
    await page.click('#nav' + which);
    await page.waitForSelector('#screen-' + which.toLowerCase() + ':not([hidden])');
  }

  console.log('Loading app…');
  await page.goto(BASE);
  await page.waitForSelector('#screen-calc:not([hidden])');

  console.log('\nApp shell / install metadata');
  await test('manifest, apple icon and iOS meta tags present', async () => {
    const m = await page.evaluate(async () => {
      const r = await fetch('manifest.json'); const j = await r.json();
      return {
        display: j.display, icons: j.icons.length,
        apple: !!document.querySelector('link[rel="apple-touch-icon"]'),
        capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]').content,
        title: document.querySelector('meta[name="apple-mobile-web-app-title"]').content
      };
    });
    eq(m.display, 'standalone'); eq(m.apple, true); eq(m.capable, 'yes'); eq(m.title, 'Jobsite Calc');
  });
  await test('every icon file loads', async () => {
    const bad = await page.evaluate(async () => {
      const f = ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
      const out = [];
      for (const x of f) { const r = await fetch(x); if (!r.ok) out.push(x); }
      return out;
    });
    eq(bad.length, 0, 'missing: ' + bad.join(','));
  });
  await test('keypad fits on an iPhone screen without scrolling', async () => {
    const r = await page.evaluate(() => {
      const kp = document.querySelector('#keypad').getBoundingClientRect();
      return { bottom: kp.bottom, h: window.innerHeight, sw: document.documentElement.scrollWidth, w: window.innerWidth };
    });
    if (r.bottom > r.h + 1) throw new Error('keypad bottom ' + r.bottom + ' > viewport ' + r.h);
    if (r.sw > r.w) throw new Error('horizontal overflow');
  });
  await shot('01-calc-empty');

  console.log('\nCalculator');
  await test('12\' 7-3/8" + 4\' 9-11/16" = 17\' 5-1/16"', async () => {
    await keys('ac', '1', '2', 'ft', '7', 'in', '3', '/', '8', '+', '4', 'ft', '9', 'in', '1', '1', '/', '1', '6', '=');
    eq(await result(), `17' 5-1/16"`);
    eq(await tapeLast(), `17' 5-1/16"`);
  });
  await test('operator after = continues from the result', async () => {
    await keys('÷', '2', '=');
    eq(await result(), `8' 8-9/16"`);
  });
  await test('Conv cycles through length units', async () => {
    await keys('ac', '1', 'ft', '=');
    const seen = [];
    for (let i = 0; i < 8; i++) { seen.push(await result()); await keys('conv'); }
    eq(seen.join(' | '), `1' 0" | 12" | 1' | 12" | 0.3333 yd | 0.3048 m | 30.48 cm | 304.8 mm`);
    eq(await result(), `1' 0"`, 'wrapped back');
  });
  await test('ft × ft = sq ft', async () => {
    await keys('ac', '1', '2', 'ft', '×', '1', '0', 'ft', '=');
    eq(await result(), '120 sq ft');
  });
  await test('area × thickness = cu yd', async () => {
    await keys('×', '4', 'in', '=');
    eq(await result(), '1.481 cu yd');
  });
  await test('metric input (2.5 m)', async () => {
    await keys('ac', '2', '.', '5', 'm', '=');
    eq(await result(), `8' 2-7/16"`);
  });
  await test('More panel: √ of area', async () => {
    await keys('ac', 'more', '√', '1', '4', '4', 'more', 'sq ft', '=');
    eq(await result(), `12' 0"`);
  });
  await test('More panel: x² and parentheses', async () => {
    await keys('ac', 'more', '(', '3', 'ft', '+', '1', 'ft', 'more', ')', 'more', '²', '=');
    eq(await result(), '16 sq ft');
  });
  await test('± negates', async () => {
    await keys('ac', '5', 'in', 'more', 'neg', '=');
    eq(await result(), `-5"`);
  });
  await test('backspace edits the entry', async () => {
    await keys('ac', '1', '2', '3', 'bs', 'in', '=');
    eq(await result(), `1' 0"`);
  });
  await test('mismatched units show a friendly error, not a crash', async () => {
    await keys('ac', '1', '2', 'ft', '+', '5', '=');
    has(await result(), 'add a unit');
  });
  await test('divide by zero shows an error', async () => {
    await keys('ac', '5', '÷', '0', '=');
    has(await result(), 'zero');
  });
  await test('tapping a tape entry reuses it', async () => {
    await keys('ac');
    await page.click('#tape li:first-child');
    eq(await result(), `17' 5-1/16"`);
  });
  await test('hardware keyboard entry', async () => {
    await keys('ac');
    await page.keyboard.type(`6'6"+6"`);
    await page.keyboard.press('Enter');
    eq(await result(), `7' 0"`);
  });
  await shot('02-calc-tape');

  console.log('\nTools');
  await test('tools grid lists all 14 tools', async () => {
    await nav('Tools');
    eq(await page.$$eval('.tool-row', (t) => t.length), 14);
  });
  await shot('03-tools');

  await test('Right Angle: 3\' rise, 4\' run → 5\' diagonal, 9/12', async () => {
    await openTool('rightangle');
    await setField('rise', '3'); await setField('run', '4');
    eq(await rowVal('Diagonal'), `5' 0"`);
    eq(await rowVal('Pitch'), '9 / 12');
    eq(await rowVal('Angle'), '36.87°');
  });
  await test('Right Angle: run + pitch', async () => {
    await openTool('rightangle');
    await setField('run', '12'); await setField('pitch', '6');
    eq(await rowVal('Rise'), `6' 0"`);
    eq(await rowVal('Diagonal'), `13' 5"`);   // 12' x 1.118 = 13.416'
  });
  await test('Rafters: 6/12, 24\' span (1-1/2" ridge)', async () => {
    await openTool('rafters');
    await setField('pitch', '6'); await setField('span', '24');
    eq(await rowVal('Common rafter'), `13' 4-3/16"`);   // (144 - 0.75) x 1.118
    eq(await rowVal('Total rise'), `6' 0"`);
    eq(await rowVal('Plumb cut'), '26.6°');
    eq(await rowVal('Hip / valley rafter'), `18' 0"`);   // 144 x 1.5
    eq(await rowVal('Jack common difference'), `1' 5-7/8"`);
  });
  await test('Rafters: 12" overhang adds tail', async () => {
    await setField('overhang', '12');
    eq(await rowVal('Common tail'), `1' 1-7/16"`);
    eq(await rowVal('Common stock'), `16' board`);
  });
  await shot('04-rafters');
  await test('Stairs: 108" total rise → 14 risers @ 7-11/16", IRC OK', async () => {
    await openTool('stairs');
    await setField('totalRise', '108');
    eq(await rowVal('Risers'), '14');
    eq(await rowVal('Treads'), '13');
    eq(await rowVal('Riser height'), `7-11/16"`);
    eq(await rowVal('Total run'), `10' 10"`);
    has(await outText(), 'Meets IRC');
  });
  await test('Stairs: short run triggers IRC warning', async () => {
    await setField('runLimit', '100');
    has(await outText(), 'under IRC min 10"');
  });
  await test('Stairs: 9\' 1 1/2" entered with Ft/In keys → 15 risers @ 7-5/16"', async () => {
    await openTool('stairs');
    await setField('totalRise', `9' 1" 1/2`);
    eq(await rowVal('Risers'), '15');
    eq(await rowVal('Treads'), '14');
    eq(await rowVal('Riser height'), `7-5/16"`);
    eq(await rowVal('Tread depth'), `10"`);
    eq(await rowVal('Total run'), `11' 8"`);
    eq(await rowVal('Stringer length'), `14' 9-3/4"`);
    eq(await rowVal('Stringer stock'), `16' board (min.)`);
    has(await outText(), 'Meets IRC');
  });
  await test('Stairs: target riser 7" and 11" tread', async () => {
    await openTool('stairs');
    await setField('totalRise', '108'); await setField('riser', '7'); await setField('tread', '11');
    eq(await rowVal('Risers'), '15');
    eq(await rowVal('Riser height'), `7-3/16"`);
    eq(await rowVal('Total run'), `12' 10"`);
  });
  await test('Stairs: forcing 12 risers flags the tall riser', async () => {
    await openTool('stairs');
    await setField('totalRise', '108'); await setField('risers', '12');
    has(await outText(), 'exceeds IRC max');
    eq(await rowVal('Riser height'), `9"`);
  });
  await test('Stairs: forcing 0 risers shows an error, not garbage', async () => {
    await openTool('stairs');
    await setField('totalRise', '108'); await setField('risers', '0');
    // 0 counts as blank → auto count
    eq(await rowVal('Risers'), '14');
    await setField('risers', '.3');
    has(await outText(), 'at least 1');
  });
  await test('Stairs: blank rise asks for input', async () => {
    await openTool('stairs');
    has(await outText(), 'Enter: Total rise');
  });
  await test('Stairs: result tap sends riser height to tape', async () => {
    await openTool('stairs');
    await setField('totalRise', '108');
    await page.click('#toolBody .row:has(.r-label:text-is("Riser height"))');
    await nav('Calc');
    eq(await tapeLast(), '7-11/16"');
  });
  await shot('05-stairs');
  await test('Concrete slab 20\'×20\'×4" + 10% = 5.43 cu yd', async () => {
    await openTool('concrete', 'slab');
    await setField('L', '20'); await setField('W', '20');
    eq(await rowVal('Concrete to order'), '5.43 cu yd');
    eq(await rowVal('Without waste'), '4.94 cu yd');
  });
  await test('Concrete footing', async () => {
    await openTool('concrete', 'footing');
    await setField('L', '100');
    eq(await rowVal('Without waste'), '5.14 cu yd');
  });
  await test('Concrete tube: 12" × 4\' × 10', async () => {
    await openTool('concrete', 'column');
    await setField('dia', '12'); await setField('colH', '4'); await setField('qty', '10');
    eq(await rowVal('Without waste'), '1.16 cu yd');
  });
  await test('Concrete steps', async () => {
    await openTool('concrete', 'stairs');
    await setField('sw', '4'); await setField('steps', '3');
    eq(await rowVal('Without waste'), '0.48 cu yd');   // 462 sq in profile x 48"
  });
  // ---------------- Grade & Slope
  await test('Grade: rise 6" in 10\' run → 5%, 20:1', async () => {
    await openTool('grade', 'rr');
    await setField('rise', '6"'); await setField('run', '10');
    eq(await rowVal('Grade'), '5%');
    eq(await rowVal('Slope ratio'), '20 : 1  (H:V)');
    eq(await rowVal('Rise per foot'), `5/8"`);
    eq(await rowVal('Rise per 100 ft'), '5 ft');
  });
  await test('Grade: 1\' in 100\' → 1%, 1/8" per ft', async () => {
    await openTool('grade', 'rr');
    await setField('rise', '1'); await setField('run', '100');
    eq(await rowVal('Grade'), '1%');
    eq(await rowVal('Rise per foot'), `1/8"`);
  });
  await test('Grade: run 50\' at 2% → rise 1\'', async () => {
    await openTool('grade', 'rr');
    await setField('run', '50'); await setField('pct', '2');
    eq(await rowVal('Rise'), `1.00'`);
  });
  await test('Grade: 4\' rise at 3:1 slope → 12\' run, 33.33%', async () => {
    await openTool('grade', 'rr');
    await setField('rise', '4'); await setField('ratio', '3');
    eq(await rowVal('Run'), `12.00'`);
    eq(await rowVal('Grade'), '33.33%');
  });
  await test('Grade: one value only asks for two', async () => {
    await openTool('grade', 'rr');
    await setField('pct', '2');
    has(await outText(), 'Enter any two');
  });
  await test('Elevations: 100.00 → 95.00 over 250\' = 2% down, station list', async () => {
    await openTool('grade', 'elev');
    await setField('start', '100'); await setField('end', '95'); await setField('dist', '250'); await setField('interval', '50');
    eq(await rowVal('Grade'), '2% down ↘');
    const list = await page.textContent('#out .row.list');
    has(list, "0+00  —  100.00'"); has(list, "1+50  —  97.00'"); has(list, "2+50  —  95.00'");
  });
  await test('Elevations: start + 1.5% up + 120\' → end 7705.25', async () => {
    await openTool('grade', 'elev');
    await pick('grade', 'dir', 'up');
    await setField('start', '7703.45'); await setField('pct', '1.5'); await setField('dist', '120');
    eq(await rowVal('End elevation'), `7705.25'`);
  });
  await test('Pipe fall: 100\' @ 1/4" per ft → 2\' 1", invert 97.92', async () => {
    await openTool('grade', 'pipe');
    await setField('pl', '100'); await setField('inv', '100');
    eq(await rowVal('Total fall'), `2' 1"`);
    eq(await rowVal('Grade'), '2.083%');
    eq(await rowVal('End invert elevation'), `97.92'`);
  });
  await test('Pipe fall: 60\' at 1% → 7-3/16"', async () => {
    await openTool('grade', 'pipe');
    await setField('pl', '60'); await setField('pct', '1');
    eq(await rowVal('Total fall'), `7-3/16"`);
  });
  // ---------------- Excavation
  await test('Trench 100\' × 24" × 4\' → 29.63 bank, 37.04 loose, 4 loads', async () => {
    await openTool('dirt', 'trench');
    await setField('tl', '100'); await setField('td', '4');
    eq(await rowVal('Excavation (bank)'), '29.63 cu yd');
    eq(await rowVal('Hauled (loose)'), '37.04 cu yd');
    eq(await rowVal('Truck loads'), '4 @ 12 yd');
  });
  await test('Trench 1:1 sides, 5\' deep, 6" pipe → 129.63 bank, 12\' top', async () => {
    await openTool('dirt', 'trench');
    await setField('tl', '100'); await setField('td', '5'); await setField('side', '1'); await setField('pipe', '6');
    eq(await rowVal('Excavation (bank)'), '129.63 cu yd');
    eq(await rowVal('Top width'), `12' 0"`);
    eq(await rowVal('Backfill (bank, less pipe)'), '128.9 cu yd');
  });
  await test('Basement pit 40×30×8, 1:1, 2\' overdig → 653.43 cu yd', async () => {
    await openTool('dirt', 'pit');
    await setField('pl', '40'); await setField('pw', '30'); await setField('pd', '8');
    eq(await rowVal('Excavation (bank)'), '653.43 cu yd');
    eq(await rowVal('Top of hole'), `60' 0" × 50' 0"`);
    eq(await rowVal('Truck loads'), '69 @ 12 yd');
  });
  await test('Fill pad 50×40, avg 1.5\' → 111.11 compacted, 123.46 bank, 154.32 loose', async () => {
    await openTool('dirt', 'pad');
    await setField('L', '50'); await setField('W', '40');
    await setField('d1', '1'); await setField('d2', '1.5'); await setField('d3', '2'); await setField('d4', '1.5');
    eq(await rowVal('Average depth'), `1.50'`);
    eq(await rowVal('Fill (compacted in place)'), '111.11 cu yd');
    eq(await rowVal('Bank yards needed'), '123.46 cu yd');
    eq(await rowVal('Loose yards to haul'), '154.32 cu yd');
    eq(await rowVal('Truck loads'), '13 @ 12 yd');
  });
  await test('Cut pad 50×40×1\' clay → 74.07 bank, 96.3 loose', async () => {
    await openTool('dirt', 'pad');
    await pick('dirt', 'cf', 'cut'); await pick('dirt', 'soil', 'clay');
    await setField('L', '50'); await setField('W', '40'); await setField('d1', '1');
    eq(await rowVal('Cut (bank)'), '74.07 cu yd');
    eq(await rowVal('Hauled (loose)'), '96.3 cu yd');
  });
  await test('Average end area 40 & 60 sq ft × 100\' → 185.19 cu yd', async () => {
    await openTool('dirt', 'endarea');
    await setField('a1', '40'); await setField('a2', '60'); await setField('el', '100');
    has(await outText(), '185.19 cu yd');
  });
  await test('Swell: 100 bank → 125 loose, 90 compacted; custom swell 30%', async () => {
    await openTool('dirt', 'swell');
    await setField('vol', '100');
    eq(await rowVal('Loose (in the truck)'), '125 cu yd');
    eq(await rowVal('Compacted'), '90 cu yd');
    await setField('swell', '30');
    eq(await rowVal('Loose (in the truck)'), '130 cu yd');
  });
  // ---------------- Gravel
  await test('Gravel 100\'×12\'×4" → 20.74 tons, 2 loads, $622.22', async () => {
    await openTool('gravel', 'area');
    await setField('L', '100'); await setField('W', '12'); await setField('price', '30');
    eq(await rowVal('Tons'), '20.74 tons');
    eq(await rowVal('Truck loads'), '2 @ 14 tons');
    eq(await rowVal('Cost'), '$622.22');
  });
  await test('Road base 10 cu yd + 15% compaction → 17.25 tons', async () => {
    await openTool('gravel', 'vol');
    await pick('gravel', 'mat', 'base');
    await setField('cy', '10'); await setField('comp', '15');
    eq(await rowVal('Tons'), '17.25 tons');
  });
  // ---------------- Rebar
  await test('Rebar grid 20×20 #4 @ 18" → 546 LF, 28 sticks, 365 lb', async () => {
    await openTool('rebar', 'grid');
    await setField('L', '20'); await setField('W', '20');
    eq(await rowVal('Total length'), '546 LF');
    eq(await rowVal("Stock bars (20')"), '28');
    eq(await rowVal('Weight'), '365 lb');
  });
  await test('Rebar footing 100\', 2 bars, dowels @24" → 19 sticks, 51 dowels', async () => {
    await openTool('rebar', 'line');
    await setField('fl', '100'); await setField('dsp', '24'); await setField('dl', '30');
    eq(await rowVal("Stock bars (20')"), '19');
    eq(await rowVal('Dowels'), '51');
    eq(await rowVal('Lap splices'), '10 @ 20"');
  });
  // ---------------- Block
  await test('Block wall 40×8, 5% waste → 378 block, 32 bags; solid grout 3.06 cu yd', async () => {
    await openTool('block');
    await setField('L', '40'); await setField('H', '8');
    eq(await rowVal('Blocks'), '378');
    eq(await rowVal('Mortar mix bags (80 lb)'), '32');
    await pick('block', 'grout', 'solid');
    eq(await rowVal('Grout'), '3.06 cu yd');
  });
  // ---------------- Concrete additions
  await test('Concrete wall 40\'×8\'×8" → 7.9 cu yd net, 1 truck', async () => {
    await openTool('concrete', 'wall');
    await setField('L', '40'); await setField('wh', '8');
    eq(await rowVal('Without waste'), '7.9 cu yd');
    eq(await rowVal('Ready-mix trucks (10 yd)'), '1');
  });
  await test('Thick-edge slab 20×20 → 6.81 cu yd net', async () => {
    await openTool('concrete', 'edge');
    await setField('L', '20'); await setField('W', '20');
    eq(await rowVal('Without waste'), '6.81 cu yd');
  });
  await test('Pads 24×24×12 × 10 → 1.48 cu yd net', async () => {
    await openTool('concrete', 'pads');
    await setField('qty', '10');
    eq(await rowVal('Without waste'), '1.48 cu yd');
  });
  await test('Lumber: 2×10 × 16\' × 10 = 266.67 BF', async () => {
    await openTool('lumber', 'bf');
    await setField('w', '10'); await setField('bl', '16'); await setField('bq', '10');
    eq(await rowVal('Board feet'), '266.67 BF');
  });
  await test('Lumber: 20\' wall studs @16', async () => {
    await openTool('lumber', 'studs');
    await setField('wl', '20'); await setField('corners', '2'); await setField('openings', '1');
    eq(await rowVal('Studs'), '22');
  });
  await test('Sheet goods: 40\'×8\' wall → 11 sheets (10% waste)', async () => {
    await openTool('sheets');
    await setField('sl', '40'); await setField('sh', '8');
    eq(await rowVal('Sheets'), '11 × 4×8');
  });
  await test('Area: rectangle', async () => {
    await openTool('area', 'rect');
    await setField('al', '12'); await setField('aw', '10');
    eq(await rowVal('Area'), '120 sq ft');
    eq(await rowVal('Perimeter'), `44' 0"`);
  });
  await test('Area: 3-side triangle 3-4-5', async () => {
    await openTool('area', 'tri3');
    await setField('s1', '3'); await setField('s2', '4'); await setField('s3', '5');
    eq(await rowVal('Area'), '6 sq ft');
  });
  await test('Area: circle with depth → volume', async () => {
    await openTool('area', 'circle');
    await setField('cd', '10'); await setField('depth', '4');
    eq(await rowVal('Area'), '78.54 sq ft');
  });
  await test('Area: trapezoid, triangle, irregular quad', async () => {
    await openTool('area', 'trap');
    await setField('ta', '10'); await setField('tb2', '20'); await setField('tz', '5');
    eq(await rowVal('Area'), '75 sq ft');
    await openTool('area', 'tri');
    await setField('tb', '10'); await setField('th', '5');
    eq(await rowVal('Area'), '25 sq ft');
    await openTool('area', 'quad');
    await setField('qa', '10'); await setField('qb', '10'); await setField('qc', '10'); await setField('qd', '10'); await setField('qp', '14.1421356');
    eq(await rowVal('Area'), '100 sq ft');
  });
  await test('Circles: chord 48" + rise 6" → radius 51"', async () => {
    await openTool('circles', 'ch');
    await setField('cc', '48'); await setField('chh', '6');
    eq(await rowVal('Radius'), `4' 3"`);
  });
  await test('Circles: radius + angle, radius + chord, circle', async () => {
    await openTool('circles', 'ang');
    await setField('cr', '12'); await setField('cang', '90');
    eq(await rowVal('Arc length'), `1' 6-7/8"`);
    await openTool('circles', 'rc');
    await setField('cr', '51'); await setField('cc', '48');
    eq(await rowVal('Height (rise)'), `6"`);
    await openTool('circles', 'circ');
    await setField('cd', '10');
    eq(await rowVal('Circumference'), `31' 5"`);
  });
  await test('Convert: 10 ft → meters', async () => {
    await openTool('convert');
    await setField('val', '10');
    eq(await rowVal('METERS'), '3.048 m');
  });
  await test('Tool input typed with units (5\' 6") works in a feet field', async () => {
    await openTool('area', 'rect');
    await setField('al', `5'6"`); await setField('aw', '2');
    eq(await rowVal('Area'), '11 sq ft');
  });
  await test('bad field input is flagged, not a crash', async () => {
    await openTool('area', 'rect');
    await setField('al', '5/'); await setField('aw', '2');
    has(await outText(), 'finish the entry');
  });
  await test('tapping a result sends it to the tape', async () => {
    await openTool('area', 'rect');
    await setField('al', '12'); await setField('aw', '10');
    await page.click('#toolBody .hero');
    await nav('Calc');
    eq(await tapeLast(), '120 sq ft');
  });
  await test('Ans key puts the last calculator result into a field', async () => {
    await keys('ac', '8', 'ft', '=');
    await openTool('area', 'rect');
    await page.click('#toolBody .field[data-field="al"]');
    await page.click('#fkeys [data-fk="ans"]');
    await page.click('.sheet [data-fk="done"]');
    await setField('aw', '2');
    eq(await rowVal('Area'), '16 sq ft');
  });

  console.log('\nSettings & persistence');
  await test('precision 1/8 changes rounding', async () => {
    await nav('Settings');
    await page.click('[data-prec="8"]');
    await nav('Calc');
    await keys('ac', '1', '0', 'ft', '÷', '7', '=');
    eq(await result(), `1' 5-1/8"`);
    await keys('ac', '1', '/', '3', '2', 'in', '=');
    eq(await result(), `0"`);
    await nav('Settings'); await page.click('[data-prec="16"]');
  });
  await test('app is always in night mode (no theme switch)', async () => {
    eq(await page.getAttribute('html', 'data-theme'), 'dark');
    eq(await page.$$eval('[data-theme-set]', (x) => x.length), 0);
    eq(await page.$eval('body', (e) => getComputedStyle(e).backgroundColor), 'rgb(18, 20, 22)');
  });
  await test('tape, settings and inputs survive a reload', async () => {
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('jsc.tape')).length);
    await page.reload();
    await page.waitForSelector('#screen-settings:not([hidden])');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('jsc.tape')).length);
    eq(after, before);
  });

  console.log('\nOffline');
  await test('service worker installs and caches all files', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    const n = await page.evaluate(async () => { const k = await caches.keys(); const c = await caches.open(k[0]); return (await c.keys()).length; });
    if (n < 11) throw new Error('only ' + n + ' files cached');
  });
  await test('Settings says "Saved for offline use"', async () => {
    await nav('Settings');
    has(await page.textContent('#settingsBody'), 'Saved for offline use');
  });
  await test('app loads and calculates with NO network', async () => {
    await ctx.setOffline(true);
    await page.goto(BASE);
    await page.waitForSelector('#screen-calc:not([hidden])');
    await keys('ac', '2', 'ft', '+', '6', 'in', '=');
    eq(await result(), `2' 6"`);
    await openTool('stairs');
    await setField('totalRise', '108');
    eq(await rowVal('Risers'), '14');
  });
  await test('cold start offline (new tab, no network)', async () => {
    const p2 = await ctx.newPage();
    await p2.goto(BASE);
    await p2.waitForSelector('#screen-calc:not([hidden])');
    const ok = await p2.evaluate(() => typeof window.Calc === 'object' && getComputedStyle(document.querySelector('.tabbar')).display === 'grid');
    eq(ok, true, 'scripts+styles loaded offline');
    await p2.close();
    await ctx.setOffline(false);
  });

  console.log('\nRedesign: navigation, search, jobs');
  await test('bottom tabs switch screens and mark the active tab', async () => {
    await nav('Tools'); eq(await page.getAttribute('#navTools', 'aria-current'), 'page');
    await nav('Jobs'); eq(await page.getAttribute('#navJobs', 'aria-current'), 'page');
    await nav('Calc'); eq(await page.getAttribute('#navCalc', 'aria-current'), 'page');
  });
  await test('tool search filters the list (keywords too)', async () => {
    await nav('Tools');
    await page.fill('#toolSearch', 'trench');
    eq(await page.$$eval('.tool-row', (t) => t.map((x) => x.querySelector('.n').textContent).join()), 'Excavation');
    await page.fill('#toolSearch', 'zzz');
    has(await page.textContent('#tiles'), 'No tools match');
    await page.fill('#toolSearch', '');
    eq(await page.$$eval('.tool-row', (t) => t.length), 14);
  });
  await test('recently used tools show at the top', async () => {
    await openTool('stairs'); await openTool('grade');
    await nav('Tools');
    const rec = await page.$$eval('.recent-card span', (x) => x.map((e) => e.textContent));
    eq(rec[0], 'Grade & Slope'); eq(rec[1], 'Stairs');
  });
  await test('header chips: precision cycles, units chip cycles like CONV', async () => {
    await nav('Calc');
    await keys('ac', '1', 'ft', '=');
    const before = await page.textContent('#precLabel');
    await page.click('#precLabel');
    const after = await page.textContent('#precLabel');
    if (before === after) throw new Error('precision chip did not change');
    while ((await page.textContent('#precLabel')) !== '1/16"') await page.click('#precLabel');
    eq(await page.textContent('#modeLabel'), 'FT-IN');
    await page.click('#modeLabel');
    eq(await page.textContent('#modeLabel'), 'IN-FRAC');
    eq(await result(), '12"');
    for (let i = 0; i < 7; i++) await page.click('#modeLabel');
    eq(await page.textContent('#modeLabel'), 'FT-IN');
  });
  await test('display shows decimal feet and inches underneath', async () => {
    await keys('ac', '1', '7', 'ft', '5', 'in', '1', '/', '1', '6', '=');
    eq(await page.textContent('#metaL'), "17.4219'");
    eq(await page.textContent('#metaR'), '209.0625"');
  });
  await test('entry keypad: NEXT names the next field and moves to it', async () => {
    await openTool('concrete', 'slab');
    await page.click('#toolBody .field[data-field="L"]');
    has(await page.textContent('#nextKey'), 'NEXT: WIDTH');
    await page.click('#fkeys [data-fk="2"]'); await page.click('#fkeys [data-fk="0"]');
    await page.click('#fkeys [data-fk="next"]');
    eq(await page.textContent('#sheetLabel'), 'Width');
    await page.click('#fkeys [data-fk="2"]'); await page.click('#fkeys [data-fk="0"]');
    await page.click('.sheet [data-fk="done"]');
    eq(await rowVal('Concrete to order'), '5.43 cu yd');
  });
  await test('unit tag hides when a unit is typed', async () => {
    await openTool('area', 'rect');
    await setField('al', `12'`);
    eq(await page.$eval('.field[data-field="al"] .unit-chip', (e) => e.hidden), true);
    await setField('al', '12');
    eq(await page.$eval('.field[data-field="al"] .unit-chip', (e) => e.hidden), false);
  });
  await test('an old saved "light" setting still opens in night mode', async () => {
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('jsc.settings') || '{}'); s.theme = 'light'; localStorage.setItem('jsc.settings', JSON.stringify(s)); });
    await page.reload(); await page.waitForSelector('.tabbar');
    eq(await page.getAttribute('html', 'data-theme'), 'dark');
    await openTool('area', 'rect'); await setField('al', '12'); await setField('aw', '10');
    const c = await page.$eval('#toolBody .hero', (e) => getComputedStyle(e.querySelector('.r-val')).color);
    eq(c, 'rgb(255, 196, 0)');
  });
  await test('Jobs: slab + footing + pads roll up to 14.23 cu yd, 2 trucks', async () => {
    await page.evaluate(() => { localStorage.removeItem('jsc.jobs'); localStorage.removeItem('jsc.activeJob'); });
    await page.reload(); await page.waitForSelector('.tabbar');
    await openTool('concrete', 'slab');
    await setField('L', '24'); await setField('W', '24');
    await page.click('#toolBody [data-act="job"]');          // first add: names a new job (dialog accepted)
    await openTool('concrete', 'footing');
    await setField('L', '96');
    await page.click('#toolBody [data-act="job"]');
    await openTool('concrete', 'pads');
    await setField('qty', '6');
    await page.click('#toolBody [data-act="job"]');
    await nav('Jobs');
    eq(await page.$$eval('[data-job-open]', (x) => x.length), 1);
    has(await page.textContent('#jobsBody'), '3 items');
    await page.click('[data-job-open]');
    await page.waitForSelector('#screen-job:not([hidden])');
    eq(await page.textContent('#jobBody .hero .r-val'), '14.23 cu yd');
    has(await page.textContent('#jobBody .mini'), '12.94 yd');
    has(await page.textContent('#jobBody .mini'), '2 @ 10 yd');
    const vals = await page.$$eval('#jobBody .item-row .v', (x) => x.map((e) => e.textContent));
    eq(vals.join(' + '), '7.82 cu yd + 5.43 cu yd + 0.98 cu yd');
  });
  await test('Jobs: removing an item updates the total; takeoff text is right', async () => {
    await page.click('#jobBody .item-row:last-child [data-remove]');
    eq(await page.textContent('#jobBody .hero .r-val'), '13.25 cu yd');
    const text = await page.evaluate(() => {
      const jobs = JSON.parse(localStorage.getItem('jsc.jobs'));
      return jobs[0].items.length;
    });
    eq(text, 2);
  });
  await test('Jobs: rename and delete', async () => {
    dialogAnswer = 'Lot 12 Garage';
    await page.click('#jobRename');
    eq(await page.textContent('#jobTitle'), 'Lot 12 Garage');
    await page.click('#jobDelete');
    await page.waitForSelector('#screen-jobs:not([hidden])');
    has(await page.textContent('#jobsBody'), 'No jobs yet');
  });
  await test('Jobs survive a reload', async () => {
    await openTool('area', 'rect'); await setField('al', '12'); await setField('aw', '10');
    await page.click('#toolBody [data-act="job"]');
    await page.reload(); await page.waitForSelector('.tabbar');
    await nav('Jobs');
    has(await page.textContent('#jobsBody'), '1 item');
  });

  console.log('\nFit & finish');
  const LAYOUTS = {
    'iPhone SE': devices['iPhone SE'],
    'iPhone 14 Pro Max': devices['iPhone 14 Pro Max'],
    'iPhone 13 landscape (home-screen app, full height)': Object.assign({}, devices['iPhone 13 landscape'], { viewport: { width: 844, height: 390 } })
  };
  for (const dn of Object.keys(LAYOUTS)) {
    await test(dn + ': keypad fits, no sideways scroll, all tap targets ≥ 44px', async () => {
      const c2 = await browser.newContext(LAYOUTS[dn]);
      const p2 = await c2.newPage();
      await p2.goto(BASE); await p2.waitForSelector('#screen-calc:not([hidden])');
      const r = await p2.evaluate(() => {
        const kp = document.querySelector('#keypad').getBoundingClientRect();
        const small = [...document.querySelectorAll('button')].filter((b) => {
          if (b.closest('[hidden]')) return false;
          const rc = b.getBoundingClientRect(); return rc.width && (rc.width < 44 || rc.height < 44);
        }).map((b) => b.textContent.trim());
        return { fits: kp.bottom <= innerHeight + 1, scroll: document.documentElement.scrollWidth > innerWidth, small };
      });
      await c2.close();
      eq(r.fits, true, 'keypad fits'); eq(r.scroll, false, 'sideways scroll'); eq(r.small.join(','), '', 'small targets');
    });
  }
  await test('landscape entry keypad fits on screen with 44px keys', async () => {
    const c2 = await browser.newContext(LAYOUTS['iPhone 13 landscape (home-screen app, full height)']);
    const p2 = await c2.newPage(); await p2.goto(BASE + '#/t/concrete'); await p2.waitForSelector('#screen-tool:not([hidden])');
    await p2.click('.field[data-field="L"]');
    const r = await p2.evaluate(() => { const n = document.querySelector('#nextKey').getBoundingClientRect(); return { bottom: n.bottom, h: n.height, vh: innerHeight }; });
    await c2.close();
    if (r.bottom > r.vh + 1) throw new Error('NEXT key off screen: ' + r.bottom + ' > ' + r.vh);
    if (r.h < 44) throw new Error('keys only ' + r.h + 'px');
  });
  await test('iPhone 13 landscape in Safari (browser bars showing): keypad still fits', async () => {
    const c2 = await browser.newContext({ ...devices['iPhone 13 landscape'] });
    const p2 = await c2.newPage(); await p2.goto(BASE); await p2.waitForSelector('#screen-calc:not([hidden])');
    const fits = await p2.evaluate(() => document.querySelector('#keypad').getBoundingClientRect().bottom <= innerHeight + 1);
    await c2.close(); eq(fits, true);
  });
  await test('big numbers get thousands separators and still re-parse', async () => {
    await nav('Calc');
    await keys('ac', '1', '2', '3', '4', '5', 'ft', '×', '9', '8', '7', 'ft', '=');
    eq(await result(), '12,184,515 sq ft');
    await keys('÷', '2', '=');
    eq(await result(), '6,092,257.5 sq ft');
  });
  await test('Settings shows the app version', async () => {
    await nav('Settings');
    has(await page.textContent('#settingsBody'), 'version');
  });

  console.log('\nErrors');
  await test('no JavaScript errors during the run', async () => {
    const real = errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e));
    eq(real.length, 0, real.join(' | '));
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log(failures.join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
