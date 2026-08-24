/* The Hi Lo teaser: the game playing itself, in a setting that keeps changing.

   Same principle as the Cento block beside it — the preview is the actual
   thing rather than a picture of it. This runs the real rules engine, the real
   renderer and the real palettes, so what the front page shows is a genuine
   game being played, down to the pixel. Nothing here decides anything about
   the rules; `game.js` does, exactly as it does for a player.

   The bot counts cards. It is not there to win, it is there to look like
   someone who knows the game — which mostly means never making a call the
   board says is worse than another one available. */
(function (global) {
  'use strict';

  var SCALE = 2;                 // integer only — the art has no in-between

  /* Beats, in ms. Slow enough to follow out of the corner of an eye, quick
     enough that a whole game passes while someone reads the weave. */
  var T_SELECT = 320, T_CALL = 380, T_DEAL = 460, T_RESULT = 620,
      T_REVIVE = 620, T_OVER = 2000, T_START = 500;

  var SCENE_MS = 11000;          // how long a setting holds
  var FADE_MS  = 900;            // and how long it takes to give way

  function make(canvas, opts) {
    /* The front page loads four files to run this. If any of them is missing
       the teaser simply does not appear — a preview is never worth taking a
       page down for. */
    if (!canvas || typeof FB !== 'function' || typeof drawScene !== 'function' ||
        typeof HiLo === 'undefined' || typeof SCENES === 'undefined') return null;

    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var COLS = opts.cols || 3, ROWS = opts.rows || 2;

    var scene = opts.scene != null ? opts.scene
                                   : (Math.random() * SCENES.length) | 0;
    var nextScene = -1, fadeT = 0, sceneT = 0;
    var fb = null, W = 0, H = 0;
    var hover = false, running = false;

    /* Each setting is drawn once per size and kept — the backdrop does not
       change between frames, and re-running drawScene every frame would spend
       the whole budget on a still image. */
    var cache = [];

    var g = null, phase = '', phaseT = 0, pending = null, lastMove = null;

    // ── the deck the bot reasons about ────────────────────────────────
    var DECK_VALS = (function () {
      var v = [];
      for (var c = 0; c < 52; c++) v.push(HiLo.value(c));
      return v;
    })();

    /* What is left, from what has been shown. Every card sitting on a pile has
       been face up at some point, so this is what a player watching could know
       — the bot gets no look at the stock. */
    function remaining(state) {
      var counts = {}, i, j, v;
      for (i = 0; i < DECK_VALS.length; i++) {
        v = DECK_VALS[i];
        counts[v] = (counts[v] || 0) + 1;
      }
      for (i = 0; i < state.size; i++) {
        var cards = state.piles[i].cards;
        for (j = 0; j < cards.length; j++) counts[HiLo.value(cards[j])]--;
      }
      return counts;
    }

    /* Pick the (pile, call) with the best chance. A made Split is worth a
       shade more than its odds because it buys a pile back, so it takes ties
       rather than losing them. */
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
          var p = cand[k][1] / total;
          var score = p + (cand[k][0] === 'SPLIT' ? 0.02 : 0);
          if (!best || score > best.score) {
            best = { pile: i, call: cand[k][0], score: score, p: p };
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

    // ── geometry ──────────────────────────────────────────────────────
    var geo = null;
    function layout() {
      /* The stock sits to the left of the board and stands on its bottom row,
         which is where the game itself puts it (`stockBox` in app.js). The two
         are placed as one block so the pair stays centred — sizing the board
         alone leaves the stock hanging off the edge on a narrow frame. */
      var availH = H * 0.60, availW = W * 0.88;
      var ch = Math.min(CARD_H, (availH - (ROWS - 1) * 6) / ROWS);
      var cw = ch * CARD_W / CARD_H;
      var gap = Math.max(3, cw * 0.12);
      var stockGap = cw * 0.55;
      var wide = COLS * cw + (COLS - 1) * gap + stockGap + cw;
      if (wide > availW) {                       // shrink to fit, keep the ratio
        var s = availW / wide;
        ch *= s; cw *= s; gap *= s; stockGap *= s;
      }
      ch = Math.round(ch); cw = Math.round(cw);
      gap = Math.round(gap); stockGap = Math.round(stockGap);

      var boardW = COLS * cw + (COLS - 1) * gap;
      var boardH = ROWS * ch + (ROWS - 1) * gap;
      var totalW = cw + stockGap + boardW;
      var x0 = Math.round((W - totalW) / 2);
      var by = Math.round(H * 0.58 - boardH / 2);

      geo = {
        cw: cw, ch: ch, gap: gap,
        bx: x0 + cw + stockGap,
        by: by,
        boardW: boardW, boardH: boardH,
        sx: x0,
        sy: by + boardH - ch          // stands on the board's bottom row
      };
    }
    function pileBox(i) {
      var c = i % COLS, r = (i / COLS) | 0;
      return { x: geo.bx + c * (geo.cw + geo.gap),
               y: geo.by + r * (geo.ch + geo.gap),
               w: geo.cw, h: geo.ch };
    }

    function resize() {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      var w = Math.max(120, Math.round(r.width / SCALE));
      var h = Math.max(80, Math.round(r.height / SCALE));
      if (w === W && h === H && fb) return true;
      W = w; H = h;
      canvas.width = W; canvas.height = H;
      canvas.style.width = r.width + 'px';
      canvas.style.height = r.height + 'px';
      fb = new FB(W, H);
      cache = [];
      layout();
      return true;
    }

    /* One rendered setting, kept as raw bytes so a frame is a copy rather than
       a redraw. */
    function sceneBytes(idx) {
      if (!cache[idx]) {
        var t = new FB(W, H);
        drawScene(t, SCENES[idx], W, H);
        cache[idx] = t.d.slice(0);
      }
      return cache[idx];
    }

    // ── the wordmark, standalone ──────────────────────────────────────
    var WM_GAP = 5, WM_OVER = 2, WM_TALL = 11;
    function wordmarkW(k) { return (11 + WM_GAP + 1 + WM_GAP + 11) * k; }
    function wordmark(t, x, y, k, col, shadow) {
      function put(str, sx) {
        t.textBig(str, sx + k, y + k, shadow, k);
        t.textBig(str, sx, y, col, k);
      }
      put('HI', x);
      var rx = x + 11 * k + WM_GAP * k;
      t.rect(rx + k, y - WM_OVER * k + k, k, WM_TALL * k, shadow);
      t.rect(rx, y - WM_OVER * k, k, WM_TALL * k, col);
      put('LO', rx + k + WM_GAP * k);
    }

    // ── the game clock ────────────────────────────────────────────────
    function newGame() {
      g = HiLo.create((Math.random() * 0x7fffffff) | 0, COLS, ROWS, 1);
      lastMove = null;
      go('start', T_START);
    }
    function go(p, d) { phase = p; phaseT = d; }

    function step() {
      if (!g) return newGame();

      if (phase === 'start') {
        pending = think(g);
        if (!pending) return newGame();
        // a one-pile board is already selected for the player, so skip ahead
        return g.selected >= 0 ? go('call', T_CALL) : go('select', T_SELECT);
      }

      if (phase === 'select') {
        if (pending) HiLo.apply(g, { t: 'SELECT', pile: pending.pile });
        return go('call', T_CALL);
      }

      if (phase === 'call') {
        if (!pending) return go('start', 60);
        HiLo.apply(g, { t: 'CALL', call: pending.call });
        lastMove = g.last;
        return go('deal', T_DEAL);
      }

      if (phase === 'deal') return go('result', T_RESULT);

      if (phase === 'result') {
        if (g.phase === 'WON' || g.phase === 'LOST') return go('over', T_OVER);
        if (g.phase === 'RESURRECT') {
          var rv = pickRevive(g);
          if (rv) { HiLo.apply(g, { t: 'REVIVE', pile: rv.pile }); lastMove = null; }
          return go('revive', T_REVIVE);
        }
        return go('start', 60);
      }

      if (phase === 'revive') return go('start', 60);
      return newGame();                                    // 'over', or unknown
    }

    // ── drawing ───────────────────────────────────────────────────────
    function pal() { return SCENES[scene].pal; }

    function drawBoard(P2) {
      if (!g || !geo) return;
      var i, b;

      for (i = 0; i < g.size; i++) {
        b = pileBox(i);
        /* The pile being dealt to holds back its incoming card until the card
           lands, so the flight has somewhere to arrive. */
        var isTarget = (phase === 'deal' && lastMove && lastMove.pile === i);
        var cards = g.piles[i].cards;
        var showIdx = cards.length - 1 - (isTarget ? 1 : 0);
        if (showIdx < 0) continue;
        var card = cards[showIdx];
        var alive = g.piles[i].alive || isTarget;

        var d = Math.max(2, (b.w * 0.06) | 0);
        fb.dim(b.x + d, b.y + d + 1, b.w, b.h, 0.5);
        cardFace(fb, b.x, b.y, b.w, b.h, HiLo.rankChar(card), HiLo.suitChar(card), P2);
        // a dead pile is greyed where it lies, so the board reads at a glance
        if (!alive) fb.dim(b.x, b.y, b.w, b.h, 0.55);
      }

      if (HiLo.stockLeft(g) > 0) cardBack(fb, geo.sx, geo.sy, geo.cw, geo.ch, P2);

      // the pile under consideration
      if (g.selected >= 0 && (phase === 'select' || phase === 'call')) {
        b = pileBox(g.selected);
        fb.frame(b.x - 2, b.y - 2, b.w + 4, b.h + 4, P2.pick);
        fb.frame(b.x - 3, b.y - 3, b.w + 6, b.h + 6, P2.hudShadow);
      }

      function tag(box, s, col) {
        var tw = fb.textW(s, 1);
        var tx = box.x + ((box.w - tw) >> 1), ty = box.y - 11;
        if (ty < 1) ty = box.y + box.h + 3;
        fb.rect(tx - 4, ty - 3, tw + 8, 13, P2.hudShadow);
        fb.text(s, tx, ty, col);
      }

      if (phase === 'call' && pending) tag(pileBox(pending.pile), pending.call, P2.hudInk);

      // the card on its way from the stock to the pile
      if (phase === 'deal' && lastMove) {
        var t = 1 - phaseT / T_DEAL, e = t * t * (3 - 2 * t);
        var to = pileBox(lastMove.pile);
        var ax = Math.round(geo.sx + (to.x - geo.sx) * e);
        var ay = Math.round(geo.sy + (to.y - geo.sy) * e);
        var dd = Math.max(2, (geo.cw * 0.06) | 0);
        fb.dim(ax + dd, ay + dd + 1, geo.cw, geo.ch, 0.55);
        cardFace(fb, ax, ay, geo.cw, geo.ch,
                 HiLo.rankChar(lastMove.card), HiLo.suitChar(lastMove.card), P2);
      }

      if (phase === 'result' && lastMove) {
        tag(pileBox(lastMove.pile),
            lastMove.survived ? (lastMove.wasSplit ? 'SPLIT' : 'GOOD') : 'OUT',
            lastMove.survived ? P2.pick : P2.hudDim);
      }

      if (phase === 'over') {
        var head = g.phase === 'WON' ? 'CLEARED' : 'OUT';
        var k = Math.max(1, Math.min(2, (W / 220) | 0));
        fb.dim(0, 0, W, H, 0.5);
        fb.textBig(head, Math.round((W - fb.textW(head, k)) / 2),
                   Math.round(H / 2 - 5 * k), P2.hudInk, k);
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

      drawBoard(pal());

      if (hover) {
        fb.dim(0, 0, W, H, 0.62);
        var wk = Math.max(1, Math.min(4, Math.round(W / 150)));
        wordmark(fb, (W - wordmarkW(wk)) >> 1, (H - 11 * wk) >> 1, wk,
                 pal().hudInk, pal().hudShadow);
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
      /* Reduced motion still gets a game and a setting — it simply does not
         animate through them. */
      if (global.matchMedia &&
          global.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        phase = 'result'; phaseT = 1e9;
        frame(0);
        return;
      }
      raf = global.requestAnimationFrame(loop);
    }

    function setHover(v) { hover = v; }

    var rt = null;
    global.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { resize(); }, 140);
    });

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
