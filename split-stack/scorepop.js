/* ── SPLIT STACK · what a score looks like when it lands ───────────────────
   Dev-only mock. The points from a call, on the pile it was called on:
   pops in a size too big, settles, rises a little, and is gone at a second.

   Colour carries the kind of call, so the four are told apart before the
   digit is read. Fixed hex rather than the setting's palette, for the same
   reason the avatars are: what a Split is worth does not change with the
   time of day. They are picked to clear both grounds this can land on —
   cream card stock and the dark ground plane — and every one is outlined,
   which is what makes that possible without a plate behind it.
   ──────────────────────────────────────────────────────────────────────── */
(function (root) {

  var PAY_INK = {
    PLACE: '#4da6ff',   // blue   · a Hi or a Lo, +1
    SUIT:  '#ffd23c',   // yellow · +3
    SPLIT: '#4fd67a',   // green  · +4
    KILL:  '#ff4d5a'    // red    · -2
  };
  var EDGE = '#140f1c';

  /* Which of the four a resolved call was. Reads the same fields game.js
     already puts on state.last, so nothing new has to be tracked. */
  function kindOf(call, survived) {
    if (!survived) return 'KILL';
    if (call === 'SPLIT') return 'SPLIT';
    if (call === 'SUIT') return 'SUIT';
    return 'PLACE';
  }

  function label(v) { return (v < 0 ? '-' : '+') + Math.abs(v); }

  /* Eight ways round, then the face on top. An offset drop shadow was the
     first try and it is not enough: it leaves two sides of every stroke
     touching the card, and on a court card those sides disappear. */
  function outlined(fb, s, x, y, k, ink, edge) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx || dy) fb.textBig(s, x + dx * k, y + dy * k, edge, k);
      }
    }
    fb.textBig(s, x, y, ink, k);
  }

  var LIFE = 1000;   // gone at a second
  var POP  = 120;    // how long it holds the larger size
  var LIFT = 10;     // and how far it climbs before it settles

  /* ms is how long ago the call resolved. Returns false once it is over, so
     the caller knows when to stop asking. */
  function draw(fb, x, y, w, h, ms, value, kind) {
    if (ms < 0 || ms >= LIFE) return false;
    var s = label(value);
    var k = ms < POP ? 3 : 2;
    var rise = Math.round(LIFT * Math.min(1, ms / 350));
    var cx = x + ((w - fb.textW(s, k)) >> 1);
    var cy = y + (h >> 1) - ((7 * k) >> 1) - rise;
    outlined(fb, s, cx, cy, k, hex(PAY_INK[kind] || PAY_INK.PLACE), hex(EDGE));
    return true;
  }

  root.ScorePop = {
    draw: draw, kindOf: kindOf, LIFE: LIFE, INK: PAY_INK
  };
})(typeof window !== 'undefined' ? window : globalThis);
