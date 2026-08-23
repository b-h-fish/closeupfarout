/* ── HI LO · presentation ─────────────────────────────────────────────────
   Everything that is not a rule: layout, drawing, input, animation. The game
   state is owned by game.js and is only ever changed by dispatching an action,
   which is what keeps a future networked game honest — this file can be
   replaced wholesale without touching how the game is decided.
   ──────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var CARD_W = 54, CARD_H = 74, GAP = 5;
  var SIDE_W = 88;                       // width of the call column when beside
  var CALLS_W = 40 + 40 + 54 + 14;       // the call row, when they sit beneath
  /* A losing card used to land and flip away in the same breath, which cost
     the player the one look they get at it — and a dead pile's cards are still
     information, both for counting and for choosing what to buy back with a
     Split. It now sits face up for a beat before it turns. */
  var DEAL_MS = 380, HOLD_MS = 800, FLIP_MS = 420;

  var CELL = 24, CGAP = 5;               // grid picker: a cell wants a fingertip
  var GWID = 4*CELL + 3*CGAP;
  /* One row of settings whatever the width, now that they cycle rather than
     all showing at once — so there is a single shape to fit. Asking for more
     height than the panel needs is what leaves the setting visible around it. */
  var SETUP_W = 175, SETUP_H = 330;
  var WORLD_MAX = 3;                     // furthest the setting may be zoomed
  /* Whole steps are too coarse for a phone. Every board has the same shape as
     a card (about 0.74) and a phone is nearer 0.59, so width always binds
     there — and a 4x4 is either 62% of the screen at 1x or off the edge at 2x,
     with nothing in between. Halves fill that gap. A half step alternates one
     and two device pixels in a steady pattern rather than a random one, and on
     a phone's pixel density it isn't visible at all. */
  var STEPS = [1, 1.5, 2, 2.5, 3];

  /* `fine` is only ever passed for a four-column board. Those are the ones a
     phone cannot fit at the next clean step, so they stop well short of the
     edge; every other grid reaches a step that already looks right and is left
     on it. Even then it needs a dense screen: there one logical pixel is four
     or more device pixels, so a fractional scale varies them by one and nobody
     sees it, where on a 1x display the same variation shows in the dithering. */
  function bestStep(needW, needH, vw, vh, fine) {
    if (fine && (window.devicePixelRatio || 1) >= 2) {
      return Math.max(1, Math.min(WORLD_MAX, Math.min(vw / needW, vh / needH)));
    }
    var best = STEPS[0];
    for (var i = 0; i < STEPS.length; i++) {
      if (STEPS[i] > WORLD_MAX) break;
      if (needW * STEPS[i] <= vw && needH * STEPS[i] <= vh) best = STEPS[i];
    }
    return best;
  }
  var canvas, ctx, live, fb = null;
  var scale = 2, W = 0, H = 0;

  var screen = 'SETUP';
  var pickC = 3, pickR = 3, pickScene = 1;
  var g = null, fx = null, focus = 0, confirmMenu = false;
  /* Keyboard focus is only drawn once the keyboard is in use — otherwise
     pile 0 wears a ring from the moment the board is dealt, which reads as
     a selection nobody made. Mirrors :focus-visible. */
  var kbNav = false;
  /* Calls beside the board rather than beneath it. The board's height is what
     limits a tall grid, so moving the UI out of the vertical budget is worth a
     whole scale step. */
  var uiSide = false;
  var hovC = 0, hovR = 0;               // grid cell under the pointer, if any
  var hits = [], mouse = { x: -1e5, y: -1e5 }, now = 0;

  function pal() { return SCENES[pickScene].pal; }

  /* ── fit ──
     Integer scale only: a pixel has to stay square, or the whole conceit goes.
     The logical canvas then fills the viewport exactly at that scale. */
  function fit() {
    var vw = window.innerWidth, vh = window.innerHeight;
    if (screen === 'SETUP') {
      // fine scaling here too: a 14px grid cell was an impossible target for a
      // finger, and the cells only grow if the menu can
      scale = bestStep(SETUP_W, SETUP_H, vw, vh, true);
    } else {
      /* Sized against the grid actually on the table, and laid out whichever of
         two ways leaves the cards bigger: calls stacked beneath the board, or
         calls in a column beside it. Beside costs width — which is plentiful —
         and buys height, which is what a four-row grid runs out of. */
      var c = g ? g.cols : pickC, r = g ? g.rows : pickR;
      var bw = c*CARD_W + (c-1)*GAP, bh = r*CARD_H + (r-1)*GAP;

      /* Three ways to arrange it, richest first. Whichever leaves the biggest
         card wins, and ties go to the earlier — so the calls only move aside
         when that genuinely buys a step, and the deck only leaves the table
         when there is truly no room for it.

         The last arrangement is what makes a phone work: it asks for the board
         and nothing else. The old rule reserved deck width on both sides of a
         board that only ever has a deck on one, and on a narrow screen that
         phantom 160px was enough to force everything down to 1x. */
      /* Because a four-column board is scaled to whatever fits, these margins
         are what set how much of the screen it takes — the board lands on
         bw / (bw + edge) of the width, so 26 leaves four columns at about 90%.
         The side plan's 68 does the same vertically: without it a 4x4 scaled
         right up to the 8 pixels that were only ever there to buy a step, and
         sat against the top and bottom edges. 68 puts it where a 3x4 lands on
         its half step, which is the look to match. The side plan is never
         chosen on a phone — it asks for more width than one has — so this is
         a desktop margin only. */
      var wide = (c === 4), edge = wide ? 26 : 20;
      /* Two by three is the one grid narrow enough to reach a high scale and
         tall enough to then fill the height, which puts its top card right
         under the wordmark. It reserves the HUD in its height budget so it
         settles a step lower when it has to. */
      /* Reserving the HUD cost this grid a whole step — it fell from 2.5 to 2
         with nothing in between. It gets the same continuous scaling the wide
         boards use, so it can settle between steps and keep its size while
         still clearing the wordmark. */
      var tall23 = (c === 2 && r === 3), head = tall23 ? 97 : 64;
      var plans = [
        { side:false, w: Math.max(bw + (CARD_W + 26) + 40, CALLS_W + 24), h: bh + head },
        { side:false, w: Math.max(bw + edge,               CALLS_W + 24), h: bh + head },
        { side:true,  w: bw + (CARD_W + 26) + SIDE_W + 36,                h: bh + 68   }
      ];
      /* Capped, because scale zooms the setting as well as the cards: left
         uncapped, a small grid pushed the world so close that the palms were
         cut off and the water became a wall of dither. */
      scale = 1; uiSide = false;
      for (var pi = 0; pi < plans.length; pi++) {
        var sc = bestStep(plans[pi].w, plans[pi].h, vw, vh, wide || tall23);
        if (sc > scale) { scale = sc; uiSide = plans[pi].side; }
      }
    }
    W = Math.max(120, Math.round(vw / scale));
    H = Math.max(120, Math.round(vh / scale));
    canvas.width = W; canvas.height = H;
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    fb = new FB(W, H);
  }

  /* ── layout ── */
  function boardBox() {
    var c = g ? g.cols : pickC, r = g ? g.rows : pickR;
    var bw = c*CARD_W + (c-1)*GAP, bh = r*CARD_H + (r-1)*GAP;
    var blockH = uiSide ? bh : bh + 14 + 18;
    var y;
    if (!uiSide && c === 2 && r === 3) {
      // centred in the space under the HUD rather than in the whole canvas, so
      // the top card stops sitting against the wordmark
      y = Math.max(18, 30 + Math.round((H - 30 - blockH - 21) / 2));
    } else {
      y = Math.max(uiSide ? 4 : 18, Math.round((H - blockH) / 2));
    }
    // The board is centred on its own, so it lines up with the calls beneath
    // it. The stock is free to sit off to one side.
    var big = (W - bw) / 2 >= CARD_W + 44;
    return { x: Math.round((W - bw) / 2), y: y, w: bw, h: bh, big: big };
  }
  function pileBox(i) {
    var b = boardBox();
    return { x: b.x + (i % g.cols)*(CARD_W+GAP), y: b.y + ((i/g.cols)|0)*(CARD_H+GAP),
             w: CARD_W, h: CARD_H };
  }
  /* The stock gets a real card back beside the board when there is room for it,
     which also gives the deal animation somewhere honest to fly from. */
  function stockBox() {
    var b = boardBox();
    if (b.big) return { x: b.x - CARD_W - 26, y: b.y + b.h - CARD_H, w: CARD_W, h: CARD_H, big: true };
    return { x: W - 30, y: 10, w: 14, h: 19, big: false };
  }

  function hit(x, y, w, h, act) { hits.push({ x:x, y:y, w:w, h:h, act:act }); }
  function inside(r) { return mouse.x >= r.x && mouse.x < r.x+r.w && mouse.y >= r.y && mouse.y < r.y+r.h; }

  function hud(str, x, y, col) {
    var p = pal();
    fb.text(str, x+1, y+1, p.hudShadow);
    fb.text(str, x, y, col || p.hudInk);
  }
  function hudBig(str, x, y, col, k) {
    var p = pal();
    fb.textBig(str, x+k, y+k, p.hudShadow, k);
    fb.textBig(str, x, y, col || p.hudInk, k);
  }

  /* The wordmark is drawn, not typed. Two reasons: a typed space either side
     of the divider is far wider than the mark wants, and a divider set on the
     cap height reads as a second letter I. This rule overshoots the caps top
     and bottom, which no letter does, so it reads as a separator. */
  var WM_GAP = 5, WM_OVER = 2, WM_TALL = 11;
  function wordmarkW(k) { return (11 + WM_GAP + 1 + WM_GAP + 11) * k; }
  function wordmark(x, y, k, col) {
    var p = pal();
    function put(str, sx) {
      fb.textBig(str, sx + k, y + k, p.hudShadow, k);
      fb.textBig(str, sx, y, col, k);
    }
    put('HI', x);
    var rx = x + 11*k + WM_GAP*k;
    fb.rect(rx + k, y - WM_OVER*k + k, k, WM_TALL*k, p.hudShadow);
    fb.rect(rx,     y - WM_OVER*k,     k, WM_TALL*k, col);
    put('LO', rx + k + WM_GAP*k);
  }

  function button(x, y, w, label, act, on) {
    var p = pal();
    var r = { x:x, y:y, w:w, h:18 };
    var hot = on && inside(r);
    fb.rect(x, y, w, 18, hot ? p.hudInk : p.hudShadow);
    fb.frame(x, y, w, 18, on ? p.hudInk : p.hudDim);
    fb.text(label, x + ((w - fb.textW(label,1)) >> 1), y + 6,
            hot ? p.hudShadow : (on ? p.hudInk : p.hudDim));
    if (on) hit(x, y, w, 18, act);
    return r;
  }

  /* ═══ SETUP ═══════════════════════════════════════════════════════════ */

  function drawSetup() {
    var p = pal();
    drawScene(fb, SCENES[pickScene], W, H);

    var cx = W >> 1, PAD = 20;
    // a share of the canvas rather than all of it, so the setting frames it
    var pw = Math.min(Math.round(W * 0.84), 340);
    var blockH = 21 + 20 + GWID + 10 + 7 + 14 + 20 + 16 + 20;
    var ph = blockH + PAD*2;
    var top = Math.max(8, Math.round((H - blockH) / 2));

    fb.shade(cx - (pw>>1), top - PAD, pw, ph, 0.42);
    fb.frame(cx - (pw>>1), top - PAD, pw, ph, p.hudDim);

    var y = top;
    wordmark(cx - (wordmarkW(3) >> 1), y, 3, p.hudInk);
    y += 21 + 20;

    var gx = cx - (GWID >> 1), gy = y, r, c;
    if (!(mouse.x >= gx && mouse.x < gx + GWID && mouse.y >= gy && mouse.y < gy + GWID)) {
      hovC = 0; hovR = 0;
    }
    for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) {
      var bx = gx + c*(CELL+CGAP), by = gy + r*(CELL+CGAP);
      if (mouse.x >= bx && mouse.x < bx+CELL && mouse.y >= by && mouse.y < by+CELL) {
        hovC = c+1; hovR = r+1;
      }
    }
    var shC = hovC || pickC, shR = hovR || pickR;
    var previewing = hovC && (hovC !== pickC || hovR !== pickR);
    for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) {
      var bx2 = gx + c*(CELL+CGAP), by2 = gy + r*(CELL+CGAP);
      var lit = (c < shC && r < shR);
      fb.rect(bx2, by2, CELL, CELL, lit ? (previewing ? p.hudDim : p.hudInk) : p.hudShadow);
      fb.frame(bx2, by2, CELL, CELL, lit ? p.hudInk : p.hudDim);
      // the tappable area takes the gap with it, so there is no dead seam
      hit(bx2 - 2, by2 - 2, CELL + 4, CELL + 4, { t:'grid', c:c+1, r:r+1 });
    }
    y += GWID + 10;

    var lbl = shC + ' X ' + shR;
    hud(lbl, cx - (fb.textW(lbl,1) >> 1), y, p.hudInk);
    y += 7 + 14;

    /* The settings cycle rather than all showing at once: one row holds any
       number of them, and the panel does not have to grow to add more. */
    var rowW = Math.min(pw - 28, 210), rx = cx - (rowW >> 1), aw = 22;
    var n = SCENES.length;

    function arrow(ax, glyph, to) {
      var on = mouse.x >= ax && mouse.x < ax+aw && mouse.y >= y && mouse.y < y+20;
      fb.rect(ax, y, aw, 20, on ? p.hudInk : p.hudShadow);
      fb.frame(ax, y, aw, 20, p.hudInk);
      fb.text(glyph, ax + ((aw - 5) >> 1), y + 7, on ? p.hudShadow : p.hudInk);
      hit(ax, y, aw, 20, { t:'scene', i:to });
    }
    arrow(rx, '<', (pickScene + n - 1) % n);
    arrow(rx + rowW - aw, '>', (pickScene + 1) % n);

    var nx = rx + aw + 6, nw = rowW - 2*(aw + 6);
    fb.rect(nx, y, nw, 20, p.hudShadow);
    fb.frame(nx, y, nw, 20, p.hudDim);
    var nm = SCENES[pickScene].name.toUpperCase();
    fb.text(nm, nx + ((nw - fb.textW(nm,1)) >> 1), y + 7, p.hudInk);
    y += 20 + 16;

    var dw = Math.min(120, pw - 40), dx = cx - (dw>>1);
    var dhot = mouse.x >= dx && mouse.x < dx+dw && mouse.y >= y && mouse.y < y+20;
    fb.rect(dx, y, dw, 20, dhot ? p.hudInk : p.hudShadow);
    fb.frame(dx, y, dw, 20, p.hudInk);
    fb.text('DEAL', dx + ((dw - fb.textW('DEAL',1)) >> 1), y + 7, dhot ? p.hudShadow : p.hudInk);
    hit(dx, y, dw, 20, { t:'deal' });
  }

  /* ═══ GAME ════════════════════════════════════════════════════════════ */

  function drawPile(i) {
    var p = pal(), b = pileBox(i), pile = g.piles[i];
    var cards = pile.cards;
    var dealing = fx && fx.kind === 'deal' && fx.pile === i;
    var holding = fx && fx.kind === 'hold' && fx.pile === i;
    var flipping = fx && (fx.kind === 'flip' || fx.kind === 'revive') && fx.pile === i;

    /* A chosen pile is keylined in the setting's accent. A cream frame on a
       cream card read as a slightly thicker edge rather than as a state. */
    var sel = (g.phase === 'PLAY' && g.selected === i && !fx && g.size > 1);
    var ly = b.y;

    var depth = Math.min(cards.length, 5);
    fb.shade(b.x + (depth-1)*2 + 3, b.y + (depth-1)*2 + 4, CARD_W, CARD_H, 0.55);
    for (var d = depth-1; d >= 1; d--) {
      fb.rect(b.x + d*2, ly + d*2, CARD_W, CARD_H, p.ink);
      fb.rect(b.x + d*2 + 1, ly + d*2 + 1, CARD_W-2, CARD_H-2, p.linen);
    }

    if (flipping) {
      var t = fx.t / fx.dur;
      var wNow = Math.round(CARD_W * Math.abs(Math.cos(t * Math.PI)));
      var showBack = fx.kind === 'flip' ? (t > 0.5) : (t <= 0.5);
      fb.cardEdge(b.x + (CARD_W>>1), b.y, wNow, CARD_H, showBack ? p.backA : p.linen, p);
      return;
    }

    // While a card is in the air the pile still shows what it showed before.
    var shown = dealing ? cards[cards.length-2] : cards[cards.length-1];
    if (pile.alive || dealing || holding) {
      cardFace(fb, b.x, ly, CARD_W, CARD_H, HiLo.rankChar(shown), HiLo.suitChar(shown), p);
    } else {
      cardBack(fb, b.x, ly, CARD_W, CARD_H, p);
      fb.shade(b.x, ly, CARD_W, CARD_H, 0.62);
    }

    if (g.phase === 'RESURRECT' && !pile.alive && !fx) {
      // glow rather than dim: these are the piles asking to be chosen
      var puls = 0.30 + 0.26 * (Math.sin(now / 180) * 0.5 + 0.5);
      fb.tint(b.x, ly, CARD_W, CARD_H, p.lit, puls);
      fb.frame(b.x-1, ly-1, CARD_W+2, CARD_H+2, p.lit);
      fb.frame(b.x-2, ly-2, CARD_W+4, CARD_H+4, p.lit);
      hit(b.x-2, ly-2, CARD_W+4, CARD_H+4, { t:'revive', pile:i });
    } else if (g.phase === 'PLAY' && pile.alive && !fx) {
      if (sel) {
        // dark keyline under the accent so it holds on a bright setting too
        fb.frame(b.x-3, ly-3, CARD_W+6, CARD_H+6, p.ink);
        fb.frame(b.x-2, ly-2, CARD_W+4, CARD_H+4, p.pick);
        fb.frame(b.x-1, ly-1, CARD_W+2, CARD_H+2, p.pick);
      } else if (inside(b) || (kbNav && focus === i)) {
        fb.frame(b.x-1, ly-1, CARD_W+2, CARD_H+2, p.hudDim);
      }
      hit(b.x, ly, CARD_W, CARD_H, { t:'select', pile:i });
    }
  }

  function drawGame() {
    var p = pal();
    drawScene(fb, SCENES[pickScene], W, H);

    var b = boardBox(), i;
    for (i = 0; i < g.size; i++) drawPile(i);

    // ── stock ──
    var s = stockBox();
    if (s.big) {
      fb.shade(s.x+3, s.y+4, CARD_W, CARD_H, 0.55);
      if (HiLo.stockLeft(g) > 0) cardBack(fb, s.x, s.y, CARD_W, CARD_H, p);
      else { fb.frame(s.x, s.y, CARD_W, CARD_H, p.hudDim); }
      if (g.phase === 'PLAY' || g.phase === 'RESURRECT') {
        // above the deck now that it sits low, so the count stays clear of the
        // call buttons on a narrow board
        var sc = String(HiLo.stockLeft(g));
        hud(sc, s.x + ((CARD_W - fb.textW(sc,1)) >> 1), s.y - 21, p.hudInk);
        hud('LEFT', s.x + ((CARD_W - fb.textW('LEFT',1)) >> 1), s.y - 11, p.hudDim);
      }
    }

    // ── HUD ──
    // The wordmark is the way back to the menu. Nothing else lives up here:
    // the stock count is already under the deck, and how many piles are alive
    // is plain from the board.
    var wmW = wordmarkW(1), wmR = { x: 6, y: 6, w: wmW + 12, h: 21 };
    if (inside(wmR)) {
      fb.rect(wmR.x, wmR.y, wmR.w, wmR.h, p.hudShadow);
      fb.frame(wmR.x, wmR.y, wmR.w, wmR.h, p.hudInk);
    }
    wordmark(wmR.x + 6, wmR.y + 7, 1, p.hudInk);
    hit(wmR.x, wmR.y, wmR.w, wmR.h, { t:'menu' });

    // On a viewport too narrow for the stock to sit beside the board, the count
    // has nowhere else to go.
    if (!s.big && (g.phase === 'PLAY' || g.phase === 'RESURRECT')) {
      var sl = HiLo.stockLeft(g) + ' LEFT';
      hud(sl, W - 9 - fb.textW(sl,1), 10, p.hudDim);
    }

    // ── the card in the air ──
    if (fx && fx.kind === 'deal') {
      var t = fx.t / fx.dur, e = t*t*(3-2*t);
      var ax = Math.round(fx.fx + (fx.tx - fx.fx) * e);
      var ay = Math.round(fx.fy + (fx.ty - fx.fy) * e);
      fb.shade(ax+3, ay+4, CARD_W, CARD_H, 0.55);
      cardFace(fb, ax, ay, CARD_W, CARD_H, HiLo.rankChar(fx.card), HiLo.suitChar(fx.card), p);
    }

    if (g.phase === 'WON' || g.phase === 'LOST') drawResult();
    else if (!fx) drawCalls(b);
  }

  /* The calls, in whichever place the layout put them. */
  function drawCalls(b) {
    var p = pal(), on = g.selected >= 0;
    var resurrecting = (g.phase === 'RESURRECT');

    if (uiSide) {
      var cw = SIDE_W, ch = 18, gp = 8, stackH = 3*ch + 2*gp;
      var cx = b.x + b.w + 26;
      // Bottom-aligned with the board, mirroring the deck on the other side.
      var cy = b.y + b.h - stackH;
      var mid = function (str) { return cx + ((cw - fb.textW(str,1)) >> 1); };
      if (resurrecting) {
        hud('SPLIT', mid('SPLIT'), cy + 25, p.hudInk);
        hud('REVIVE A PILE', mid('REVIVE A PILE'), cy + 38, p.hudInk);
        return;
      }
      button(cx, cy, cw, 'HI', { t:'call', call:'HI' }, on);
      button(cx, cy + ch + gp, cw, 'LO', { t:'call', call:'LO' }, on);
      button(cx, cy + 2*(ch + gp), cw, 'SPLIT', { t:'call', call:'SPLIT' }, on);
      if (!on) hud('PICK A PILE', mid('PICK A PILE'), cy - 13, p.hudDim);
      return;
    }

    var by = b.y + b.h + 14;
    if (resurrecting) {
      var m2 = 'SPLIT - REVIVE A PILE';
      hud(m2, (W - fb.textW(m2,1)) >> 1, by + 5, p.hudInk);
      return;
    }
    var wid = [40,40,54], tot = wid[0]+wid[1]+wid[2] + 14, bx = (W - tot) >> 1;
    button(bx, by, wid[0], 'HI', { t:'call', call:'HI' }, on);
    button(bx+wid[0]+7, by, wid[1], 'LO', { t:'call', call:'LO' }, on);
    button(bx+wid[0]+wid[1]+14, by, wid[2], 'SPLIT', { t:'call', call:'SPLIT' }, on);
    if (!on) {
      var m = 'PICK A PILE';
      hud(m, (W - fb.textW(m,1)) >> 1, by + 24, p.hudDim);
    }
  }

  /* The result reads as a card laid over the table, so it does not have to fit
     whichever gap the layout happened to leave. */
  function drawResult() {
    var p = pal();
    fb.shade(0, 0, W, H, 0.45);
    var head = g.phase === 'WON' ? 'CLEARED' : 'OUT';
    var left = HiLo.stockLeft(g);
    var tight = (W - 16) < 150;
    var sub = tight ? (left + ' LEFT')
                    : (left + (left === 1 ? ' CARD REMAINING' : ' CARDS REMAINING'));
    var bw = 84;
    var cw = Math.max(fb.textW(head,2), fb.textW(sub,1), bw);
    var pw = Math.min(W - 16, cw + 28), ph = 74;
    var px = (W - pw) >> 1, py = (H - ph) >> 1;

    fb.rect(px, py, pw, ph, p.hudShadow);
    fb.frame(px, py, pw, ph, p.hudInk);
    hudBig(head, px + ((pw - fb.textW(head,2)) >> 1), py + 12, p.hudInk, 2);
    hud(sub, px + ((pw - fb.textW(sub,1)) >> 1), py + 34, p.hudDim);
    button(px + ((pw - bw) >> 1), py + 48, bw, 'AGAIN', { t:'replay' }, true);
  }

  /* Leaving mid-game throws the run away, so it asks first. Drawn last and it
     clears the hit list, so nothing behind it can be clicked by a near miss. */
  function drawConfirm() {
    var p = pal();
    hits.length = 0;
    fb.shade(0, 0, W, H, 0.45);

    /* Both panels measure their own contents. They are laid out in logical
       units, and a small grid runs at a higher scale — so the canvas is
       narrower in those units and a fixed width filled it edge to edge. When
       there isn't room for two buttons abreast they stack and the warning
       wraps, rather than the panel squeezing its own text. */
    var q = 'LEAVE THIS GAME?';
    var stack = W < 250;   // two abreast only when the panel can stay well inside
    var lines = stack ? ['THIS RUN WILL', 'BE LOST'] : ['THIS RUN WILL BE LOST'];
    var bw = stack ? 92 : 76, bh = 18, gap = 8;

    var cw = Math.max(fb.textW(q, 1), stack ? bw : bw*2 + gap);
    for (var i = 0; i < lines.length; i++) cw = Math.max(cw, fb.textW(lines[i], 1));

    var pw = Math.min(W - 16, cw + 28);
    var btnTop = 27 + lines.length * 12 + 8;
    var btnH = stack ? (bh*2 + gap) : bh;
    var ph = btnTop + btnH + 14;
    var px = (W - pw) >> 1, py = (H - ph) >> 1;

    fb.rect(px, py, pw, ph, p.hudShadow);
    fb.frame(px, py, pw, ph, p.hudInk);

    hud(q, px + ((pw - fb.textW(q,1)) >> 1), py + 14, p.hudInk);
    for (i = 0; i < lines.length; i++) {
      hud(lines[i], px + ((pw - fb.textW(lines[i],1)) >> 1), py + 27 + i*12, p.hudDim);
    }

    var by = py + btnTop;
    if (stack) {
      var bx = px + ((pw - bw) >> 1);
      button(bx, by, bw, 'LEAVE', { t:'menu-yes' }, true);
      button(bx, by + bh + gap, bw, 'STAY', { t:'menu-no' }, true);
    } else {
      button(px + ((pw - (bw*2 + gap)) >> 1), by, bw, 'LEAVE', { t:'menu-yes' }, true);
      button(px + ((pw - (bw*2 + gap)) >> 1) + bw + gap, by, bw, 'STAY', { t:'menu-no' }, true);
    }
  }

  /* ═══ ACTIONS ═════════════════════════════════════════════════════════ */

  function say(msg) { if (live) live.textContent = msg; }

  function toMenu() {
    screen = 'SETUP'; g = null; fx = null; confirmMenu = false;
    fit();
    if (history.replaceState) history.replaceState(null, '', location.pathname);
    say('Hi Lo. Choose a grid size and a setting, then deal.');
  }

  function describe() {
    if (!g) return;
    var rem = HiLo.stockLeft(g);
    var remTxt = rem + (rem === 1 ? ' card remaining.' : ' cards remaining.');
    if (g.phase === 'WON')  return say('Cleared the deck. ' + remTxt);
    if (g.phase === 'LOST') return say('Out of piles. ' + remTxt);
    if (g.phase === 'RESURRECT') return say('Split made. Choose a dead pile to revive.');
    var l = g.last, said = '';
    if (l) {
      var SUITNAME = { S:'spades', H:'hearts', D:'diamonds', C:'clubs' };
      var RANKNAME = { A:'ace', T:'ten', J:'jack', Q:'queen', K:'king' };
      var rc = HiLo.rankChar(l.card);
      said = (RANKNAME[rc] || rc) + ' of ' + SUITNAME[HiLo.suitChar(l.card)] + ', ' +
             (l.survived ? 'good call. ' : 'pile lost. ');
    }
    say(said + HiLo.stockLeft(g) + ' left, ' + HiLo.aliveCount(g) + ' of ' + g.size + ' alive.');
  }

  function doCall(call) {
    if (fx || !g || g.phase !== 'PLAY' || g.selected < 0) return;
    var i = g.selected, card = g.deck[g.next];
    var from = stockBox(), to = pileBox(i);
    HiLo.apply(g, { t:'CALL', call:call });
    fx = { kind:'deal', pile:i, card:card, t:0, dur:DEAL_MS,
           fx: from.big ? from.x : W-40, fy: from.big ? from.y : 10,
           tx: to.x, ty: to.y };
  }

  /* An impatient player should not lose a keystroke to an animation still
     playing. Any input fast-forwards whatever is on screen and is then acted
     on immediately, rather than being swallowed. */
  function flushFx() {
    var guard = 0;
    while (fx && guard++ < 6) { fx.t = fx.dur; endFx(); }
  }

  function endFx() {
    var was = fx; fx = null;
    if (was.kind === 'deal' && !g.piles[was.pile].alive) {
      // a beat with the losing card still face up, before it turns over
      fx = { kind:'hold', pile:was.pile, t:0, dur:HOLD_MS };
      return;
    }
    if (was.kind === 'hold') {
      fx = { kind:'flip', pile:was.pile, t:0, dur:FLIP_MS };
      return;
    }
    describe();
  }

  function dispatch(act) {
    if (!act) return;
    if (act.t === 'grid')  { pickC = act.c; pickR = act.r; return; }
    if (act.t === 'scene') { pickScene = act.i; return; }
    if (act.t === 'deal')  {
      begin((Math.random() * 0x7fffffff) | 0);
      return;
    }
    if (act.t === 'menu') {
      // nothing to lose once the run has ended
      if (g && (g.phase === 'PLAY' || g.phase === 'RESURRECT')) {
        confirmMenu = true;
        say('Leave this game? This run will be lost.');
        return;
      }
      toMenu(); return;
    }
    if (act.t === 'menu-yes') { toMenu(); return; }
    if (act.t === 'menu-no')  { confirmMenu = false; describe(); return; }
    if (act.t === 'replay') {
      // same grid and setting, a fresh shuffle. The board is the authority on
      // the grid, not the menu picks, which a seeded link may have moved.
      if (g) { pickC = g.cols; pickR = g.rows; }
      begin((Math.random() * 0x7fffffff) | 0);
      return;
    }
    flushFx();
    if (act.t === 'select') { HiLo.apply(g, { t:'SELECT', pile:act.pile }); focus = act.pile; return; }
    if (act.t === 'call')   { doCall(act.call); return; }
    if (act.t === 'revive') {
      HiLo.apply(g, { t:'REVIVE', pile:act.pile });
      fx = { kind:'revive', pile:act.pile, t:0, dur:FLIP_MS };
      return;
    }
  }

  /* Start a deal, and put it in the address bar. The seed plus the grid is the
     whole deal, so the URL is a shareable "play this exact one" — and it is the
     same handle a live game between friends will use to agree on a deck. */
  function begin(seed) {
    g = HiLo.create(seed, pickC, pickR, 1);
    screen = 'GAME'; focus = 0; fx = null;
    fit();
    if (history.replaceState) {
      history.replaceState(null, '', location.pathname +
        '?seed=' + seed + '&grid=' + pickC + 'x' + pickR + '&scene=' + pickScene);
    }
    say('Dealt ' + g.cols + ' by ' + g.rows + '. ' + HiLo.stockLeft(g) + ' cards in stock.');
  }

  /* ═══ INPUT ═══════════════════════════════════════════════════════════ */

  function toLogical(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width,
             y: (e.clientY - r.top)  * H / r.height };
  }

  function onMove(e) { var q = toLogical(e); mouse.x = q.x; mouse.y = q.y; kbNav = false; }

  function onDown(e) {
    var q = toLogical(e); mouse.x = q.x; mouse.y = q.y;
    if (fx) { flushFx(); return; }   // first click settles the board, next one acts
    for (var i = hits.length - 1; i >= 0; i--) {
      var h = hits[i];
      if (q.x >= h.x && q.x < h.x+h.w && q.y >= h.y && q.y < h.y+h.h) { dispatch(h.act); return; }
    }
  }

  function onKey(e) {
    var k = e.key;
    if (screen === 'SETUP') {
      if (k === 'Enter' || k === ' ') { dispatch({ t:'deal' }); e.preventDefault(); }
      else if (k === 'ArrowRight') pickC = Math.min(4, pickC+1);
      else if (k === 'ArrowLeft')  pickC = Math.max(1, pickC-1);
      else if (k === 'ArrowDown')  pickR = Math.min(4, pickR+1);
      else if (k === 'ArrowUp')    pickR = Math.max(1, pickR-1);
      else if (k === 's' || k === 'S') pickScene = (pickScene+1) % SCENES.length;
      else return;
      e.preventDefault(); return;
    }
    if (!g) return;
    if (confirmMenu) {
      if (k === 'Enter' || k === ' ') dispatch({ t:'menu-yes' });
      else if (k === 'Escape') dispatch({ t:'menu-no' });
      else return;
      e.preventDefault(); return;
    }
    if (k === 'Escape') { dispatch({ t:'menu' }); e.preventDefault(); return; }
    flushFx();
    if (g.phase === 'WON' || g.phase === 'LOST') {
      if (k === 'Enter' || k === ' ') { dispatch({ t:'replay' }); e.preventDefault(); }
      return;
    }
    var c = focus % g.cols, r = (focus / g.cols) | 0;
    if (/^(Arrow(Right|Left|Down|Up)|Enter| |[hHlLsS])$/.test(k)) kbNav = true;
    if (k === 'ArrowRight') c = Math.min(g.cols-1, c+1);
    else if (k === 'ArrowLeft') c = Math.max(0, c-1);
    else if (k === 'ArrowDown') r = Math.min(g.rows-1, r+1);
    else if (k === 'ArrowUp') r = Math.max(0, r-1);
    else if (k === 'Enter' || k === ' ') {
      if (g.phase === 'RESURRECT') dispatch({ t:'revive', pile:focus });
      else dispatch({ t:'select', pile:focus });
      e.preventDefault(); return;
    }
    else if (k === 'h' || k === 'H') { dispatch({ t:'call', call:'HI' }); return; }
    else if (k === 'l' || k === 'L') { dispatch({ t:'call', call:'LO' }); return; }
    else if (k === 's' || k === 'S') { dispatch({ t:'call', call:'SPLIT' }); return; }
    else return;
    focus = r * g.cols + c;
    e.preventDefault();
  }

  /* ═══ LOOP ════════════════════════════════════════════════════════════ */

  var last = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    var dt = last ? t - last : 16; last = t; now = t;
    if (!(dt > 0)) dt = 16;
    if (dt > 200) dt = 200;

    if (fx) { fx.t += dt; if (fx.t >= fx.dur) endFx(); }

    hits.length = 0;
    if (screen === 'SETUP') drawSetup(); else { drawGame(); if (confirmMenu) drawConfirm(); }

    var img = ctx.createImageData(W, H);
    img.data.set(fb.d);
    ctx.putImageData(img, 0, 0);
  }

  function boot() {
    canvas = document.getElementById('stage');
    ctx = canvas.getContext('2d');
    live = document.getElementById('say');
    fit();

    // A deal can be named in the URL: ?seed=123&grid=3x3&scene=1
    try {
      var q = new URLSearchParams(location.search);
      var mg = /^([1-4])x([1-4])$/i.exec(q.get('grid') || '');
      if (mg) { pickC = +mg[1]; pickR = +mg[2]; }
      var sc = parseInt(q.get('scene'), 10);
      if (sc >= 0 && sc < SCENES.length) pickScene = sc;
      var sd = q.get('seed');
      if (sd !== null && /^\d+$/.test(sd)) begin(parseInt(sd, 10) % 0x7fffffff);
    } catch (e) { /* a malformed link just opens the setup screen */ }

    window.addEventListener('resize', fit);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerleave', function () { mouse.x = mouse.y = -1e5; });
    window.addEventListener('keydown', onKey);
    say('Hi Lo. Choose a grid size and a setting, then deal.');
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
