/* ── WAVER · the field ─────────────────────────────────────────────────────
   Run with:  node waver/field.test.js        (exits non-zero on a failure)

   Pulls the script straight out of waver/index.html and runs it against a
   stub DOM, so this tests the page rather than a copy of it that can drift.
   Nothing is simulated twice: the assertions are made against the points and
   the colours the page's own draw() actually hands to the canvas.

   What it protects is the edges. The field is drawn past the top and bottom
   of the screen on purpose, because a line swinging at its own amplitude
   would otherwise pull away from an edge and leave a band of background
   behind it — and that band only appears at certain moments in the motion,
   which is exactly the kind of thing a glance at the live page misses. The
   same goes for the right edge: sampling every STEP pixels leaves a bare
   strip there unless the last sample is forced onto the edge exactly.

   It also pins the colour structure — one stroke per band, evenly spaced,
   closing the wheel — because getting that wrong does not throw. It just
   quietly renders a different field from the one the settings describe.
   ──────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond ? pass++
  : (fail++, console.log('  ✗ ' + name + (extra ? '  ' + extra : '')));

/* Run the real page at a given size for a number of frames, collecting every
   point and every stroke colour it produces, tagged by frame. */
function render(w, h, frames) {
  const strokes = [], pts = [];
  let NOW = 1000, frameNo = 0, left = frames;

  class Path2D {
    moveTo(x, y) { pts.push([frameNo, x, y]); }
    lineTo(x, y) { pts.push([frameNo, x, y]); }
  }
  const ctxStub = {
    set strokeStyle(v) { strokes.push(v); }, get strokeStyle() { return ''; },
    lineWidth: 1, lineJoin: '', lineCap: '',
    clearRect() {}, setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  };
  const host = { clientWidth: w, clientHeight: h, style: {} };
  const canvas = { style: {}, width: 0, height: 0, getContext: () => ctxStub };

  global.Path2D = Path2D;
  global.document = {
    querySelector: s => (s === 'main' ? host : null),
    getElementById: id => (id === 'waves' ? canvas : null),
    addEventListener() {},
  };
  global.window = { matchMedia: () => ({ matches: false }), devicePixelRatio: 2 };
  global.ResizeObserver = class { observe() {} };
  global.performance = { now: () => NOW };
  // Each frame jumps the clock, so the sweep lands on unrelated phases of the
  // motion rather than re-testing one instant several times over.
  global.requestAnimationFrame = f => {
    if (left-- > 0) { NOW += 1700; frameNo++; f(NOW); }
    return 1;
  };
  global.cancelAnimationFrame = () => {};

  eval('(function(){' + script + '})()');
  return { strokes, pts, w, h, frames };
}

/* ── the colours a frame puts on the canvas ─────────────────────────── */
{
  const { strokes } = render(1440, 900, 1);
  const uniq = [...new Set(strokes)];
  ok('a frame strokes once per band, no colour twice',
     strokes.length === uniq.length && uniq.length > 1,
     strokes.length + ' strokes, ' + uniq.length + ' distinct');
  ok('every stroke is hsla at one alpha',
     uniq.every(c => /^hsla\([\d.]+,\d+%,\d+%,[\d.]+\)$/.test(c)), uniq[0]);

  const hueOf = c => parseFloat(c.slice(5));
  const step = hueOf(uniq[1]) - hueOf(uniq[0]);
  ok('hues evenly spaced round the wheel',
     uniq.every((c, i) => i === 0 || Math.abs(hueOf(c) - hueOf(uniq[i - 1]) - step) < 0.01),
     'step ' + step.toFixed(2) + '°');
  ok('the bands close the wheel', Math.abs(step * uniq.length - 360) < 0.01,
     step.toFixed(2) + ' × ' + uniq.length);
  console.log('  ' + uniq.length + ' bands, ' + step.toFixed(1) + '° apart, ' + uniq[0]);
}

/* ── no bare edge, at any size, at any moment in the motion ─────────── */
console.log('');
for (const [w, h, label] of [[1440, 900, '1440×900'],
                             [2560, 1440, '2560×1440'],
                             [390, 844, 'iPhone 390×844'],
                             [1280, 400, 'short 1280×400']]) {
  const FRAMES = 8;
  const { pts } = render(w, h, FRAMES);
  ok(label + ': the page drew something', pts.length > 1000, pts.length + ' points');

  // Per frame, because a gap that opens at one instant and closes at the
  // next is still a gap. Plain loops rather than Math.min(...spread): a
  // frame runs to six figures of points and the spread overruns the stack.
  const top = new Array(FRAMES + 1).fill(Infinity);
  const bottom = new Array(FRAMES + 1).fill(-Infinity);
  let maxX = -Infinity, minX = Infinity, drew = 0;
  for (let i = 0; i < pts.length; i++) {
    const f = pts[i][0], x = pts[i][1], y = pts[i][2];
    if (y < top[f]) top[f] = y;
    if (y > bottom[f]) bottom[f] = y;
    if (x > maxX) maxX = x;
    if (x < minX) minX = x;
  }
  let worstTop = -Infinity, worstBottom = Infinity;
  for (let f = 1; f <= FRAMES; f++) {
    if (top[f] === Infinity) continue;
    drew++;
    // The highest point drawn must sit at or above the top edge, and the
    // lowest at or below the bottom, or a band of background shows through.
    if (top[f] > worstTop) worstTop = top[f];
    if (bottom[f] < worstBottom) worstBottom = bottom[f];
  }
  ok(label + ': every frame drew', drew === FRAMES, drew + ' of ' + FRAMES);
  ok(label + ': the field covers the top edge in every frame', worstTop <= 0,
     'worst frame reached only y=' + worstTop.toFixed(1));
  ok(label + ': the field covers the bottom edge in every frame', worstBottom >= h,
     'worst frame reached only y=' + worstBottom.toFixed(1) + ' of ' + h);
  ok(label + ': lines run to the left edge exactly', minX === 0, 'x=' + minX);
  ok(label + ': lines run to the right edge exactly', maxX === w, 'x=' + maxX + ' of ' + w);
  console.log('  ' + label.padEnd(18) + ' top ' + worstTop.toFixed(1).padStart(7) +
              '   bottom ' + worstBottom.toFixed(1).padStart(7) + ' of ' + h +
              '   x ' + minX + '–' + maxX);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
