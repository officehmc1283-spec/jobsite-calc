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
  page.on('dialog', (d) => d.accept());

  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: SHOTS + '/' + n + '.png' }); };
  const keys = async (...ks) => { for (const k of ks) await page.click(`#keypad [data-k="${k}"], #more [data-k="${k}"]`); };
  const result = () => page.textContent('#result');
  const tapeLast = () => page.$eval('#tape li:last-child .t-res', (e) => e.textContent);

  // Field entry through the on-screen field keypad
  async function setField(fieldId, text) {
    await page.click(`#toolBody .field[data-field="${fieldId}"]`);
    await page.click('#fkeys [data-fk="clr"]');
    for (const ch of text) {
      const k = ch === "'" ? 'ft' : ch === '"' ? 'in' : ch;
      await page.click(`#fkeys [data-fk="${k}"]`);
    }
    await page.click('.sheet [data-fk="done"]');
  }
  async function openTool(id, mode) {
    await page.goto(BASE + '#/t/' + id);
    await page.waitForSelector('#screen-tool:not([hidden])');
    if (mode) await page.click(`#toolBody [data-mode="${mode}"]`);
    await page.click('#toolClear');
  }
  const rowVal = (label) => page.$$eval('#out .row', (rows, label) => {
    const r = rows.find((x) => (x.querySelector('.r-label') || {}).textContent === label);
    return r ? r.querySelector('.r-val').textContent : 'MISSING ROW ' + label;
  }, label);
  const outText = () => page.textContent('#out');
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
    eq(await tapeLast(), `= 17' 5-1/16"`);
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
    await keys('ac', '(', '3', 'ft', '+', '1', 'ft', ')', 'more', '²', '=');
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
  await test('tools grid lists all 9 tools', async () => {
    await nav('Tools');
    eq(await page.$$eval('.tile', (t) => t.length), 9);
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
    await setField('al', '5+'); await setField('aw', '2');
    has(await outText(), 'finish the entry');
  });
  await test('tapping a result sends it to the tape', async () => {
    await openTool('area', 'rect');
    await setField('al', '12'); await setField('aw', '10');
    await page.click('#out .row.big');
    await nav('Calc');
    eq(await tapeLast(), '= 120 sq ft');
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
  await test('night theme toggles', async () => {
    await page.click('[data-theme-set="dark"]');
    eq(await page.getAttribute('html', 'data-theme'), 'dark');
  });
  await shot('06-settings-dark');
  await test('tape, settings and inputs survive a reload', async () => {
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('jsc.tape')).length);
    await page.reload();
    await page.waitForSelector('#screen-settings:not([hidden])');
    eq(await page.getAttribute('html', 'data-theme'), 'dark');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('jsc.tape')).length);
    eq(after, before);
    await page.click('[data-theme-set="light"]');
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
    const ok = await p2.evaluate(() => typeof window.Calc === 'object' && getComputedStyle(document.body).fontWeight === '600');
    eq(ok, true, 'scripts+styles loaded offline');
    await p2.close();
    await ctx.setOffline(false);
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
