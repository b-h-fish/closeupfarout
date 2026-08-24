/* The Hi Lo teaser: the game playing itself, in a setting that keeps changing.

   Same idea as the Cento block beside it — the page shows the actual thing
   rather than a picture of it. This runs the real rules engine, the real
   renderer and the real palettes, and it lays the board out the way app.js
   does: stock on the left, calls on the right, both bottom-aligned to the
   board. Nothing here decides anything about the rules; game.js does, exactly
   as it does for a player.

   THE ONE RULE THIS FILE MUST KEEP: a card is drawn at CARD_W x CARD_H and
   never at any other size. The card art is fixed-size pixel art — the corner
   indices, the court figures and the ace glyphs are bitmaps, and only the pip
   column spacing reads from the card's width. Ask cardFace for a smaller card
   and the indices overflow, `span = h - 32` collapses the pip rows into each
   other, and the court bitmaps are drawn full size on a card half that big.
   So the board never shrinks; the whole canvas is scaled by a whole number
   instead, which is what the game itself does.

   The bot counts cards. It is not there to win, it is there to look like
   someone who knows the game. */
(function (global) {
  'use strict';

  /* Lifted from app.js so the teaser reads as the same game, not a lookalike.
     If these move there, they should move here. */
  var GAP_C = 5;                 // between cards on the board
  var SIDE_W = 88, BTN_H = 18, BTN_GAP = 8;
  var STOCK_GAP = 26, CALLS_GAP = 26;
  var DEAL_MS = 380, HOLD_MS = 800, FLIP_MS = 420;

  /* The teaser's own beats: the pauses where a player would be deciding. */
  var T_SELECT = 420, T_CALL = 440, T_SETTLE = 320, T_OVER = 2200, T_START = 520;

  var SCENE_MS = 11000;          // how long a setting holds
  var FADE_MS  = 900;            // and how long it takes to give way

  function make(canvas, opts) {
    /* The front page loads four files to run this. If any is missing the
       teaser simply does not appear — a preview is never worth taking a page
       down for. */
    if (!canvas || typeof FB !== 'function' || typeof drawScene !== 'function' ||
        typeof HiLo === 'undefined' || typeof SCENES === 'undefined') return null;

    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var COLS = opts.cols || 3, ROWS = opts.rows || 3;

    var scene = opts.scene != null ? opts.scene
                                   : (Math.random() * SCENES.length) | 0;
    var nextScene = -1, fadeT = 0, sceneT = 0;
    var fb = null, W = 0, H = 0, scale = 2, beside = true;
    var hover = false, running = false, cache = [];

    var g = null, phase = '', phaseT = 0, pending = null, shown = null;

    // ── what the bot can know ─────────────────────────────────────────
    var DECK_VALS = (function () {
      var v = [];
      for (var c = 0; c < 52; c++) v.push(HiLo.value(c));
      return v;
    })();

    /* Every card sitting on a pile has been face up at some point, so this is
       what a player watching could know. The bot gets no look at the stock. */
    function remaining(state) {
      var counts = {}, i, j;
      for (i = 0; i < DECK_VALS.length; i++) {
        counts[DECK_VALS[i]] = (counts[DECK_VALS[i]] || 0) + 1;
      }
      for (i = 0; i < state.size; i++) {
        var cards = state.piles[i].cards;
        for (j = 0; j < cards.length; j++) counts[HiLo.value(cards[j])]--;
      }
      return counts;
    }

    /* The best (pile, call) on the board. A made Split is worth a shade more
       than its bare odds because it buys a pile back, so it takes ties. */
    function think(state) {
      var counts = remaining(state), total = 0, v;
      for (v in counts) total += counts[v];
      if (!total) return null;

      var best = null, i;
      for (i = 0; i < state.size; i++) {
        if (!state.piles[i].alive) continue;
        if (state.selected >= 0 && state.selected !== i) continue;
        var ov = HiLo.value(HiLo.top(state, i));
        var hi = 0, lo = 0, eq = 0;
        for (v in counts) {
          var n = counts[v];
          if (!n) continue;
          if (+v > ov) hi += n; else if (+v < ov) lo += n; else eq += n;
        }
        var cand = [['HI', hi], ['LO', lo], ['SPLIT', eq]];
        for (var k = 0; k < cand.length; k++) {
          var score = cand[k][1] / total + (cand[k][0] === 'SPLIT' ? 0.02 : 0);
          if (!best || score > best.score) {
            best = { pile: i, call: cand[k][0], score: score };
          }
        }
      }
      return best;
    }

    /* Bring back whichever dead pile is least likely to die again — an extreme
       top card has the rest of the deck on its side. */
    function pickRevive(state) {
      var counts = remaining(state), total = 0, v;
      for (v in counts) total += counts[v];
      var best = null;
      for (var i = 0; i < state.size; i++) {
        if (state.piles[i].alive) continue;
        var ov = HiLo.value(HiLo.top(state, i));
        var hi = 0, lo = 0;
        for (v in counts) {
          if (!counts[v]) continue;
          if (+v > ov) hi += counts[v]; else if (+v < ov) lo += counts[v];
        }
        var p = Math.max(hi, lo) / (total || 1);
        if (!best || p > best.p) best = { pile: i, p: p };
      }
      return best;
    }

    // ── geometry, at the card's own size ──────────────────────────────
    var boardW = COLS * CARD_W + (COLS - 1) * GAP_C;
    var boardH = ROWS * CARD_H + (ROWS - 1) * GAP_C;

    /* Two arrangements, both the game's own: calls beside the board, or calls
       in a row beneath it when there is no width for a column. */
    var NEED_BESIDE = { w: CARD_W + STOCK_GAP + boardW + CALLS_GAP + SIDE_W + 20,
                        h: boardH + 26 };
    /* In under mode the board is not alone in the column: the call row and the
       PICK A PILE line below it are part of the block, and centring the board
       alone is what pushed that line off the bottom edge. */
    var UNDER_BELOW = 14 + BTN_H + 6 + 7;      // gap, buttons, gap, one line
    var NEED_UNDER  = { w: Math.max(boardW, 148) + 20,
                        h: boardH + UNDER_BELOW + 20 };

    var geo = null;
    function layout() {
      var bx, by;
      if (beside) {
        var total = CARD_W + STOCK_GAP + boardW + CALLS_GAP + SIDE_W;
        bx = Math.round((W - total) / 2) + CARD_W + STOCK_GAP;
      } else {
        bx = Math.round((W - boardW) / 2);
      }
      /* Centred in the frame, as the game centres it in the viewport — the
         setting's ground plane falls where it falls behind it. Under mode
         centres the board plus what hangs below it, not the board alone. */
      by = beside ? Math.round((H - boardH) / 2)
                  : Math.round((H - (boardH + UNDER_BELOW)) / 2);

      geo = { bx: bx, by: by,
              sx: bx - CARD_W - STOCK_GAP,        // stock, left of the board
              sy: by + boardH - CARD_H,           // standing on its bottom row
              cx: bx + boardW + CALLS_GAP,        // the call column
              cy: by + boardH - (3 * BTN_H + 2 * BTN_GAP) };
    }
    function pileBox(i) {
      return { x: geo.bx + (i % COLS) * (CARD_W + GAP_C),
               y: geo.by + ((i / COLS) | 0) * (CARD_H + GAP_C) };
    }

    /* Pick the largest whole-number scale the pane can hold, preferring the
       calls beside the board when both fit. A fractional scale is not on the
       table — half a pixel is what the art is built to avoid. */
    function fit(rw, rh) {
      for (var s = 4; s >= 1; s--) {
        if (NEED_BESIDE.w * s <= rw && NEED_BESIDE.h * s <= rh) return { s: s, beside: true };
        if (NEED_UNDER.w  * s <= rw && NEED_UNDER.h  * s <= rh) return { s: s, beside: false };
      }
      return { s: 1, beside: false };
    }

    function resize() {
      /* Measure the parent, never the canvas: sizing the canvas from its own
         box is circular — before the first pass it has only its intrinsic
         300x150, so it would lock itself in at that and never grow. */
      var host = canvas.parentNode;
      if (!host) return false;
      var r = host.getBoundingClientRect();
      if (!r.width || !r.height) return false;

      var f = fit(r.width, r.height);
      var w = Math.max(120, Math.floor(r.width / f.s));
      var h = Math.max(90, Math.floor(r.height / f.s));
      if (w === W && h === H && f.s === scale && f.beside === beside && fb) return true;
      W = w; H = h; scale = f.s; beside = f.beside;

      canvas.width = W; canvas.height = H;
      /* Sized to an exact whole multiple rather than to the pane, so a source
         pixel always lands on a whole number of screen pixels. The few pixels
         of slack this leaves are absorbed by centring. */
      canvas.style.width = (W * scale) + 'px';
      canvas.style.height = (H * scale) + 'px';

      fb = new FB(W, H);
      cache = [];
      layout();
      return true;
    }

    /* One rendered setting, kept as raw bytes — the backdrop does not change
       between frames, and redrawing it every frame would spend the whole
       budget on a still image. */
    function sceneBytes(idx) {
      if (!cache[idx]) {
        var t = new FB(W, H);
        drawScene(t, SCENES[idx], W, H);
        cache[idx] = t.d.slice(0);
      }
      return cache[idx];
    }

    // ── the wordmark: HI runs hot, LO runs cold ───────────────────────
    /* Seven steps each, one per row of the font, so the heat is a property of
       the glyph rather than a gradient laid over it. Both ramps deliberately
       stop short of their dark end: a red that falls to near-black and a blue
       that falls to navy both lose the dark settings, and the mark has to hold
       on all four. Hue carries the hot/cold read; brightness stays put. */
    var HOT  = ['#fff3cc','#ffda78','#ffb443','#ff8a33','#f7632c','#e6462e','#d0342f'];
    var COLD = ['#f4fcff','#d8f3ff','#aee3fb','#83cbf2','#5cafe6','#3f93da','#2d79cb'];
    var HOT_C = null, COLD_C = null;              // packed once, on first use

    var WM_GAP = 5, WM_OVER = 2, WM_TALL = 11;
    function wordmarkW(k) { return (11 + WM_GAP + 1 + WM_GAP + 11) * k; }

    function ramps() {
      if (!HOT_C) {
        HOT_C = HOT.map(hex);
        COLD_C = COLD.map(hex);
      }
    }

    /* The font renderer takes one colour for the whole string, so the ramp is
       applied a row at a time here instead. */
    function textRows(t, s, x, y, k, ramp, flat) {
      for (var i = 0; i < s.length; i++) {
        var gl = GLYPH[s[i]];
        if (gl) for (var j = 0; j < gl.length; j++) {
          var col = flat || ramp[Math.min(j, ramp.length - 1)];
          for (var m = 0; m < gl[j].length; m++) {
            if (gl[j][m] !== '.') t.rect(x + m * k, y + j * k, k, k, col);
          }
        }
        x += 6 * k;
      }
    }

    var RING = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];

    function wordmark(t, x, y, k, shadow) {
      ramps();
      var rx = x + 11 * k + WM_GAP * k;            // where the divider stands
      var lx = rx + k + WM_GAP * k;                // where LO starts
      var i;

      /* A ring rather than an offset drop shadow. The mark lands on cream card
         stock as often as on sky, and a shadow on one side only leaves the
         other three sitting on a tone as light as the letters. */
      for (i = 0; i < RING.length; i++) {
        textRows(t, 'HI', x + RING[i][0] * k, y + RING[i][1] * k, k, null, shadow);
        textRows(t, 'LO', lx + RING[i][0] * k, y + RING[i][1] * k, k, null, shadow);
      }
      textRows(t, 'HI', x, y, k, HOT_C);
      textRows(t, 'LO', lx, y, k, COLD_C);

      /* The divider stays black — the two words carry the temperature and a
         third colour between them only muddles the crossing. It overshoots the
         caps at both ends, which no letter does, and that is what keeps it
         reading as a rule rather than as a second I. */
      var top = y - WM_OVER * k, tall = WM_TALL * k;
      t.rect(rx, top, k, tall, shadow);
    }

    // ── the game clock ────────────────────────────────────────────────
    function newGame() {
      g = HiLo.create((Math.random() * 0x7fffffff) | 0, COLS, ROWS, 1);
      shown = null; pending = null;
      go('start', T_START);
    }
    function go(p, d) { phase = p; phaseT = d; }

    function step() {
      if (!g) return newGame();

      switch (phase) {
        case 'start':
          pending = think(g);
          if (!pending) return newGame();
          // a one-pile board is already selected for the player
          return g.selected >= 0 ? go('call', T_CALL) : go('select', T_SELECT);

        case 'select':
          HiLo.apply(g, { t: 'SELECT', pile: pending.pile });
          return go('call', T_CALL);

        case 'call':
          HiLo.apply(g, { t: 'CALL', call: pending.call });
          shown = g.last;
          return go('deal', DEAL_MS);

        case 'deal':
          /* A losing card sits face up for a beat before the pile turns over —
             the same pause the game gives it. */
          return shown && !shown.survived ? go('hold', HOLD_MS) : go('settle', T_SETTLE);

        case 'hold':   return go('flip', FLIP_MS);

        case 'flip':
        case 'settle':
          if (g.phase === 'WON' || g.phase === 'LOST') return go('over', T_OVER);
          if (g.phase === 'RESURRECT') {
            var rv = pickRevive(g);
            if (!rv) return go('start', 60);
            HiLo.apply(g, { t: 'REVIVE', pile: rv.pile });
            shown = { pile: rv.pile, revive: true };
            return go('revive', FLIP_MS);
          }
          return go('start', 60);

        case 'revive': shown = null; return go('start', 60);
      }
      return newGame();                                    // 'over', or unknown
    }

    // ── drawing, following app.js's drawPile ──────────────────────────
    function pal() { return SCENES[scene].pal; }

    function drawPile(i, P2) {
      var b = pileBox(i), pile = g.piles[i], cards = pile.cards;
      var dealing  = phase === 'deal'   && shown && shown.pile === i;
      var holding  = phase === 'hold'   && shown && shown.pile === i;
      var flipping = (phase === 'flip' || phase === 'revive') && shown && shown.pile === i;

      // the pile's depth, as a few blank cards stepped behind the top one
      var depth = Math.min(cards.length, 5);
      fb.dim(b.x + (depth - 1) * 2 + 3, b.y + (depth - 1) * 2 + 4, CARD_W, CARD_H, 0.55);
      for (var d = depth - 1; d >= 1; d--) {
        fb.rect(b.x + d * 2, b.y + d * 2, CARD_W, CARD_H, P2.ink);
        fb.rect(b.x + d * 2 + 1, b.y + d * 2 + 1, CARD_W - 2, CARD_H - 2, P2.linen);
      }

      if (flipping) {
        var t = 1 - phaseT / FLIP_MS;
        var wNow = Math.round(CARD_W * Math.abs(Math.cos(t * Math.PI)));
        var showBack = phase === 'flip' ? (t > 0.5) : (t <= 0.5);
        fb.cardEdge(b.x + (CARD_W >> 1), b.y, wNow, CARD_H,
                    showBack ? P2.backA : P2.linen, P2);
        return;
      }

      // while a card is in the air the pile still shows what it showed before
      var top = dealing ? cards[cards.length - 2] : cards[cards.length - 1];
      if (top == null) return;
      if (pile.alive || dealing || holding) {
        cardFace(fb, b.x, b.y, CARD_W, CARD_H,
                 HiLo.rankChar(top), HiLo.suitChar(top), P2);
      } else {
        cardBack(fb, b.x, b.y, CARD_W, CARD_H, P2);
        fb.dim(b.x, b.y, CARD_W, CARD_H, 0.62);
      }

      // the pile under consideration, keylined in the setting's accent
      if (g.selected === i && (phase === 'select' || phase === 'call')) {
        fb.frame(b.x - 3, b.y - 3, CARD_W + 6, CARD_H + 6, P2.ink);
        fb.frame(b.x - 2, b.y - 2, CARD_W + 4, CARD_H + 4, P2.pick);
        fb.frame(b.x - 1, b.y - 1, CARD_W + 2, CARD_H + 2, P2.pick);
      }
    }

    function hud(str, x, y, col, P2) {
      fb.text(str, x + 1, y + 1, P2.hudShadow);
      fb.text(str, x, y, col || P2.hudInk);
    }

    /* app.js's button(), with the bot's choice standing in for the cursor. */
    function button(x, y, w, label, hot, on, P2) {
      fb.rect(x, y, w, BTN_H, hot ? P2.hudInk : P2.hudShadow);
      fb.frame(x, y, w, BTN_H, on ? P2.hudInk : P2.hudDim);
      fb.text(label, x + ((w - fb.textW(label, 1)) >> 1), y + 6,
              hot ? P2.hudShadow : (on ? P2.hudInk : P2.hudDim));
    }

    function drawCalls(P2) {
      var on = g.selected >= 0;
      var picked = (phase === 'call' && pending) ? pending.call : null;
      var names = ['HI', 'LO', 'SPLIT'];
      var i, x, y;

      if (g.phase === 'RESURRECT') {
        var m = 'SPLIT - REVIVE A PILE';
        if (beside) {
          hud('SPLIT', geo.cx + ((SIDE_W - fb.textW('SPLIT', 1)) >> 1), geo.cy + 25, P2.hudInk, P2);
          hud('REVIVE A PILE', geo.cx + ((SIDE_W - fb.textW('REVIVE A PILE', 1)) >> 1),
              geo.cy + 38, P2.hudInk, P2);
        } else {
          hud(m, (W - fb.textW(m, 1)) >> 1, geo.by + boardH + 19, P2.hudInk, P2);
        }
        return;
      }

      if (beside) {
        for (i = 0; i < 3; i++) {
          button(geo.cx, geo.cy + i * (BTN_H + BTN_GAP), SIDE_W, names[i],
                 picked === names[i], on, P2);
        }
        if (!on) {
          hud('PICK A PILE', geo.cx + ((SIDE_W - fb.textW('PICK A PILE', 1)) >> 1),
              geo.cy - 13, P2.hudDim, P2);
        }
        return;
      }

      var wid = [40, 40, 54], tot = wid[0] + wid[1] + wid[2] + 14;
      x = (W - tot) >> 1; y = geo.by + boardH + 14;
      var offs = [0, wid[0] + 7, wid[0] + wid[1] + 14];
      for (i = 0; i < 3; i++) {
        button(x + offs[i], y, wid[i], names[i], picked === names[i], on, P2);
      }
      if (!on) {
        hud('PICK A PILE', (W - fb.textW('PICK A PILE', 1)) >> 1, y + 24, P2.hudDim, P2);
      }
    }

    function drawStock(P2) {
      var left = HiLo.stockLeft(g);
      if (!beside) {                      // a small corner tally, as the game does
        var s = String(left) + ' LEFT';
        hud(s, W - fb.textW(s, 1) - 6, 6, P2.hudDim, P2);
        return;
      }
      fb.dim(geo.sx + 3, geo.sy + 4, CARD_W, CARD_H, 0.55);
      if (left > 0) cardBack(fb, geo.sx, geo.sy, CARD_W, CARD_H, P2);
      else fb.frame(geo.sx, geo.sy, CARD_W, CARD_H, P2.hudDim);

      var sc = String(left);
      var tw = fb.textW(sc + ' ', 1) + 1 + fb.textW('LEFT', 1);
      var tx = geo.sx + ((CARD_W - tw) >> 1);
      hud(sc, tx, geo.sy - 11, P2.hudInk, P2);
      hud('LEFT', tx + fb.textW(sc + ' ', 1) + 1, geo.sy - 11, P2.hudDim, P2);
    }

    function drawGame(P2) {
      if (!g || !geo) return;
      for (var i = 0; i < g.size; i++) drawPile(i, P2);
      drawStock(P2);
      drawCalls(P2);

      // the card on its way from the stock to the pile
      if (phase === 'deal' && shown) {
        var t = 1 - phaseT / DEAL_MS, e = t * t * (3 - 2 * t);
        var to = pileBox(shown.pile);
        var fx = beside ? geo.sx : W - CARD_W - 8;
        var fy = beside ? geo.sy : 8;
        var ax = Math.round(fx + (to.x - fx) * e);
        var ay = Math.round(fy + (to.y - fy) * e);
        fb.dim(ax + 3, ay + 4, CARD_W, CARD_H, 0.55);
        cardFace(fb, ax, ay, CARD_W, CARD_H,
                 HiLo.rankChar(shown.card), HiLo.suitChar(shown.card), P2);
      }

      if (phase === 'over') {
        var head = g.phase === 'WON' ? 'CLEARED' : 'OUT';
        var k = W >= 300 ? 2 : 1;
        fb.dim(0, 0, W, H, 0.5);
        fb.textBig(head, Math.round((W - fb.textW(head, k)) / 2),
                   Math.round(H / 2 - 5 * k), P2.hudShadow, k);
        fb.textBig(head, Math.round((W - fb.textW(head, k)) / 2) - 1,
                   Math.round(H / 2 - 5 * k) - 1, P2.hudInk, k);
      }
    }

    function frame(dt) {
      if (!fb) return;

      // the setting gives way on its own clock, independent of the game
      sceneT += dt;
      if (nextScene < 0 && sceneT >= SCENE_MS && SCENES.length > 1) {
        nextScene = (scene + 1) % SCENES.length;
        fadeT = 0;
      }
      if (nextScene >= 0) {
        fadeT += dt;
        if (fadeT >= FADE_MS) {
          scene = nextScene; nextScene = -1; sceneT = 0;
          if (opts.onScene) opts.onScene(SCENES[scene].name);
        }
      }

      var a = sceneBytes(scene);
      if (nextScene >= 0) {
        var b2 = sceneBytes(nextScene), f = fadeT / FADE_MS, d = fb.d;
        for (var i = 0; i < d.length; i++) d[i] = a[i] + (b2[i] - a[i]) * f;
      } else {
        fb.d.set(a);
      }

      phaseT -= dt;
      if (phaseT <= 0) step();

      drawGame(pal());

      if (hover) {
        /* A light veil on purpose — you should still see the board you are
           about to click. The mark carries itself on its own ring. */
        fb.dim(0, 0, W, H, 0.62);
        var wk = Math.max(1, Math.min(4, Math.round(W / 150)));
        wordmark(fb, (W - wordmarkW(wk)) >> 1, (H - WM_TALL * wk) >> 1, wk,
                 pal().hudShadow);
      }

      var img = ctx.createImageData(W, H);
      img.data.set(fb.d);
      ctx.putImageData(img, 0, 0);
    }

    var last = 0, raf = null;
    function loop(t) {
      raf = global.requestAnimationFrame(loop);
      var dt = last ? t - last : 16;
      last = t;
      if (dt > 250) dt = 250;              // a backgrounded tab must not lurch
      frame(dt);
    }

    function start() {
      if (running || !resize()) return;
      running = true;
      newGame();
      /* Reduced motion still gets a board and a setting — it simply does not
         animate through them. */
      if (global.matchMedia &&
          global.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        phase = 'start'; phaseT = 1e9;
        frame(0);
        return;
      }
      raf = global.requestAnimationFrame(loop);
    }

    function setHover(v) { hover = v; }

    var rt = null;
    function refit() {
      clearTimeout(rt);
      rt = setTimeout(function () { resize(); }, 140);
    }
    global.addEventListener('resize', refit);

    /* The pane is a grid item inside a flex column, and its height settles a
       beat after the first paint. Watching the box is more reliable than
       measuring once and hoping. */
    if (typeof ResizeObserver === 'function' && canvas.parentNode) {
      new ResizeObserver(refit).observe(canvas.parentNode);
    }

    /* A teaser has no business animating in a tab nobody is looking at. */
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.hidden) {
        if (raf) { global.cancelAnimationFrame(raf); raf = null; }
      } else if (running && !raf) {
        last = 0;
        raf = global.requestAnimationFrame(loop);
      }
    });

    return {
      start: start, setHover: setHover,
      name: function () { return SCENES[scene].name; }
    };
  }

  global.HiLoTeaser = { make: make };
})(window);
