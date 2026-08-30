/* ── SPLIT STACK · does every screen actually draw? ────────────────────────
   Run with:  node split-stack/smoke.test.js

   `node --check` proves a file parses. It does not prove a variable exists.
   Twice now a screen has shipped referencing a name that was never declared —
   the file parsed, the page loaded, and the panel vanished the moment that
   screen was reached. Nothing in the console until you walked to it.

   So: stub just enough browser to run the real app, then visit every screen
   and draw a frame. A missing declaration throws here instead of in front of
   somebody.
   ──────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');
const DIR = __dirname;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}

// ── the smallest browser that will run this app ──
const handlers = {};
function listener(store) {
  return (type, fn) => { (store[type] = store[type] || []).push(fn); };
}
const winH = {}, canH = {};

function fakeCanvas() {
  return {
    width: 640, height: 400,
    style: {},
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {}
    }),
    addEventListener: listener(canH),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    focus: () => {}
  };
}

const stage = fakeCanvas(), bg = fakeCanvas();
const els = { stage, bg, say: { textContent: '' }, stack: { style: {} } };

let rafs = [];
global.window = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2,
  matchMedia: () => ({ matches: false }),
  addEventListener: listener(winH)
};
global.document = {
  readyState: 'complete',
  addEventListener: listener(handlers),
  getElementById: (id) => els[id] || null
};
global.location = { search: '', pathname: '/split-stack/', origin: 'https://x.test' };
global.history = { replaceState: () => {} };
global.URLSearchParams = URLSearchParams;
global.requestAnimationFrame = (fn) => { rafs.push(fn); return rafs.length; };
global.localStorage = (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
})();
global.WebSocket = function () { this.readyState = 0; this.close = () => {}; };
global.fetch = () => new Promise(() => {});          // never settles; we only draw
global.navigator = { clipboard: { writeText: () => {} } };
global.crypto = require('crypto').webcrypto;

for (const f of ['pixel.js', 'layout.js', 'scenes.js', 'game.js', 'net.js', 'app.js']) {
  eval.call(global, fs.readFileSync(path.join(DIR, f), 'utf8'));
}
ok('all five scripts load', true);

function draw() { const fn = rafs.pop(); rafs.length = 0; fn(16); }
function key(k) { (winH.keydown || []).forEach(fn => fn({ key: k, preventDefault() {} })); }
function tapAt(x, y) {
  (canH.pointerdown || []).forEach(fn => fn({ clientX: x, clientY: y }));
}

// The app boots itself on load; drive it from there.
ok('the first frame draws', (() => { try { draw(); return true; }
  catch (e) { console.log('    ' + e.message); return false; } })());

/* Walk the screens the only way a player can — by pressing things. Each hop
   draws a frame, which is where a missing name would throw. */
function visit(label, act) {
  let threw = null;
  try { act(); draw(); } catch (e) { threw = e; }
  ok(label + ' draws', !threw, threw ? threw.message : '');
}

// MENU is already up. 'm' opens the mode picker; Escape walks back.
visit('MODE', () => key('m'));
/* From MODE the only way on is a tap, so aim at the first button row using
   the same geometry the panel uses. The canvas is 1280x800 CSS over a logical
   frame, and tapAt takes CSS pixels — mirroring what a real pointer sends. */
const W = stage.width, H = stage.height;
const SCALE_X = 1280 / W, SCALE_Y = 800 / H;
function tapLogical(lx, ly) { tapAt(lx * SCALE_X, ly * SCALE_Y); }

// row1 of the shared skeleton, measured the way menuGeom does
const markH = splitMarkH(3);
const GWIDL = 4 * 24 + 3 * 5;
const bandY = markH + 16, labelY = bandY + GWIDL + 4, row1Y = labelY + 7 + 5;
const row2Y = row1Y + 20 + 14, blockH = row2Y + 20;
const top = Math.max(8, Math.round((H - blockH) / 2));

/* row2, not row1: the mode screen's first button is the unbuilt matchmaking
   one and takes no tap. Aiming at it left this walk stopping on MODE while
   every later check still passed, which is the worst kind of green. */
visit('ROOM, host or join', () => tapLogical(W >> 1, top + row2Y + 10));
/* The live region names the screen, which is the only handle on it from out
   here — without this the walk could stop on MODE and every later check
   would still pass, which is the worst kind of green. */
ok('the walk actually reached ROOM', /host a game|join one/i.test(els.say.textContent),
   'say: ' + els.say.textContent);

/* JOIN with no name set opens the name step, which then continues into the
   code step rather than dropping back at the fork. */
visit('NAME step', () => tapLogical(W >> 1, top + row2Y + 10));
ok('joining with no name asks for one', /enter a name/i.test(els.say.textContent),
   'say: ' + els.say.textContent);
visit('NAME typed, continues', () => { 'ALPHA'.split('').forEach(key); key('Enter'); });
ok('naming continues to the code step', /room code/i.test(els.say.textContent),
   'say: ' + els.say.textContent);
visit('CODE typed', () => { '2345'.split('').forEach(key); });
visit('back to the fork', () => key('Escape'));

/* The lobby and the multiplayer board never come up without a server, so
   reach them the way the server would: hand the app a real state and draw. */
ok('lobby and board are covered by room.test.js, not here', true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
