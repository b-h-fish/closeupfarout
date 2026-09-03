/* ── SPLIT STACK · the address bar tells the truth ─────────────────────────
   Run with:  node split-stack/url.test.js

   Joining a room writes ?room= so a refresh reconnects to the same seat.
   Leaving one has to take it off again. It did not, and Play Again is where
   that showed: it leaves the room for the profile screen, and refreshing
   there booted straight into "JOIN <a code nobody is at any more>".

   A separate file from smoke.test.js because the state under test is set
   before the app boots, and that suite boots once with a clean URL.
   ──────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');
const DIR = __dirname;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}

const winH = {}, canH = {};
const listener = (s) => (t, fn) => { (s[t] = s[t] || []).push(fn); };
function fakeCanvas() {
  return {
    width: 640, height: 400, style: {},
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {}
    }),
    addEventListener: listener(canH),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    focus: () => {}
  };
}
const els = { stage: fakeCanvas(), bg: fakeCanvas(), say: { textContent: '' }, stack: { style: {} } };

let rafs = [];
global.window = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2,
  matchMedia: () => ({ matches: false }),
  addEventListener: listener(winH)
};
global.document = {
  readyState: 'complete',
  addEventListener: () => {},
  getElementById: (id) => els[id] || null
};

/* A location that actually changes when the app rewrites it — a stub that
   swallowed replaceState would have passed against the bug. */
const START = '?room=ZKA3&scene=2';
global.location = { search: START, pathname: '/split-stack/', origin: 'https://x.test' };
const urls = [];
global.history = {
  replaceState: (a, b, url) => {
    urls.push(url);
    const q = url.indexOf('?');
    global.location.search = q < 0 ? '' : url.slice(q);
  }
};
global.URLSearchParams = URLSearchParams;
global.requestAnimationFrame = (fn) => { rafs.push(fn); return rafs.length; };
global.localStorage = (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
})();
global.WebSocket = function () { this.readyState = 0; this.close = () => {}; };
global.fetch = () => new Promise(() => {});
global.navigator = { clipboard: { writeText: () => {} } };
global.crypto = require('crypto').webcrypto;

for (const f of ['pixel.js', 'layout.js', 'scenes.js', 'avatars.js',
                 'game.js', 'net.js', 'app.js']) {
  eval.call(global, fs.readFileSync(path.join(DIR, f), 'utf8'));
}

const draw = () => { const fn = rafs.pop(); rafs.length = 0; fn(16); };
const key = (k) => (winH.keydown || []).forEach(fn => fn({ key: k, preventDefault() {} }));

ok('the app boots on an invite link', (() => {
  try { draw(); return true; } catch (e) { console.log('    ' + e.message); return false; }
})());
/* The invite has to survive a look. Stripping the code at boot would fix the
   refresh and break the link — somebody who opens an invite, hesitates, and
   reloads should still be offered the game. */
ok('the code is still in the address bar while the offer stands',
   location.search.indexOf('room=ZKA3') >= 0, location.search);

/* An invite link opens with the name field live, so the first Escape closes
   that and the second leaves the screen. Spelled out rather than pressed
   twice in a loop, because "press escape until something happens" is how a
   test passes on a screen it never actually reached. */
key('Escape');
draw();
ok('the first escape only closes the name field',
   location.search.indexOf('room=ZKA3') >= 0, location.search);

key('Escape');
draw();
ok('leaving the join screen rewrote the address bar', urls.length > 0,
   'no replaceState');
ok('the room is gone from it', location.search.indexOf('room') < 0, location.search);
/* Only the room key. A setting in the same query string is the player's, not
   the room's, and rewriting the whole path would have taken it with it. */
ok('and everything else survived', location.search.indexOf('scene=2') >= 0, location.search);

/* Nothing puts it back. Not asserted as "the URL never changes again" —
   escaping to the menu clears the whole query on purpose, which is a
   different thing from the room leaking back into it. */
key('Escape');
draw();
ok('and nothing puts the room back', location.search.indexOf('room') < 0,
   location.search);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
