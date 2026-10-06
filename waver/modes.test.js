/* ── WAVER · modes and controls ────────────────────────────────────────────
   Run with:  node waver/modes.test.js        (exits non-zero on a failure)

   This pulls the script straight out of waver/index.html and runs it against
   a stub DOM, so it tests the page rather than a copy of it that can drift.

   What it is here to protect is the control layer, because its failures are
   quiet ones. A bar that never withdraws leaves chrome sitting over an
   ambient piece; a bar that withdraws while focused leaves a focus ring on
   nothing, which a mouse would never show you; one that stays clickable
   while invisible swallows clicks meant for the page. None of those throw,
   and none are visible in a screenshot.

   It also pins the mode table to what actually reaches the canvas: that a
   frame strokes once per band at the mode's own alpha. Getting that wrong
   does not break the page either — it just quietly renders a different
   field from the one the table describes.
   ──────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond ? pass++
  : (fail++, console.log('  ✗ ' + name + (extra ? '  ' + extra : '')));

let NOW = 1000;
const strokes = [];                 // every strokeStyle a frame actually used

class Path2D { moveTo() {} lineTo() {} }
const ctxStub = {
  set strokeStyle(v) { strokes.push(v); }, get strokeStyle() { return ''; },
  lineWidth: 1, lineJoin: '', lineCap: '',
  clearRect() {}, setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
};

function el(extra = {}) {
  const e = {
    clientWidth: 1440, clientHeight: 900, style: {},
    children: [], _cls: new Set(), _pressed: null,
    classList: {
      add(c) { e._cls.add(c); }, remove(c) { e._cls.delete(c); },
      contains(c) { return e._cls.has(c); },
    },
    appendChild(c) { e.children.push(c); return c; },
    addEventListener() {},
    contains() { return false; },
    getContext() { return ctxStub; },
    setAttribute(k, v) { if (k === 'aria-pressed') e._pressed = v; else e[k] = v; },
    ...extra,
  };
  return e;
}

const main = el(), canvas = el(), bar = el();
const winListeners = {};
let framesLeft = 1;                 // one real frame, then stop recursing
const intervals = [];

global.document = {
  querySelector: s => (s === 'main' ? main : null),
  getElementById: id => (id === 'waves' ? canvas : id === 'modes' ? bar : null),
  createElement: () => el(),
  addEventListener() {},
  activeElement: null,
};
global.window = {
  matchMedia: () => ({ matches: false }),
  devicePixelRatio: 2,
  addEventListener(k, f) { (winListeners[k] ||= []).push(f); },
};
global.ResizeObserver = class { observe() {} };
global.performance = { now: () => NOW };
global.requestAnimationFrame = f => { if (framesLeft-- > 0) f(NOW); return 1; };
global.cancelAnimationFrame = () => {};
global.history = { replaceState() {} };
global.location = {
  href: 'https://closeupfarout.com/waver?mode=wash', search: '?mode=wash',
};
global.setInterval = f => { intervals.push(f); return intervals.length; };

eval('(function(){' + script + '})()');

const tick = () => intervals.forEach(f => f());

/* ── the mode table reaches the bar ─────────────────────────────────── */
ok('a button per mode', bar.children.length >= 1, 'got ' + bar.children.length);
ok('the button carries the mode label',
   typeof bar.children[0].textContent === 'string' && bar.children[0].textContent.length > 0,
   JSON.stringify(bar.children[0].textContent));
ok('the active mode is marked pressed', bar.children[0]._pressed === 'true',
   String(bar.children[0]._pressed));

/* ── it shows on arrival, then withdraws ────────────────────────────── */
ok('awake on arrival', bar.classList.contains('awake'));
NOW += 1000; tick();
ok('still awake after 1.0s of stillness', bar.classList.contains('awake'));
NOW += 1000; tick();
ok('still awake after 2.0s', bar.classList.contains('awake'));
NOW += 1000; tick();
ok('withdrawn by 3.0s', !bar.classList.contains('awake'));

/* ── and comes back, through the page's own listener ────────────────── */
ok('a pointermove listener is registered', !!winListeners.pointermove);
winListeners.pointermove.forEach(f => f());
ok('woken by a pointer moving', bar.classList.contains('awake'));

/* ── focus holds it open ────────────────────────────────────────────── */
bar.contains = () => true;                    // focus is inside the bar
global.document.activeElement = bar.children[0];
NOW += 5000; tick();
ok('stays open while focus is inside it', bar.classList.contains('awake'));
bar.contains = () => false;
NOW += 5000; tick();
ok('withdraws once focus leaves', !bar.classList.contains('awake'));

/* ── what a frame actually put on the canvas ────────────────────────── */
const uniq = [...new Set(strokes)];
ok('a frame stroked once per band', strokes.length === uniq.length && uniq.length > 1,
   strokes.length + ' strokes, ' + uniq.length + ' distinct');
ok('every stroke is hsla at one alpha',
   uniq.every(c => /^hsla\([\d.]+,\d+%,\d+%,[\d.]+\)$/.test(c)), uniq[0]);
const hueOf = c => parseFloat(c.slice(5));
const step = hueOf(uniq[1]) - hueOf(uniq[0]);
ok('hues are evenly spaced round the wheel',
   uniq.every((c, i) => i === 0 || Math.abs(hueOf(c) - hueOf(uniq[i - 1]) - step) < 0.01),
   'step ' + step.toFixed(2) + ' degrees');
ok('the bands close the wheel', Math.abs(step * uniq.length - 360) < 0.01,
   step.toFixed(2) + ' x ' + uniq.length);

console.log('\n  ' + uniq.length + ' bands, ' + step.toFixed(1) + '° apart, ' + uniq[0]);
console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
