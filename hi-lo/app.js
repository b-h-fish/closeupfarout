/* ── HI LO · presentation ─────────────────────────────────────────────────
   Everything that is not a rule: layout, drawing, input, animation. The game
   state is owned by game.js and is only ever changed by dispatching an action,
   which is what keeps a future networked game honest — this file can be
   replaced wholesale without touching how the game is decided.
   ──────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var CARD_W = 54, CARD_H = 74, GAP = 5;
  var canvas, ctx, live, fb = null;
  var scale = 2, W = 0, H = 0;

  var screen = 'SETUP';
  var pickC = 3, pickR = 3, pickScene = 1;
  var g = null, fx = null, focus = 0, confirmMenu = false;
  var hits = [], mouse = { x: -1e5, y: -1e5 }, now = 0;

  function pal() { return SCENES[pickScene].pal; }

  /* ── fit ──
     Integer scale only: a pixel has to stay square, or the whole conceit goes.
     The logical canvas then fills the viewport exactly at that scale. */
  function fit() {
    var vw = window.innerWidth, vh = window.innerHeight;
    if (screen === 'SETUP') {
      scale = Math.max(1, Math.min(5, Math.floor(Math.min(vw / 380, vh / 300))));
    } else {
      /* Sized against the grid on the table rather than against a worst-case
         4x4. Holding a 3x3 to the space a 4x4 needs is what made the cards
         small: it was reserving room for six piles that aren't there. */
      var c = g ? g.cols : pickC, r = g ? g.rows : pickR;
      var bw = c*CARD_W + (c-1)*GAP, bh = r*CARD_H + (r-1)*GAP;
      var needW = bw + 2*(CARD_W + 30);      // board, plus the stock beside it
      var needH = bh + 78;                   // plus the calls and the HUD
      scale = Math.max(1, Math.min(6, Math.floor(Math.min(vw / needW, vh / needH))));
    }
    W = Math.max(300, Math.floor(vw / scale));
    H = Math.max(300, Math.floor(vh / scale));
    canvas.width = W; canvas.height = H;
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
    fb = new FB(W, H);
  }

  /* ── layout ── */
  function boardBox() {
    var c = g ? g.cols : pickC, r = g ? g.rows : pickR;
    var bw = c*CARD_W + (c-1)*GAP, bh = r*CARD_H + (r-1)*GAP;
    var blockH = bh + 14 + 18;
    var y = Math.max(18, Math.round((H - blockH) / 2));
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

    var cell = 14, cgap = 4, gwid = 4*cell + 3*cgap;
    var cx = W >> 1, PAD = 20;
    var blockH = 21 + 30 + gwid + 10 + 7 + 18 + 17 + 20 + 20 + 20;
    var top = Math.max(8, Math.round((H - blockH) / 2));

    var pw = Math.min(W - 24, 340), ph = blockH + PAD*2;
    fb.shade(cx - (pw>>1), top - PAD, pw, ph, 0.42);
    fb.frame(cx - (pw>>1), top - PAD, pw, ph, p.hudDim);

    var y = top;
    wordmark(cx - (wordmarkW(3) >> 1), y, 3, p.hudInk);
    y += 21 + 30;

    /* Hovering a cell commits it. The preview used to fall back to the current
       selection whenever the pointer sat in a gap between cells, which read as
       the grid snapping back on its own. */
    var gx = cx - (gwid >> 1), gy = y, r, c;
    for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) {
      var bx = gx + c*(cell+cgap), by = gy + r*(cell+cgap);
      if (mouse.x >= bx && mouse.x < bx+cell && mouse.y >= by && mouse.y < by+cell) {
        pickC = c+1; pickR = r+1;
      }
    }
    for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) {
      var bx2 = gx + c*(cell+cgap), by2 = gy + r*(cell+cgap);
      var lit = (c < pickC && r < pickR);
      fb.rect(bx2, by2, cell, cell, lit ? p.hudInk : p.hudShadow);
      fb.frame(bx2, by2, cell, cell, lit ? p.hudInk : p.hudDim);
      hit(bx2, by2, cell, cell, { t:'grid', c:c+1, r:r+1 });
    }
    y += gwid + 10;

    var lbl = pickC + ' X ' + pickR;
    hud(lbl, cx - (fb.textW(lbl,1) >> 1), y, p.hudInk);
    y += 7 + 18;

    hud('SETTING', cx - (fb.textW('SETTING',1) >> 1), y, p.hudDim);
    y += 17;
    var bw = 100, tot = 3*bw + 2*6, sx = cx - (tot >> 1);
    for (var i = 0; i < SCENES.length; i++) {
      var on = (i === pickScene);
      var bx3 = sx + i*(bw+6);
      var hot = mouse.x >= bx3 && mouse.x < bx3+bw && mouse.y >= y && mouse.y < y+20;
      fb.rect(bx3, y, bw, 20, on || hot ? p.hudInk : p.hudShadow);
      fb.frame(bx3, y, bw, 20, p.hudInk);
      var nm = SCENES[i].name.toUpperCase();
      fb.text(nm, bx3 + ((bw - fb.textW(nm,1)) >> 1), y + 7, on || hot ? p.hudShadow : p.hudInk);
      hit(bx3, y, bw, 20, { t:'scene', i:i });
    }
    y += 20 + 20;

    var dw = 100, dx = cx - (dw>>1);
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
    var flipping = fx && (fx.kind === 'flip' || fx.kind === 'revive') && fx.pile === i;

    // the stack under the top card
    var depth = Math.min(cards.length, 5);
    fb.shade(b.x + (depth-1)*2 + 3, b.y + (depth-1)*2 + 4, CARD_W, CARD_H, 0.55);
    for (var d = depth-1; d >= 1; d--) {
      fb.rect(b.x + d*2, b.y + d*2, CARD_W, CARD_H, p.ink);
      fb.rect(b.x + d*2 + 1, b.y + d*2 + 1, CARD_W-2, CARD_H-2, p.linen);
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
    if (pile.alive || dealing) {
      cardFace(fb, b.x, b.y, CARD_W, CARD_H, HiLo.rankChar(shown), HiLo.suitChar(shown), p);
    } else {
      cardBack(fb, b.x, b.y, CARD_W, CARD_H, p);
      fb.shade(b.x, b.y, CARD_W, CARD_H, 0.62);
    }

    if (g.phase === 'RESURRECT' && !pile.alive && !fx) {
      // glow rather than dim: these are the piles asking to be chosen
      var puls = 0.30 + 0.26 * (Math.sin(now / 180) * 0.5 + 0.5);
      fb.tint(b.x, b.y, CARD_W, CARD_H, p.lit, puls);
      fb.frame(b.x-1, b.y-1, CARD_W+2, CARD_H+2, p.lit);
      fb.frame(b.x-2, b.y-2, CARD_W+4, CARD_H+4, p.lit);
      hit(b.x-2, b.y-2, CARD_W+4, CARD_H+4, { t:'revive', pile:i });
    } else if (g.phase === 'PLAY' && pile.alive && !fx) {
      if (g.selected === i) {
        fb.frame(b.x-1, b.y-1, CARD_W+2, CARD_H+2, p.hudInk);
        fb.frame(b.x-2, b.y-2, CARD_W+4, CARD_H+4, p.hudInk);
      } else if (inside(b) || focus === i) {
        fb.frame(b.x-1, b.y-1, CARD_W+2, CARD_H+2, p.hudDim);
      }
      hit(b.x, b.y, CARD_W, CARD_H, { t:'select', pile:i });
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

    // ── calls ──
    var by = b.y + b.h + 14;
    if (g.phase === 'PLAY' && !fx) {
      var on = g.selected >= 0;
      var wid = [40,40,54], tot = wid[0]+wid[1]+wid[2] + 14, bx = (W - tot) >> 1;
      button(bx, by, wid[0], 'HI', { t:'call', call:'HI' }, on);
      button(bx+wid[0]+7, by, wid[1], 'LO', { t:'call', call:'LO' }, on);
      button(bx+wid[0]+wid[1]+14, by, wid[2], 'SPLIT', { t:'call', call:'SPLIT' }, on);
      if (!on) {
        var m = 'PICK A PILE';
        hud(m, (W - fb.textW(m,1)) >> 1, by + 24, p.hudDim);
      }
    } else if (g.phase === 'RESURRECT' && !fx) {
      var m2 = 'SPLIT - REVIVE A PILE';
      hud(m2, (W - fb.textW(m2,1)) >> 1, by + 5, p.hudInk);
    } else if (g.phase === 'WON' || g.phase === 'LOST') {
      var head = g.phase === 'WON' ? 'CLEARED' : 'OUT';
      hudBig(head, (W - fb.textW(head,2)) >> 1, by - 2, p.hudInk, 2);
      var placed = 52 - HiLo.stockLeft(g);
      var sub = placed + ' OF 52 PLACED';
      hud(sub, (W - fb.textW(sub,1)) >> 1, by + 20, p.hudDim);
      button((W>>1) - 42, by + 34, 84, 'AGAIN', { t:'again' }, true);
    }
  }

  /* Leaving mid-game throws the run away, so it asks first. Drawn last and it
     clears the hit list, so nothing behind it can be clicked by a near miss. */
  function drawConfirm() {
    var p = pal();
    hits.length = 0;
    fb.shade(0, 0, W, H, 0.45);

    var pw = Math.min(W - 20, 210), ph = 64;
    var px = (W - pw) >> 1, py = (H - ph) >> 1;
    fb.rect(px, py, pw, ph, p.hudShadow);
    fb.frame(px, py, pw, ph, p.hudInk);

    var q = 'LEAVE THIS GAME?';
    hud(q, px + ((pw - fb.textW(q,1)) >> 1), py + 14, p.hudInk);

    button(px + 16, py + 33, 76, 'LEAVE', { t:'menu-yes' }, true);
    button(px + pw - 92, py + 33, 76, 'STAY', { t:'menu-no' }, true);
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
    if (g.phase === 'WON')  return say('Cleared the deck. ' + (52 - HiLo.stockLeft(g)) + ' of 52 placed.');
    if (g.phase === 'LOST') return say('Out of piles. ' + (52 - HiLo.stockLeft(g)) + ' of 52 placed.');
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
    fx = { kind:'deal', pile:i, card:card, t:0, dur:320,
           fx: from.big ? from.x : W-40, fy: from.big ? from.y : 10,
           tx: to.x, ty: to.y };
  }

  /* An impatient player should not lose a keystroke to an animation still
     playing. Any input fast-forwards whatever is on screen and is then acted
     on immediately, rather than being swallowed. */
  function flushFx() {
    var guard = 0;
    while (fx && guard++ < 4) { fx.t = fx.dur; endFx(); }
  }

  function endFx() {
    var was = fx; fx = null;
    if (was.kind === 'deal') {
      if (!g.piles[was.pile].alive) { fx = { kind:'flip', pile:was.pile, t:0, dur:260 }; return; }
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
    if (act.t === 'again')    { toMenu(); return; }
    flushFx();
    if (act.t === 'select') { HiLo.apply(g, { t:'SELECT', pile:act.pile }); focus = act.pile; return; }
    if (act.t === 'call')   { doCall(act.call); return; }
    if (act.t === 'revive') {
      HiLo.apply(g, { t:'REVIVE', pile:act.pile });
      fx = { kind:'revive', pile:act.pile, t:0, dur:260 };
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
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  function onMove(e) { var q = toLogical(e); mouse.x = q.x; mouse.y = q.y; }

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
      if (k === 'Enter' || k === ' ') { dispatch({ t:'again' }); e.preventDefault(); }
      return;
    }
    var c = focus % g.cols, r = (focus / g.cols) | 0;
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
