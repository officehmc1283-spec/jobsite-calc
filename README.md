# Jobsite Calc

**Live app:** https://officehmc1283-spec.github.io/jobsite-calc/  (GitHub repo: github.com/officehmc1283-spec/jobsite-calc)
Scan `iphone-install-qr.png` with the iPhone camera to open it in Safari, then Share → Add to Home Screen.

An offline construction calculator (feet-inch-fraction math) that installs to your phone's home screen.
Plain HTML/CSS/JS: no frameworks, no build step, no internet needed after the first load.

## Files

| File | What it is |
|---|---|
| `index.html` | App shell |
| `styles.css` | High-contrast, glove-sized styles (Sun/Night themes) |
| `calc.js` | All the math (parser, fractions, stairs, rafters, concrete…) with no UI code |
| `app.js` | Screens, keypads, tape, settings (saved in localStorage) |
| `sw.js` | Service worker that caches every file for offline use |
| `manifest.json`, `icons/` | Home-screen install info and icons |
| `tests/` | Unit tests for `calc.js` |

## Entering measurements

* `12' 7-3/8"`: tap **12 Ft 7 In 3 / 8**. Numbers after a unit are added to it, so `12' 7" 3/8` works the same way.
* `7-3/8` (no spaces) is a mixed number. `7 − 3/8` (with spaces, or the − key) is subtraction.
* Metric works too: `2.5 m`, `30 cm`, `600 mm`. Use **More** for sq/cu units, √ and x².
* Units follow the math: ft × ft = sq ft, sq ft × in = cu ft, ft ÷ in = a plain count.
* **Conv** cycles the result through ft-in, inches, decimal ft/in, yd, m, cm, mm (or the area/volume units).
* In tool screens, a number typed without a unit uses the unit shown under the field ("no unit = feet").
  The **Ans** key inserts the last calculator result. Tap any tool result to send it to the tape.

## Test it locally

The service worker only runs from `http://localhost` or `https://`, not from a double-clicked file. In Terminal:

```bash
cd "/Users/phillipkitt/Dropbox/HMC/High Mountain Concepts/Claude/construction master"
```

```bash
python3 -m http.server 8000
```

Open http://localhost:8000 in Chrome or Safari. To try the phone layout in Chrome, use View → Developer → Developer Tools and click the phone icon.
To test offline: load the page once, then check DevTools → Application → Service Workers → **Offline** and reload.

### Run the unit tests

macOS ships a JavaScript engine, so you don't need to install anything:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc calc.js tests/calc.test.js
```

Other ways to run them: `node tests/calc.test.js` (if Node is installed), or open http://localhost:8000/tests/ while the server is running.

### Run the full phone test (optional, needs Node + Playwright)

`tests/e2e.test.js` drives the real app in an iPhone-sized browser: every calculator key path, all 9 tools and their modes,
the tape, settings, saved data across reloads, and a cold start with the network switched off.

```bash
python3 -m http.server 8765 &
node tests/e2e.test.js
```

Last run (Sept 24, 2026): unit tests 81/81 passed, phone test 86/86 passed (includes layout checks on iPhone SE, 14 Pro Max and landscape), no JavaScript errors, offline cold start works.

`tests/stairs.sweep.js` checks the stair tool against independent math for every total rise from 6" to 20' in 1/16" steps (26,215 cases): `node tests/stairs.sweep.js`.

## Host it free on GitHub Pages

1. Create a free account at github.com, then click **+ → New repository**. Name it (e.g. `jobsite-calc`), make it **Public**, and click **Create repository**.
2. On the new repo page, click **uploading an existing file**. Drag in everything in this folder (`index.html`, `styles.css`, `calc.js`, `app.js`, `sw.js`, `manifest.json`, the `icons` folder; `tests` and `README.md` are optional), then click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, and click **Save**.
4. After a minute or two the page shows your URL, e.g. `https://YOURNAME.github.io/jobsite-calc/`.

All paths in the app are relative, so it works from that sub-folder URL as-is.

## Install on your phone

Open your GitHub Pages URL once **while you have signal** so the app can save itself for offline use.

* **iPhone (Safari):** tap **Share** (square with arrow) → **Add to Home Screen** → **Add**. It must be Safari; other iOS browsers may not offer a standalone install.
* **Android (Chrome):** tap **⋮** → **Install app** (or **Add to Home screen**) → **Install**.

Launch it from the home-screen icon, then turn on airplane mode and open it again to confirm it works offline.
Settings → Offline shows "✓ Saved for offline use" once caching is done.

## Updating the app later

After editing any file, change `VERSION` in `sw.js` (e.g. `jobsite-calc-v2`) and upload again.
Phones pick up the new version the next time the app opens with signal, and use it from the launch after that.
Tape, settings and tool inputs are kept.

## Tools

1 Right Angle · 2 Grade & Slope · 3 Rafters · 4 Stairs · 5 Concrete · 6 Excavation · 7 Gravel & Fill · 8 Rebar · 9 Block (CMU) · 10 Lumber · 11 Sheet Goods · 12 Area & Volume · 13 Circles & Arcs · 14 Convert

* **Grade & Slope:** *Rise + Run* takes any two of rise, run, grade % or slope ratio (H:1V) and gives grade %, ratio, rise per foot, rise per 100 ft, angle, pitch and slope length.
  *Elevations* takes three of start elevation, end elevation, distance and grade % (with an Up/Down switch), plus an optional station interval for a grade-stake list (0+00, 0+50…).
  *Pipe fall* gives total fall and end invert from length and inches-per-foot or %.
* **Excavation:** trench (sloped sides, pipe backfill), pit/basement (prismoidal, overdig), cut/fill pad (average of up to 4 depths), average end area, and bank/loose/compacted conversion. Truck loads use loose yards.
* **Gravel & Fill:** tons, yards, truck loads and cost, by area or volume.
* **Rebar:** slab grid both ways, or continuous footing bars with dowels. Gives LF, stock bars, weight and lap splices.
* **Block (CMU):** block count, courses, mortar bags and solid grout.
* **Concrete** gained Wall, Thick-edge slab and Pads, and every concrete result now shows 10-yd truck count.

## Look & feel (version 5)

* Black header with a yellow rule in both themes. It sits under the iPhone status bar, so the clock and battery stay readable.
* Every button is at least 44 px (Apple's minimum). Keys shrink a little on small phones (SE/mini) so the tape keeps its space.
* Landscape: tape and display on the left, keypad on the right, and a 2-row field keypad.
* Numbers of 10,000 and up get commas (elevations like 7703.45 stay plain). A long press doesn't pop up text selection.
* New square-and-rule home-screen icon. Settings shows the version number so you can confirm an update reached the phone.

## Notes

* Stair checks use IRC R311.7.5: 7-3/4" max riser, 10" min tread. Always confirm against your local code.
* Rafter and stringer lengths are line lengths. Make your usual deductions (ridge, hip, seat cuts) and buy stock long.
* Swell/shrink defaults (common earth 25/10, clay 30/15, sand & gravel 12/7, topsoil 43/20, blasted rock 50/−30) are typical book values. Enter your own % when you know the soil.
* Material weights (tons per cu yd: gravel 1.4, road base 1.5, sand 1.35, fill 1.2, topsoil 1.0, river rock 1.35, asphalt 2.0) are typical loose weights. Ask your supplier for their number and type it in the Tons per cu yd field.
* Rebar lap defaults to 40 bar diameters, and weights are standard ASTM lb/ft. Follow the engineer's drawings.
* CMU: 1.125 block per sq ft for an 8×16 face. Grout for solid-grouted walls: 6" 0.167, 8" 0.258, 10" 0.34, 12" 0.42 cu ft per sq ft (typical). Mortar defaults to 12 blocks per 80 lb bag and can be changed.
* Concrete bag yields assume 0.60 cu ft per 80 lb bag and 0.45 cu ft per 60 lb bag.
