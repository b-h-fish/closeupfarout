/* ── SPLIT · presentation ─────────────────────────────────────────────────
   Everything that is not a rule: layout, drawing, input, animation. The game
   state is owned by game.js and is only ever changed by dispatching an action,
   which is what keeps a future networked game honest — this file can be
   replaced wholesale without touching how the game is decided.
   ──────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* Sizing lives in layout.js, one row per grid, so a change to one board
     cannot reach another. This file only draws what that decides. */
  var L = HiLoLayout;
  var CARD_W = L.CARD_W, CARD_H = L.CARD_H, GAP = L.GAP;
  var SIDE_W = L.SIDE_W, CALLS_W = L.CALLS_W;
  /* A losing card used to land and flip away in the same breath, which cost
     the player the one look they get at it — and a dead pile's cards are still
     information, both for counting and for choosing what to buy back with a
     Split. It now sits face up for a beat before it turns. */
  var DEAL_MS = 380, HOLD_MS = 740, FLIP_MS = 380;

  /* ── the points, on the pile that earned them ──
     One size, one place. It appears where it stays, holds for a second, and
     goes in a hurry. It used to travel a little on arrival, which read as a
     drift rather than as an arrival — a figure that moves after you have
     started reading it makes you follow it instead.

     Colour carries which call it was, so the four are told apart before the
     digit is read. Fixed hex rather than the setting's palette, for the same
     reason the avatars are: what a Split is worth does not change with the
     time of day. Every one is outlined, which is what lets them sit on card
     stock with no plate behind them — an offset drop shadow leaves two sides
     of every stroke touching the card, and on a court card those sides
     disappear. */
  var POP_HOLD = 1000, POP_FADE = 140;

  /* Sized off the card it lands on rather than fixed at a magnification, so
     a change to the card scale carries the figure with it instead of leaving
     a 3x number on a card that is no longer that size. A 74-unit card gives
     3, which is what this was drawn at, and the figure holds at roughly a
     quarter to a third of the card from 54 units up to 200. Whole numbers
     only — this is pixel art and a fractional enlargement smears every edge
     it has, which is also why the ratio wanders a little between steps. */
  function popK(h) { return Math.max(2, Math.min(8, Math.round(h / 25))); }
  var POP_LIFE = POP_HOLD + POP_FADE;
  var POP_INK = {
    PLACE: hex('#4da6ff'),   // a Hi or a Lo
    SUIT:  hex('#ffd23c'),
    SPLIT: hex('#4fd67a'),
    KILL:  hex('#ff4d5a')
  };
  var POP_EDGE = hex('#140f1c');
  var pops = [];
  /* ?mock=pop keeps four of them on the board, one per kind, re-armed as
     they expire. A pop lasts a second and a third; without this the only way
     to look at one is to play a hand and be quick. */
  var mockPops = false;

  /* What a resolved call paid, read off the same PAYS table the engine scores
     with rather than off literals here — a repriced call must not leave the
     board saying one thing and the scoreboard another. */
  function payFor(last) {
    if (!last || !last.call) return null;
    if (!last.survived)         return { v: HiLo.PAYS.KILL,  kind: 'KILL' };
    if (last.call === 'SPLIT')  return { v: HiLo.PAYS.SPLIT, kind: 'SPLIT' };
    if (last.call === 'SUIT')   return { v: HiLo.PAYS.SUIT,  kind: 'SUIT' };
    return { v: HiLo.PAYS.PLACE, kind: 'PLACE' };
  }

  /* Glyphs a pixel at a time, so the fade can be an ordered dither. There is
     no alpha in this renderer — a pixel is on or it is off — and the Bayer
     table the skies already dissolve through is what stands in for one. */
  function popGlyphs(str, x, y, k, col, keep) {
    for (var i = 0; i < str.length; i++) {
      var gl = GLYPH[str[i]];
      if (!gl) continue;
      for (var j = 0; j < gl.length; j++) {
        var row = gl[j];
        for (var m = 0; m < row.length; m++) {
          if (row[m] === '.') continue;
          var px = x + i * 6 * k + m * k, py = y + j * k;
          if (keep < 1 &&
              BAYER[((py / k) | 0) & 7][((px / k) | 0) & 7] / 64 >= keep) continue;
          fb.rect(px, py, k, k, col);
        }
      }
    }
  }

  function drawPops() {
    for (var i = pops.length - 1; i >= 0; i--) {
      var o = pops[i], age = now - o.at;
      if (age < 0) continue;
      if (age >= POP_LIFE) { pops.splice(i, 1); continue; }

      var b = pileBox(o.pile);
      var str = (o.v < 0 ? '-' : '+') + Math.abs(o.v);
      var k = popK(b.h);
      /* Centred on the card, both ways, off the card's own box — so it stays
         centred whatever the cards come to measure. */
      var x = b.x + ((b.w - fb.textW(str, k)) >> 1);
      var y = b.y + ((b.h - 7 * k) >> 1);
      var keep = age < POP_HOLD ? 1 : 1 - (age - POP_HOLD) / POP_FADE;

      var ink = POP_INK[o.kind] || POP_INK.PLACE;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx || dy) popGlyphs(str, x + dx * k, y + dy * k, k, POP_EDGE, keep);
        }
      }
      popGlyphs(str, x, y, k, ink, keep);
    }
  }

  var WM_X = 6, WM_Y = 6;                // the mark's corner, in world units
  /* A coarse pointer is the only thing that tells a tablet from a desktop
     window of the same shape; read once, since it cannot change under us.
     ?coarse=1/0 overrides it, so the contact sheet can stand a desktop frame
     in for a touch device — the frame's own pointer would say otherwise. */
  var COARSE = (function () {
    try {
      var f = new URLSearchParams(location.search).get('coarse');
      if (f === '1' || f === '0') return f === '1';
    } catch (e) { /* fall through to what the display reports */ }
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  })();
  var device = 'desktop';
  /* Every setting lays its ground plane on this fraction of the canvas — one
     line now, not a band, so text only has to clear the one. Read from
     scenes.js rather than copied: this file had its own 0.42 alongside a
     comment asking that the two be kept in step by hand, which is a drift
     waiting to happen. scenes.js loads first, so the global is already here. */
  var CELL = 24, CGAP = 5;               // grid picker: a cell wants a fingertip
  var GWID = 4*CELL + 3*CGAP;
  /* One row of settings whatever the width, now that they cycle rather than
     all showing at once — so there is a single shape to fit. Asking for more
     height than the panel needs is what leaves the setting visible around it. */
  var SETUP_W = 175, SETUP_H = 330;
  var canvas, ctx, live, fb = null;
  var scale = 2, W = 0, H = 0;
  /* The setting sits on its own layer at a scale that never changes with the
     grid, so the city stays put while the board grows and shrinks over it. It
     only needs redrawing when the setting or the window changes, which also
     takes the most expensive thing on screen out of the per-frame path. */
  var bgCanvas, bgCtx, bgFb = null, worldScale = 2, bgW = 0, bgH = 0, bgDirty = true;
  /* A scene that moves keeps a still of everything that does not, and repaints
     only the band that does. Redrawing a whole scene per frame runs 2ms on Dusk
     Terrace and 39ms on Space Port at 960x540, against a 16ms budget the board
     and cards also come out of; the band costs 0.18ms. */
  var bgStill = null, bgMotion = null, bgImg = null;
  var REDUCED = !!(window.matchMedia &&
                   window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var screen = 'MENU';
  var pickC = 3, pickR = 3, pickScene = 0;   // Palm Court, the load-in default
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
    var dpr = window.devicePixelRatio || 1;
    device = L.device(vw, vh, COARSE);
    if (screen === 'MENU' || screen === 'SETUP' ||
        screen === 'MODE' || screen === 'ROOM' || screen === 'LOBBY' ||
        screen === 'ONLINE' || screen === 'SEARCH') {
      scale = L.step(SETUP_W, SETUP_H, vw, vh, true, dpr);
      uiSide = false;
    } else {
      var fitted = L.game(g ? g.cols : pickC, g ? g.rows : pickR, vw, vh, dpr, COARSE);
      scale = fitted.scale;
      uiSide = fitted.uiSide;
      /* A room holds the cards at a constant share of the screen. The table's
         scale steps at low pixel density, so between one step and the next
         the canvas grows while the cards do not: at 1440x900 they came out a
         tenth smaller than at 1280x800, for no reason a player could see.
         Lifting the scale just enough to hold the canvas at the width the
         smaller screen already used makes the two identical in logical units.

         Done here rather than in layout.js on purpose — that table is
         per-grid and shared with solo, and a row changed there would need all
         sixteen grids re-audited. This only ever applies inside a room. */
      /* Holding the canvas to a fixed width raises the scale, which lowers
         the canvas height with it — fine on a desktop, fatal on a phone laid
         on its side, where 640 wide leaves 296 of height for a board needing
         311 and the bottom row falls off. So the cap only applies where the
         taller scale still leaves the board and its furniture room to stand. */
      var R = L.room(device, vw > vh);
      /* Where the scoreboard is in the flanks, the board takes the height.
         The grid table sizes for a board that shares the screen with a row
         of furniture underneath it; there is no such row here, so the band
         it reserved is spare, and lifting the scale until the board nearly
         fills the height turns that band into card.

         It buys less than it looks like it should. A four by four of these
         cards is 311 units tall against a canvas of 339 once the margins are
         taken, so the board is already most of the height and the rest is
         single figures of per cent. The room to spare on a wide screen is
         beside the board, and a portrait board cannot reach it. */
      var cap = R.capW;
      if (mp() && R.stripFlank) {
        var rows = g ? g.rows : pickR;
        scale = Math.max(scale, Math.min(
          vh / (L.boardH(rows) + ROOM_ABOVE + ROOM_BELOW),
          vw / ROOM_MIN_W));
      } else if (mp() && cap && cap * scale < vw) {
        var want = vw / cap;
        if (vh / want >= L.boardH(g ? g.rows : pickR) + 44) scale = want;
      }
    }
    W = Math.max(120, Math.round(vw / scale));
    H = Math.max(120, Math.round(vh / scale));
    canvas.width = W; canvas.height = H;
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    fb = new FB(W, H);

    worldScale = L.world(vw, vh, dpr, COARSE);
    bgW = Math.max(120, Math.round(vw / worldScale));
    bgH = Math.max(120, Math.round(vh / worldScale));
    bgCanvas.width = bgW; bgCanvas.height = bgH;
    bgCanvas.style.width = vw + 'px';
    bgCanvas.style.height = vh + 'px';
    bgFb = new FB(bgW, bgH);
    document.getElementById('stack').style.width = vw + 'px';
    document.getElementById('stack').style.height = vh + 'px';
    bgDirty = true;
  }

  /* The setting, and in play the mark with it — both at the world scale. */
  function drawBackground() {
    var S = SCENES[pickScene];
    var animates = !REDUCED && sceneAnimates(S);
    bgFb.clear();
    drawScene(bgFb, S, bgW, bgH, animates);
    bgMotion = null;
    if (animates) {
      /* Asked only now the scene has been drawn. What moves is not always known
         before: Dusk picks its live windows out of the ones the skyline put
         down, and Space Port's regions are the stars themselves. */
      bgMotion = sceneMotion(S, bgH, bgW);
    }
    if (bgMotion) {
      /* Cached before the moving parts go on, so a frame can restore the band
         and put them back somewhere new. */
      bgStill = bgFb.d.slice(0);
      drawSceneMotion(bgFb, S, bgW, bgH, now);
    }
    markBg();
    if (!bgImg || bgImg.width !== bgW || bgImg.height !== bgH) {
      bgImg = bgCtx.createImageData(bgW, bgH);
    }
    bgImg.data.set(bgFb.d);
    bgCtx.putImageData(bgImg, 0, 0);
    bgDirty = false;
  }

  /* The mark rides the background because that layer's scale does not change
     with the grid and the board's does — on the foreground it would shrink by a
     third between 3x3 and 4x4, or need a fractional scale. It sits inside the
     band Palm Court repaints, so it goes back on after. 0.04ms. */
  function markBg() {
    if (screen === 'GAME') splitMark(bgFb, WM_X + 6, WM_Y + 5, 1, pal().hudShadow);
  }

  /* Restore each moving region from the still, repaint them, put the mark back,
     and upload only those rectangles. A list rather than one band because Dusk
     moves a strip of sky and a dozen 2x2 windows well below it — one band
     spanning both would drag every tower into the per-frame path. */
  function drawBackgroundMotion() {
    var i, r;
    for (i = 0; i < bgMotion.length; i++) {
      r = bgMotion[i];
      for (var y = r.y; y < r.y + r.h; y++) {
        var o = (y * bgW + r.x) * 4;
        bgFb.d.set(bgStill.subarray(o, o + r.w * 4), o);
      }
    }
    drawSceneMotion(bgFb, SCENES[pickScene], bgW, bgH, now);
    markBg();
    /* The mark sits in the first region, so copy after it is drawn. */
    for (i = 0; i < bgMotion.length; i++) {
      r = bgMotion[i];
      for (var y2 = r.y; y2 < r.y + r.h; y2++) {
        var o2 = (y2 * bgW + r.x) * 4;
        bgImg.data.set(bgFb.d.subarray(o2, o2 + r.w * 4), o2);
      }
      bgCtx.putImageData(bgImg, 0, 0, r.x, r.y, r.w, r.h);
    }
  }

  /* ── layout ── */
  /* In a room the field shifts left. The clock takes the top-right corner and
     the scoreboard runs under the board, and a centred field crowded both.
     Done here rather than in layout.js on purpose: that table is per-grid and
     shared with solo, and nudging a shared term there has broken other grids
     before. This offset only ever applies while a room is live. */
  var MP_SHIFT = 34;

  /* What a room leaves around the board. Above it there is only sky; below
     it there is the stock count and nothing else, because the calls and the
     scoreboard are in the flanks. ROOM_MIN_W is the width those flanks need
     to stand in — deck, board, calls, and a scoreboard column either side. */
  var ROOM_ABOVE = 10, ROOM_BELOW = 18, ROOM_MIN_W = 580;

  /* Where the mark's top falls in *this* layer's units. The mark is drawn on
     the background at a scale that never changes with the grid, so its
     position has to be converted rather than assumed — the same conversion
     the HUD already does to keep the mark clickable. */
  function markTopHere() {
    return Math.round((WM_Y + 5) * worldScale / scale);
  }
  function markLeftHere() {
    return Math.round((WM_X + 6) * worldScale / scale);
  }

  function boardBox() {
    var b = L.board(g ? g.cols : pickC, g ? g.rows : pickR, W, H, uiSide, device);
    if (mp()) {
      /* Centre the field in the span between the deck and the calls. The
         three are coupled — the deck is placed off the board, and the calls
         mirror the deck's margin — so this is solved rather than nudged:
         put the board where the gap either side of it comes out equal, and
         the outer margins fall out equal too. Only where the calls actually
         sit beside the board; beneath it there is no right-hand flank to
         balance against, so that case keeps the plain shift. */
      if (uiSide) b.x = Math.max(6, Math.round((W - SIDE_W + CARD_W - b.w) / 2));
      else b.x = Math.max(6, b.x - MP_SHIFT);
      /* Set against the top rather than centred. The two margins are not the
         same job: above the board there is only sky, below it the stock count
         has to stand, and centring split the difference and left the count
         one unit off the bottom edge.

         Tested on the canvas width rather than by asking flanksFit, which
         reads stockBox, which reads this — the first cut of this line was a
         stack overflow that only appeared in a room, because the multiplayer
         guard kept the smoke walk out of it. */
      if (rm().stripFlank && W >= ROOM_MIN_W) b.y = ROOM_ABOVE;
      /* The board keeps the layout table's vertical answer. Starting it level
         with the mark freed a band for the scoreboard, but the deck and the
         calls are bottom-aligned to the board — so lifting it lifted them
         into the horizon, which they should never touch. */
    }
    return b;
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

  function button(x, y, w, label, act, on, mode) {
    var p = pal();
    var r = { x:x, y:y, w:w, h:18 };
    var hot = on && inside(r);
    fb.rect(x, y, w, 18, hot ? p.hudInk : p.hudShadow);
    fb.frame(x, y, w, 18, on ? p.hudInk : p.hudDim);
    var lx = x + ((w - fb.textW(label,1)) >> 1);
    var ly = y + 6;
    /* The temperature shows on the resting state only. Hovering fills the
       button with cream, and the ramps' bright steps have nothing left to
       carry them there — the inversion is the hover signal anyway.

       SUIT carries no ramp and no mode: plain cream against three ramped
       neighbours is itself the distinction, and it is the one call that is
       about matching rather than about a direction the ramps could show. */
    if (mode && on && !hot) callText(fb, label, lx, ly, 1, mode);
    else fb.text(label, lx, ly, hot ? p.hudShadow : (on ? p.hudInk : p.hudDim));
    if (on) hit(x, y, w, 18, act);
    return r;
  }

  /* ═══ MENU ════════════════════════════════════════════════════════════ */

  var MENU_RANKS = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
  var MENU_SUITS = ['S','H','D','C'];
  var MENU_CARDS = 5;
  var menuHand = [];
  var lastCycle = -1;
  function shuffleHand() {
    var deck = [], i, j, tmp;
    for (i = 0; i < MENU_RANKS.length; i++)
      for (j = 0; j < MENU_SUITS.length; j++)
        deck.push({ r: MENU_RANKS[i], s: MENU_SUITS[j] });
    for (i = deck.length - 1; i > 0; i--) {
      j = (Math.random() * (i + 1)) | 0;
      tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    menuHand = deck.slice(0, MENU_CARDS);
  }
  shuffleHand();
  var SHUF_CYCLE = 4000;
  /* Sized to fill the content band exactly, which is what closes the air
     between the mark and the buttons.

     The fan is capped at the SOLO button's edge and `fanSpread` divides that
     same width by however many cards there are, so the count changes the
     overlap and never the outer bounds — five cards occupy exactly the span
     four did. What it does change is how much of each face survives: the strip
     goes from 26px to 19px, which still clears the corner index but no longer
     reaches the first pip column at 26. So every card behind the front one
     shows its index on blank stock. That is the trade the count buys. */
  var menuCh = GWID, menuCw = Math.round(menuCh * CARD_W / CARD_H);

  function drawMenuCards(cx, y, maxW) {
    var p = pal();
    var n = menuHand.length;
    var mid = (n - 1) / 2;
    var fanSpread = Math.floor((maxW - menuCw) / (2 * mid));
    var stackOff = 2;

    var cycle = Math.floor(now / SHUF_CYCLE);
    if (cycle !== lastCycle) { shuffleHand(); lastCycle = cycle; }

    var raw = (now % SHUF_CYCLE) / SHUF_CYCLE;
    var phase;
    if (raw < 0.15)      phase = { id: 'open',  t: raw / 0.15 };
    else if (raw < 0.55) phase = { id: 'hold',  t: (raw - 0.15) / 0.4 };
    else if (raw < 0.70) phase = { id: 'close', t: (raw - 0.55) / 0.15 };
    else                 phase = { id: 'stack', t: (raw - 0.70) / 0.3 };

    var fan = 0;
    if (phase.id === 'open')  fan = phase.t;
    else if (phase.id === 'hold')  fan = 1;
    else if (phase.id === 'close') fan = 1 - phase.t;

    var ease = fan < 0.5 ? 2 * fan * fan : 1 - 2 * (1 - fan) * (1 - fan);

    for (var i = 0; i < n; i++) {
      var offset = (i - mid) * fanSpread * ease;
      var stackX = (i - mid) * stackOff;
      var bx = Math.round(cx - (menuCw >> 1) + stackX * (1 - ease) + offset);
      var by = y;

      fb.dim(bx + 3, by + 4, menuCw, menuCh, 0.45);

      if (ease > 0.3) {
        cardFace(fb, bx, by, menuCw, menuCh, menuHand[i].r, menuHand[i].s, p);
      } else {
        cardBack(fb, bx, by, menuCw, menuCh, p);
      }
    }
  }


  /* ── the searching wheel ──
     The deck going round while the queue does its work, in place of the fan
     and the word SEARCHING. Eight cards on a shallow ellipse, sized by depth
     so the ring reads as a ring: cards taller than the orbit pile into a band
     across the middle and the rotation goes with them. 40x33 against a 32x44
     card is what clears it, and 110 of the band's 111 is what that spends.

     All face down. Nothing has been dealt yet — there is no hand, no board
     and no opponent — so a card turned up here would be showing something
     the game does not know. Backs also hold their read at every size on the
     ring, which no face does: cardFace lays its pips across h-32, and at 44
     anything above a four merges into blobs. */
  function drawWheel(cx, cy) {
    var p = pal(), n = 8, RX = 40, RY = 33, TAU = Math.PI * 2;
    var spin = now * 0.0010;
    var at = [];
    for (var i = 0; i < n; i++) {
      var a = spin + i * TAU / n;
      at.push({ a: a, depth: Math.cos(a) });
    }
    at.sort(function (u, v) { return u.depth - v.depth; });   // far ones first

    for (var k = 0; k < n; k++) {
      var o = at[k];
      var f = 0.80 + 0.20 * (o.depth + 1) / 2;
      var cw = Math.round(32 * f), ch = Math.round(44 * f);
      var x = cx + Math.round(Math.sin(o.a) * RX) - (cw >> 1);
      var y = cy + Math.round(o.depth * RY) - (ch >> 1);
      fb.dim(x + 2, y + 3, cw, ch, 0.5);
      cardBack(fb, x, y, cw, ch, p);
    }
  }

  /* One skeleton for both the front page and solo setup, so the panel, the
     mark, and every row hold their ground while only the contents change —
     the shift between the two screens reads as a swap, not a jump.
       mark
       content band (GWID tall: the grid picker, or the card fan centred in it)
       label row    ("3 X 1", or empty)
       row1         (setting selector, or SOLO)
       row2         (DEAL, or MULTIPLAYER)
     The way back is a corner arrow rather than a row of its own — a whole
     row for one word made the panel taller than it had any need to be. */
  function menuGeom() {
    var markH = splitMarkH(3);
    var g = { PAD: 16, markH: markH };
    /* The band is padded equally above and below. Below has to carry the label
       row as well, and that row is empty on the menu — so 8 + label + 12 put 27
       under the band against 16 over it, and on the menu the whole 27 was air.
       The three below now total the 16 above, which keeps the two screens on
       one skeleton rather than fixing the menu by collapsing a row it shares. */
    g.bandY  = markH + 16;
    g.labelY = g.bandY + GWID + 4;
    g.row1Y  = g.labelY + 7 + 5;
    g.row2Y  = g.row1Y + 20 + 14;
    g.blockH = g.row2Y + 20;
    /* Wide enough for the widest thing in it and no wider: the buttons and
       the fan both stop at 160, so 16 either side matches the 16 above and
       below and the panel comes out evenly padded. Anything more than this
       was empty margin. The cap stays a share of the canvas underneath, so
       a narrow viewport still shrinks the panel rather than overflowing. */
    g.pw = Math.min(Math.round(W * 0.84), 160 + g.PAD * 2);
    g.top = Math.max(8, Math.round((H - g.blockH) / 2));
    return g;
  }

  function panelFrame(m) {
    var p = pal(), cx = W >> 1;
    fb.dim(cx - (m.pw >> 1), m.top - m.PAD, m.pw, m.blockH + m.PAD * 2, 0.42);
    fb.frame(cx - (m.pw >> 1), m.top - m.PAD, m.pw, m.blockH + m.PAD * 2, p.hudDim);
    splitMark(fb, cx - (splitMarkW(3) >> 1), m.top, 3, p.hudShadow);
  }

  /* Drawn rather than typed: the font's '<' already means "previous setting"
     one row down, and the way out of the screen should not wear the same
     glyph as the thing that cycles a setting. */
  var BACK_ARROW = [
    '..##...',
    '.##....',
    '#######',
    '.##....',
    '..##...'
  ];

  /* Sits in the panel's top-left corner, clear of the mark. The target takes
     a good deal more than the glyph, so a thumb can find it. */
  function backArrow(m) {
    var p = pal(), cx = W >> 1;
    var ax = cx - (m.pw >> 1) + 10, ay = m.top - m.PAD + 10;
    var r = { x: ax - 7, y: ay - 8, w: 21, h: 21 };
    var hot = inside(r);
    if (hot) fb.frame(r.x, r.y, r.w, r.h, p.hudDim);
    fb.blit(BACK_ARROW, ax, ay, hot ? p.hudInk : p.hudDim);
    hit(r.x, r.y, r.w, r.h, { t: 'back' });
  }

  /* The setting picker, shared by solo setup and the online profile. It was
     written twice with the same arithmetic, and the same arithmetic was wrong
     in both: arrows 22 wide with 6 either side left the name 59 units on a
     175-wide phone canvas, where DUSK TERRACE needs 71 and ran over its own
     box. Narrower arrows and tighter gaps give it 75. */
  function sceneRow(y, w) {
    var p = pal(), cx = W >> 1, rx = cx - (w >> 1);
    var aw = 16, gp = 4, n = SCENES.length;

    function arrow(ax, glyph, to) {
      var on = mouse.x >= ax && mouse.x < ax + aw && mouse.y >= y && mouse.y < y + 20;
      fb.rect(ax, y, aw, 20, on ? p.hudInk : p.hudShadow);
      fb.frame(ax, y, aw, 20, p.hudInk);
      fb.text(glyph, ax + ((aw - 5) >> 1), y + 7, on ? p.hudShadow : p.hudInk);
      hit(ax, y, aw, 20, { t: 'scene', i: to });
    }
    arrow(rx, '<', (pickScene + n - 1) % n);
    arrow(rx + w - aw, '>', (pickScene + 1) % n);

    var nx = rx + aw + gp, nw = w - 2 * (aw + gp);
    fb.rect(nx, y, nw, 20, p.hudShadow);
    fb.frame(nx, y, nw, 20, p.hudDim);
    var nm = SCENES[pickScene].name.toUpperCase();
    fb.text(nm, nx + ((nw - fb.textW(nm, 1)) >> 1), y + 7, p.hudInk);
  }

  function menuButton(y, w, label, act) {
    var p = pal(), cx = W >> 1, bx = cx - (w >> 1);
    var hot = mouse.x >= bx && mouse.x < bx + w && mouse.y >= y && mouse.y < y + 20;
    fb.rect(bx, y, w, 20, hot ? p.hudInk : p.hudShadow);
    fb.frame(bx, y, w, 20, p.hudInk);
    fb.text(label, bx + ((w - fb.textW(label, 1)) >> 1), y + 7, hot ? p.hudShadow : p.hudInk);
    hit(bx, y, w, 20, act);
  }

  function drawMenu() {
    var m = menuGeom(), cx = W >> 1;
    panelFrame(m);

    // the fan holds the grid picker's band, centred in it, and concludes
    // above the button's edge rather than reaching past it
    var btnW = Math.min(160, m.pw - 32);
    drawMenuCards(cx, m.top + m.bandY + ((GWID - menuCh) >> 1), btnW);

    menuButton(m.top + m.row1Y, btnW, 'SOLO', { t: 'solo' });
    menuButton(m.top + m.row2Y, btnW, 'MULTIPLAYER', { t: 'multiplayer' });
  }

  /* ═══ MULTIPLAYER ═════════════════════════════════════════════════════
     Four screens on the same skeleton the menu and setup share, so crossing
     between any of them moves contents rather than the frame:
       MODE   pick competitive or co-op
       ROOM   your name, then host or join
       LOBBY  the code, who is in, and the start
     and then GAME, which is the solo board plus a scoreboard strip.        */

  var net = null;                 // the live room, or null
  var room = null;                // last SYNC/ROSTER from the server
  var roomMode = 'pick';          // 'pick' · 'join'
  var typing = null;              // { field:'name'|'code', value:'' }
  var netMsg = '';                // one line of status, shown under the band
  var turnEndsAt = 0;             // wall clock for the turn bar
  /* How long the turn on the clock was given. The strip's bar is a fraction
     of it, and hard-coding that denominator meant the bar read as a third
     full for a whole turn the moment the clock changed length. The server is
     the only thing that knows, so it is taken from what the server sent. */
  var turnSpan = 0;
  var mpOver = null;              // the OVER payload, once a game finishes
  var pendingRoom = '';           // a code arrived on a link, waiting for a name
  var afterName = '';             // what the name step was opened in order to do
  var queued = null;              // the live queue socket, while searching

  function mp() { return !!net && !!g && g.players > 1; }
  /* Every layout choice a room makes comes from here rather than from a
     conditional at the point of use. Same table idiom the grids use, so a
     screen that behaves oddly is one row to read and one row to change. */
  function rm() { return L.room(device, W > H); }
  /* The one arrangement that gets its own treatment: a room, on the big
     grid, with a mouse and room to spare. Everything else keeps the layout
     the table decided, which is what keeps solo out of these changes. */
  function mpDesk4() {
    return mp() && device === 'desktop' && g.cols === 4 && g.rows === 4;
  }
  function mySeat() { return room ? room.you : -1; }
  function myTurn() { return mp() && g.turn === mySeat(); }

  function panelLine(y, str, col) {
    var p = pal();
    hud(str, (W - fb.textW(str, 1)) >> 1, y, col || p.hudDim);
  }

  /* A field you type into. There is no DOM here, so it is drawn and fed by
     onKey — a caret that blinks is the only thing telling you it is live. */
  function field(y, w, label, value, active, act) {
    var p = pal(), cx = W >> 1, x = cx - (w >> 1);
    var hot = mouse.x >= x && mouse.x < x + w && mouse.y >= y && mouse.y < y + 20;
    fb.rect(x, y, w, 20, p.hudShadow);
    fb.frame(x, y, w, 20, active ? p.pick : (hot ? p.hudInk : p.hudDim));
    var shown = value || '';
    if (active && ((now / 500) | 0) % 2 === 0) shown += '_';
    if (!shown) { fb.text(label, x + 6, y + 7, p.hudDim); }
    else fb.text(shown, x + ((w - fb.textW(shown, 1)) >> 1), y + 7, p.hudInk);
    hit(x, y, w, 20, act);
  }

  function drawMode() {
    var m = menuGeom(), cx = W >> 1;
    panelFrame(m);
    backArrow(m);
    var btnW = Math.min(160, m.pw - 32);

    /* The fan carries straight through from the front page. It runs off the
       same clock, so crossing to this screen does not restart it — it is one
       deal being shuffled, not a decoration that begins again per screen. */
    drawMenuCards(cx, m.top + m.bandY + ((GWID - menuCh) >> 1), btnW);

    /* Live now: it leads to a real screen where a name, an avatar and a
       setting are chosen and kept. Only the match itself is unbuilt, and
       that button says so where it sits. */
    menuButton(m.top + m.row1Y, btnW, 'PLAY ONLINE', { t: 'mp-online' });

    menuButton(m.top + m.row2Y, btnW, 'PLAY WITH FRIENDS', { t: 'mp-friends' });
  }

  /* Everything a ranked game needs to know about you, on the panel every
     other screen uses — avatar and arrows, name, setting, and the match
     button. It fits the band as it stands: the content ends 36 units short
     of it, so nothing here grows the box.

     FIND A MATCH is drawn dim because matchmaking is not built. Everything
     above it is real, and what it saves is real. */
  function drawOnline() {
    var m = menuGeom(), cx = W >> 1, p = pal();
    panelFrame(m);
    backArrow(m);
    var btnW = Math.min(160, m.pw - 32);
    var by = m.top + m.bandY;

    /* Name first, then the avatar under it — and the avatar takes the rest
       of the band rather than the band ending early and leaving a hole above
       the setting row. The art is drawn at two, so a bigger tile is a bigger
       picture and not a stamp on empty card. */
    field(by + 4, btnW, 'TAP TO TYPE', Net.name(),
          typing && typing.field === 'name', { t: 'mp-type-name' });
    panelLine(by + 30, netMsg || 'SHOWN TO OTHERS');

    /* Centred in the space it actually has — between the foot of the name
       hint and the top of the setting row — rather than pinned to a number
       that stops being centred the moment anything above or below moves. */
    var av = 46, aw = 18, ah = 22;
    var ax = cx - (av >> 1);
    var hintFoot = by + 30 + 7;
    var rowTop = m.top + m.row1Y;
    var block = av + 3 + 7;                  // tile, gap, label
    var ay = hintFoot + Math.round(((rowTop - hintFoot) - block) / 2);
    var n = avatarCount(), cur = Net.avatar();
    fb.rect(ax, ay, av, av, p.ink);
    fb.rect(ax + 1, ay + 1, av - 2, av - 2, p.linen);
    drawAvatarArt(fb, ax, ay, av, av, cur, 2);
    var an = avatarName(cur);
    hud(an, cx - (fb.textW(an, 1) >> 1), ay + av + 3, p.hudDim);

    function avArrow(bx2, glyph, to) {
      var ay2 = ay + ((av - ah) >> 1);
      var hotA = mouse.x >= bx2 && mouse.x < bx2 + aw &&
                 mouse.y >= ay2 && mouse.y < ay2 + ah;
      fb.rect(bx2, ay2, aw, ah, hotA ? p.hudInk : p.hudShadow);
      fb.frame(bx2, ay2, aw, ah, p.hudInk);
      fb.text(glyph, bx2 + ((aw - 5) >> 1), ay2 + ((ah - 7) >> 1),
              hotA ? p.hudShadow : p.hudInk);
      hit(bx2, ay2, aw, ah, { t: 'mp-avatar', i: to });
    }
    avArrow(ax - aw - 10, '<', (cur + n - 1) % n);
    avArrow(ax + av + 10, '>', (cur + 1) % n);

    // ── setting, the same control solo uses ──
    sceneRow(m.top + m.row1Y, btnW);

    menuButton(m.top + m.row2Y, btnW, 'FIND A MATCH', { t: 'mp-find' });
  }

  /* Searching. Deliberately plain: there is nothing to decide here, and the
     only thing worth showing is that something is still happening and how to
     stop it. The fan keeps running because the wait is the one place a player
     is doing nothing at all. */
  function drawSearch() {
    var m = menuGeom(), cx = W >> 1;
    panelFrame(m);
    backArrow(m);
    var btnW = Math.min(160, m.pw - 32);
    var by = m.top + m.bandY;

    /* The wheel is the message: a spinning deck says searching more plainly
       than the word does, and says it without a row of animated full stops. */
    drawWheel(cx, by + (GWID >> 1));

    /* The depth of the queue is not the player's problem. "1 PLAYER WAITING"
       is a true statement that reads as bad news — it is you, and it says
       nobody else is here. The house fills the table at thirty seconds
       either way, so the count never changes what happens next. */
    var line = netMsg || 'LOOKING FOR PLAYERS';
    panelLine(by + GWID + 9, line, netMsg ? pal().hudInk : undefined);

    /* CANCEL sits on row2, where FIND A MATCH was pressed a moment ago, so
       the button does not jump out from under the finger that got here. */
    menuButton(m.top + m.row2Y, btnW, 'CANCEL', { t: 'mp-unqueue' });
  }

  function drawRoom() {
    var m = menuGeom();
    panelFrame(m);
    backArrow(m);
    var btnW = Math.min(160, m.pw - 32);
    var by = m.top + m.bandY;

    if (roomMode === 'pick') {
      /* The fan runs here too. Getting into a room is still the front of the
         game, not a form — the deal should not stop while you decide. */
      drawMenuCards(W >> 1, by + ((GWID - menuCh) >> 1), btnW);
      if (netMsg) panelLine(by + GWID + 2, netMsg);
      if (pendingRoom) {
        menuButton(m.top + m.row1Y, btnW, 'JOIN ' + pendingRoom, { t: 'mp-join-link' });
        menuButton(m.top + m.row2Y, btnW, 'HOST INSTEAD', { t: 'mp-host' });
      } else {
        menuButton(m.top + m.row1Y, btnW, 'HOST A GAME', { t: 'mp-host' });
        menuButton(m.top + m.row2Y, btnW, 'JOIN A GAME', { t: 'mp-join-pick' });
      }
      return;
    }

    /* Asked only when it is actually wanted — on the way into a room rather
       than as a gate in front of the choice of which room. */
    if (roomMode === 'name') {
      panelLine(by + 18, 'YOUR NAME');
      field(by + 32, btnW, 'TAP TO TYPE', Net.name(),
            typing && typing.field === 'name', { t: 'mp-type-name' });
      panelLine(by + 62, netMsg || 'SHOWN TO OTHERS');
      menuButton(m.top + m.row1Y, btnW, 'CONTINUE', { t: 'mp-name-go' });
      return;
    }

    {
      panelLine(by + 18, 'ROOM CODE');
      field(by + 32, btnW, 'FOUR LETTERS',
            typing ? typing.value : '', typing && typing.field === 'code',
            { t: 'mp-type-code' });
      panelLine(by + 62, netMsg || 'ASK THE HOST FOR IT');
      menuButton(m.top + m.row1Y, btnW, 'JOIN', { t: 'mp-join-go' });
    }
  }

  function drawLobby() {
    var m = menuGeom(), p = pal(), cx = W >> 1;
    panelFrame(m);
    backArrow(m);
    var btnW = Math.min(160, m.pw - 32);
    var by = m.top + m.bandY;

    var code = room ? room.code : '';
    hudBig(code, cx - (fb.textW(code, 2) >> 1), by + 4, p.hudInk, 2);
    panelLine(by + 26, 'SHARE THE CODE OR THE LINK');

    var seats = (room && room.seats) || [];
    for (var i = 0; i < 4; i++) {
      var ry = by + 42 + i * 13;
      var s = seats[i];
      /* An open seat has to be legible or the room looks like it holds one
         player and nothing else. The font is caps and digits only — an em
         dash draws as a blank, which is how this read as empty space. */
      if (!s) { panelLine(ry, '. . . . .', p.hudDim); continue; }
      var line = s.name + (s.host ? '  HOST' : '');
      var col = s.connected ? (i === mySeat() ? p.pick : p.hudInk) : p.hudDim;
      hud(line, cx - (fb.textW(line, 1) >> 1), ry, col);
    }

    var amHost = seats[mySeat()] && seats[mySeat()].host;
    if (amHost) {
      if (seats.length >= 2) menuButton(m.top + m.row1Y, btnW, 'START', { t: 'mp-start' });
      else {
        var bx = cx - (btnW >> 1), y1 = m.top + m.row1Y;
        fb.rect(bx, y1, btnW, 20, p.hudShadow);
        fb.frame(bx, y1, btnW, 20, p.hudDim);
        var w1 = 'NEED ONE MORE';
        fb.text(w1, bx + ((btnW - fb.textW(w1, 1)) >> 1), y1 + 7, p.hudDim);
      }
    } else {
      panelLine(m.top + m.row1Y + 7, netMsg || 'WAITING FOR THE HOST');
    }
    menuButton(m.top + m.row2Y, btnW, 'COPY LINK', { t: 'mp-copy' });
  }

  /* ── the scoreboard ──
     One strip of cells, centred on whatever it is given and drawn from a
     baseline, so it can move from the sky band to the foot without a layout
     change. Everything about its placement is these two numbers. */
  /* ── the scoreboard, in the flanks ──
     Two players outside the deck and two outside the calls, each with the
     avatar they chose. The deck sits a fixed margin off the board and the
     calls mirror that margin, so the two flanks are the same width by
     construction and the pair of columns balance without being placed by
     hand: 80 units at the narrowest desktop canvas, 108 at the widest.

     The name takes a row of its own above the avatar rather than sitting
     beside it. Beside it there are 31 units left over, which is five
     characters — and a name is allowed twelve. */
  function seatName(i) {
    return (room && room.seats[i] ? room.seats[i].name : 'P' + (i + 1));
  }
  function seatAvatar(i) {
    return (room && room.seats[i] ? room.seats[i].av | 0 : i);
  }

  function flankCell(x, y, w, i) {
    var p = pal();
    var AVW = 40, AVH = 32, PAD = 4, NAMEH = 12;
    var h = NAMEH + AVH + PAD;
    var on = (g.turn === i) && g.phase !== 'WON' && g.phase !== 'LOST';

    /* Filled rather than dimmed. The block under the board sits on one
       backdrop and can multiply what is behind it; a flank column runs from
       the skyline down to the ground plane, and a 0.42 multiply gave the top
       cell a panel and the bottom one nothing at all. Solid shadow is also
       what the call buttons opposite are drawn on, so the two flanks match. */
    fb.rect(x, y, w, h, p.hudShadow);
    fb.frame(x, y, w, h, on ? p.pick : p.hudDim);

    var nm = seatName(i);
    while (nm.length > 1 && fb.textW(nm, 1) > w - PAD * 2) nm = nm.slice(0, -1);
    hud(nm, x + PAD, y + 3, on ? p.pick : p.hudDim);

    drawAvatarArt(fb, x + PAD, y + NAMEH, AVW, AVH, seatAvatar(i), 2);

    var sc = String(g.scores[i].score);
    hud(sc, x + w - PAD - fb.textW(sc, 1), y + NAMEH + ((AVH - 7) >> 1), p.hudInk);

    if (on) {
      fb.rect(x, y, 2, h, p.pick);
      /* The same bar the block under the board carries, for the same reason:
         who is on the clock belongs next to the name, not only in the corner. */
      if (turnEndsAt && turnSpan) {
        var left = Math.max(0, turnEndsAt - Date.now()) / turnSpan;
        fb.rect(x + 2, y + h - 3, w - 4, 1, p.hudShadow);
        fb.rect(x + 2, y + h - 3, Math.round((w - 4) * Math.min(1, left)), 1, p.pick);
      }
    }
    return h;
  }

  /* True only where there is genuinely room, rather than only where the
     layout table says desktop. `device` is read off the pointer, so a coarse
     pointer on a wide screen has been misclassified before; measuring the
     flank costs one subtraction and cannot be wrong about it. */
  function flanksFit() {
    var deck = stockBox();
    return uiSide && deck.big && deck.x >= 72;
  }

  function drawFlanks(b) {
    var deck = stockBox();
    var fw = Math.min(96, deck.x - 8);
    var lx = (deck.x - fw) >> 1;
    var rx = (W - deck.x) + ((deck.x - fw) >> 1);
    /* Bottom-aligned with the board, which is where the deck and the calls
       already sit. Centred on the board instead, the pair straddled the
       horizon: one cell in the skyline, one on the ground. */
    var GAPV = 8, h = 12 + 32 + 4;
    var y0 = b.y + b.h - (h * 2 + GAPV);
    /* Seat order, left pair then right pair. Sorting by score or floating
       your own seat to the top would move a player's box out from under the
       eye that had just learned where it was. */
    for (var i = 0; i < g.players; i++) {
      flankCell(i < 2 ? lx : rx, y0 + (i % 2) * (h + GAPV), fw, i);
    }
  }

  function strip(cx, y, blockW, twoUp) {
    if (!mp()) return;
    var p = pal(), i, GAPC = 6, CELLH = 16, ROWGAP = 5;
    var cols = twoUp ? Math.max(1, rm().stripCols) : g.players;
    var rows = Math.ceil(g.players / cols);

    /* Two up, the cells share the board's width so the pair in each row match
       and the block lines up with the cards. In one row they take what their
       own contents need instead — tying that row to the board's width squeezed
       four cells into 231 units and cut the names, which is the very thing the
       two-up layout exists to avoid. */
    var cellW;
    if (twoUp) {
      cellW = Math.floor(((blockW || (W - 8)) - GAPC * (cols - 1)) / cols);
    } else {
      cellW = 52;
      for (i = 0; i < g.players; i++) {
        var nmi = (room && room.seats[i] ? room.seats[i].name : 'P' + (i + 1));
        var sci = String(g.scores[i].score);
        cellW = Math.max(cellW, fb.textW(nmi, 1) + 6 + fb.textW(sci, 1) + 16);
      }
      var fits = Math.floor(((W - 8) - GAPC * (cols - 1)) / cols);
      if (cellW > fits) cellW = fits;
    }
    var totalW = cellW * cols + GAPC * (cols - 1);
    var x0 = Math.round(Math.min(Math.max(cx - totalW / 2, 4), W - totalW - 4));

    for (i = 0; i < g.players; i++) {
      var nm = (room && room.seats[i] ? room.seats[i].name : 'P' + (i + 1));
      var sc = String(g.scores[i].score);
      /* The score is never cut — it is the figure being read, and a name is
         still recognisable at a few letters where a number is not. */
      var roomForName = cellW - 12 - fb.textW(sc, 1);
      while (nm.length > 1 && fb.textW(nm, 1) > roomForName) nm = nm.slice(0, -1);

      var cxx = x0 + (i % cols) * (cellW + GAPC);
      var cyy = y + ((i / cols) | 0) * (CELLH + ROWGAP);
      var on = (g.turn === i) && g.phase !== 'WON' && g.phase !== 'LOST';

      fb.dim(cxx, cyy, cellW, CELLH, 0.42);
      hud(nm, cxx + 6, cyy + 4, on ? p.pick : p.hudDim);
      hud(sc, cxx + cellW - 6 - fb.textW(sc, 1), cyy + 4, p.hudInk);
      if (on) {
        fb.frame(cxx, cyy, cellW, CELLH, p.ink);
        fb.frame(cxx, cyy, cellW, CELLH, p.pick);
        fb.rect(cxx, cyy, 2, CELLH, p.pick);
        /* The clock as a bar rather than a figure: a fifth number on a screen
           already showing four scores has to be read before it can be used. */
        if (turnEndsAt && turnSpan) {
          var left = Math.max(0, turnEndsAt - Date.now()) / turnSpan;
          fb.rect(cxx + 2, cyy + 14, cellW - 4, 1, p.hudShadow);
          fb.rect(cxx + 2, cyy + 14, Math.round((cellW - 4) * Math.min(1, left)), 1, p.pick);
        }
      }
    }
  }

  /* ── the clock, in the corner ──
     A figure, not a bar. The strip still carries a bar on the seat whose turn
     it is — that says *who* is on the clock — while this says *how long*, at a
     size you can read without hunting for it. The last third takes the hot
     end of the ramp and pulses, which is the one moment it should pull the
     eye away from the board — a share of the turn rather than a fixed ten
     seconds, which on a ten second clock would have meant all of it. */
  function drawClock() {
    if (!mp() || !turnEndsAt) return;
    if (g.phase === 'WON' || g.phase === 'LOST') return;
    var p = pal();
    var left = Math.max(0, turnEndsAt - Date.now());
    var secs = Math.ceil(left / 1000);
    var txt = String(secs);
    var urgent = left <= Math.max(1000, turnSpan / 3);

    /* Set against the corner the way the mark is set against its own: the
       same inset from the right border that the mark keeps from the left, on
       the same line. Both are read off the mark's real position and converted
       out of the background layer's scale, so the pair stays mirrored at any
       size rather than at one that happened to be checked. */
    var k = 2, tw = fb.textW(txt, k);
    var y = markTopHere();
    /* Mirrored to the mark where the corner is free. Where the stock count
       has already claimed it — a board too narrow for the deck to sit beside
       it — the clock takes the space between the two instead of stacking
       under one of them. */
    var x = rm().clock === 'mirror' ? W - markLeftHere() - tw : ((W - tw) >> 1);

    var col = urgent ? p.pick : p.hudInk;
    if (urgent && ((now / 260) | 0) % 2 === 0) col = p.hudInk;
    hudBig(txt, x, y, col, k);
  }

  /* The end of a multiplayer game: the standings, with each seat's own
     breakdown — the one place the subdivisions are shown. */
  function drawStandings() {
    var p = pal(), cx = W >> 1;
    fb.dim(0, 0, W, H, 0.45);
    var st = mpOver ? mpOver.standings : HiLo.standings(g);
    var head = (st[0] && st[0].tied) ? 'A DRAW' :
               (st[0] && st[0].player === mySeat()) ? 'YOU WIN' : 'GAME OVER';
    /* A real table: one column per kind of call, headed and right-aligned, so
       the figures line up down the panel. Written as a run-together string it
       was impossible to compare two seats — each row started at a different
       place, because the whole block was right-aligned rather than the
       columns. Widths come from the headers, which are the widest thing any
       column has to hold until somebody scores a hundred. */
    var COLS = [
      { h: 'H/L',   v: function (s) { return s.placements; } },
      { h: 'SUIT',  v: function (s) { return s.suits; } },
      { h: 'SPLIT', v: function (s) { return s.splits; } },
      { h: 'KILL',  v: function (s) { return s.kills; } }
    ];
    /* The score column has to be as wide as its own heading, not as wide as
       the figures under it — reserving room for '-99' and then writing
       'SCORE' over it ran the two headings together as one word. */
    /* The gap the tally rule lives in: wide enough that the line has clear
       air either side rather than crowding the digits it separates. */
    var CGAP2 = 7, PADX = 10, NAMEW = 66, TALLYGAP = 13;
    var SCOREW = Math.max(fb.textW('SCORE', 1), fb.textW('-99', 1));
    var colsW = 0, ci;
    for (ci = 0; ci < COLS.length; ci++) {
      COLS[ci].w = Math.max(fb.textW(COLS[ci].h, 1), fb.textW('99', 1));
      colsW += COLS[ci].w + (ci ? CGAP2 : 0);
    }

    /* Measured rather than guessed: head, the column heads, one row per seat,
       then the buttons under them. An early version fixed the height at
       52 + rows, which put the button back on top of the last seat. */
    var want = PADX * 2 + NAMEW + 8 + colsW + TALLYGAP + SCOREW;
    var pw = Math.min(W - 16, want);
    var ROWY = 34, HEADY = ROWY, FIRSTY = ROWY + 14;
    /* Two ways out, side by side. They always fit: multiplayer is a 4x4
       board, so the canvas is sized by the board rather than by the device,
       and the narrowest phone measured comes out 257 logical units wide —
       241 of panel, 104 a button. PLAY AGAIN is 59 units of text. A stacked
       fallback was written for narrow screens and then measured to be
       unreachable on any of them, so it is not here. */
    var BGAP = 8, BH = 18;
    var bw = Math.min(104, (pw - PADX * 2 - BGAP) >> 1);
    var ph = FIRSTY + g.players * 13 + 10 + BH + 12;
    var px = (W - pw) >> 1, py = (H - ph) >> 1;
    fb.rect(px, py, pw, ph, p.hudShadow);
    fb.frame(px, py, pw, ph, p.hudInk);
    hudBig(head, px + ((pw - fb.textW(head, 2)) >> 1), py + 10, p.hudInk, 2);

    // right edges, laid out from the score inwards so the table stays flush
    var scoreR = px + pw - PADX;
    var colR = [], edge = scoreR - SCOREW - TALLYGAP;
    for (ci = COLS.length - 1; ci >= 0; ci--) {
      colR[ci] = edge;
      edge -= COLS[ci].w + CGAP2;
    }

    for (ci = 0; ci < COLS.length; ci++) {
      hud(COLS[ci].h, colR[ci] - fb.textW(COLS[ci].h, 1), py + HEADY, p.hudDim);
    }
    hud('SCORE', scoreR - fb.textW('SCORE', 1), py + HEADY, p.hudDim);
    fb.rect(px + PADX, py + HEADY + 9, pw - PADX * 2, 1, p.hudDim);

    /* A rule down the gap before SCORE: everything left of it is what the
       seat did, everything right of it is what that came to. Runs from above
       the headings to the foot of the last row, so it reads as the edge of a
       tally column rather than as a divider between two headings. */
    var tallyX = scoreR - SCOREW - ((TALLYGAP >> 1) | 0);
    var tallyTop = py + HEADY - 3;
    var tallyBot = py + FIRSTY + (g.players - 1) * 13 + 9;
    fb.rect(tallyX, tallyTop, 1, tallyBot - tallyTop, p.hudDim);

    for (var i = 0; i < st.length; i++) {
      var r = st[i];
      var nm = (room && room.seats[r.player] ? room.seats[r.player].name : 'P' + (r.player + 1));
      var sc = g.scores[r.player];
      var y = py + FIRSTY + i * 13;
      var col = r.player === mySeat() ? p.pick : p.hudInk;
      hud((i + 1) + '. ' + nm, px + PADX, y, col);
      for (ci = 0; ci < COLS.length; ci++) {
        var vs = String(COLS[ci].v(sc));
        hud(vs, colR[ci] - fb.textW(vs, 1), y, p.hudDim);
      }
      var rhs = String(r.score);
      hud(rhs, scoreR - fb.textW(rhs, 1), y, col);
    }
    /* PLAY AGAIN goes back to the profile screen rather than straight into
       the queue: pressing it should not commit you to a search you have not
       asked for a second time. */
    var by0 = py + FIRSTY + g.players * 13 + 10;
    var bx0 = px + ((pw - (bw * 2 + BGAP)) >> 1);
    button(bx0, by0, bw, 'PLAY AGAIN', { t: 'mp-again' }, true);
    button(bx0 + bw + BGAP, by0, bw, 'HOME', { t: 'mp-leave' }, true);
  }

  /* ═══ SETUP ═══════════════════════════════════════════════════════════ */

  function drawSetup() {
    var p = pal();

    var m = menuGeom(), cx = W >> 1;
    panelFrame(m);

    var gx = cx - (GWID >> 1), gy = m.top + m.bandY, r, c;
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
    var lbl = shC + ' X ' + shR;
    hud(lbl, cx - (fb.textW(lbl,1) >> 1), m.top + m.labelY, p.hudInk);

    /* The settings cycle rather than all showing at once: one row holds any
       number of them, and the panel does not have to grow to add more. The
       row takes the exact frame SOLO wears on the front page, as DEAL takes
       MULTIPLAYER's — crossing between the screens, the boxes stand still. */
    var rowW = Math.min(160, m.pw - 32);
    sceneRow(m.top + m.row1Y, rowW);

    menuButton(m.top + m.row2Y, rowW, 'DEAL', { t:'deal' });
    backArrow(m);
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
    fb.dim(b.x + (depth-1)*2 + 3, b.y + (depth-1)*2 + 4, CARD_W, CARD_H, 0.55);
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
      fb.dim(b.x, ly, CARD_W, CARD_H, 0.62);
    }

    if (g.phase === 'RESURRECT' && !pile.alive && !fx) {
      /* Glow rather than dim: these are the piles asking to be chosen.
         The glow used to carry two keylines two pixels clear of the card,
         which is wider than the gap between piles — so two dead piles side by
         side had their halos meet and read as one tall block rather than two
         choices. The pulse alone says the same thing and stops at the card's
         own edge. The target still takes the old margin; it just isn't drawn. */
      var puls = 0.30 + 0.30 * (Math.sin(now / 180) * 0.5 + 0.5);
      fb.tint(b.x, ly, CARD_W, CARD_H, p.lit, puls);
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

    var b = boardBox(), i;
    for (i = 0; i < g.size; i++) drawPile(i);

    // ── stock ──
    var s = stockBox();
    if (s.big) {
      fb.dim(s.x+3, s.y+4, CARD_W, CARD_H, 0.55);
      if (HiLo.stockLeft(g) > 0) cardBack(fb, s.x, s.y, CARD_W, CARD_H, p);
      else { fb.frame(s.x, s.y, CARD_W, CARD_H, p.hudDim); }
      if (g.phase === 'PLAY' || g.phase === 'RESURRECT') {
        /* Above the deck by default, so the count stays clear of the calls.
           A board one row deep starts at the top, which puts that figure up
           beside the mark — those rows ask for it underneath instead.
           One line, figure then label, centred on the card: at six pixels a
           character the longest it ever reads is 41 against the card's 54. */
        var sc = String(HiLo.stockLeft(g));
        var lead = fb.textW(sc + ' ', 1) + 1;      // where the label starts
        var tw = lead + fb.textW('LEFT', 1);
        var tx = s.x + ((CARD_W - tw) >> 1);
        var ty = s.y - 11;
        /* Under the deck in a room. Above it, the figure competes with the
           scoreboard and the clock for the same band of sky; solo keeps the
           per-grid answer the layout table tuned for it. */
        if (mp() && rm().countBelow) {
          ty = s.y + CARD_H + 6;
        } else if (L.rowFor(g.cols, g.rows, device, W > H).count === 'below') {
          ty = s.y + CARD_H + 6;
        } else if (device !== 'desktop') {
          /* Off the desktop the board lands where it lands, so check rather
             than assume: if the figure would sit on the ground plane, drop it
             under the deck instead. Desktop is left exactly as tuned. */
          var pad = 12 / scale;
          if (ty + 7 > GROUND*H - pad && ty < GROUND*H + pad) {
            ty = s.y + CARD_H + 6;
          }
        }
        hud(sc, tx, ty, p.hudInk);
        hud('LEFT', tx + lead, ty, p.hudDim);
      }
    }

    // ── HUD ──
    // The mark is the way back to the menu. Nothing else lives up here:
    // the stock count is already under the deck, and how many piles are alive
    // is plain from the board.
    /* Drawn on the layer behind, so its box has to be converted from that
       layer's units into these to stay clickable and to draw its hover. */
    var q = worldScale / scale;
    var wmR = { x: Math.round(WM_X*q), y: Math.round(WM_Y*q),
                w: Math.round((splitMarkW(1) + 12)*q),
                h: Math.round((splitMarkH(1) + 10)*q) };
    if (inside(wmR)) fb.frame(wmR.x, wmR.y, wmR.w, wmR.h, p.hudInk);
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
      fb.dim(ax+3, ay+4, CARD_W, CARD_H, 0.55);
      cardFace(fb, ax, ay, CARD_W, CARD_H, HiLo.rankChar(fx.card), HiLo.suitChar(fx.card), p);
    }

    /* Under the field rather than in the sky band. Which "under" depends on
       where the calls went: beside the board leaves the space below it free,
       beneath the board does not — and the first version of this put the
       scoreboard straight through the call buttons. The strip takes a centre
       and a baseline and nothing else, so this stays two numbers. */
    if (mp()) {
      /* Beside the board there is width for one row; beneath it there is not,
         and four cells strung across a phone ran off both edges and cut the
         names. Two up, two down, on the board's own width. The extra drop is
         so the block does not crowd PICK A PILE. */
      var R = rm();
      if (R.stripFlank && flanksFit()) {
        drawFlanks(b);
      } else {
        var twoUp = R.stripCols < g.players;
        var stripY = uiSide ? b.y + b.h + 16
                            : b.y + b.h + 14 + 20 + R.stripDrop;
        var blockH2 = twoUp ? 37 : 16;
        strip(b.x + (b.w >> 1), Math.min(stripY, H - blockH2 - 8), b.w, twoUp);
      }
    }
    if (mockPops && !pops.length) {
      var KINDS = [['PLACE', HiLo.PAYS.PLACE], ['SUIT', HiLo.PAYS.SUIT],
                   ['SPLIT', HiLo.PAYS.SPLIT], ['KILL', HiLo.PAYS.KILL]];
      for (var mi = 0; mi < KINDS.length; mi++) {
        pops.push({ pile: mi * 5, v: KINDS[mi][1], kind: KINDS[mi][0], at: now });
      }
    }
    if (mp()) drawPops();
    if (mp()) drawClock();
    if (g.phase === 'WON' || g.phase === 'LOST') {
      if (mp()) drawStandings(); else drawResult();
    } else if (!fx) drawCalls(b);
  }

  /* The calls, in whichever place the layout put them. */
  function drawCalls(b) {
    var p = pal(), on = g.selected >= 0 && (!mp() || myTurn());
    var resurrecting = (g.phase === 'RESURRECT');
    /* Suit is the fourth call and multiplayer only, so the column is three
       tall in solo and four in a room. Only 4x4 is dealt in a room, which is
       why this can grow the stack without re-verifying sixteen grids. */
    var suit = mp();

    if (uiSide) {
      var cw = SIDE_W, ch = 18, gp = 8, rows = suit ? 4 : 3;
      var stackH = rows*ch + (rows-1)*gp;
      var cx = b.x + b.w + 26;
      /* In a room the column is set in from the right border by the same
         margin the deck keeps from the left, so the two flanks balance around
         the board rather than the calls hugging it. Only when the deck is
         actually beside the board — the narrow arrangement puts it in the
         corner, where there is no margin to mirror — and never so far left
         that it lands on the board. Solo keeps the fixed step it was tuned
         with. */
      if (mp()) {
        var deck = stockBox();
        if (deck.big) {
          var mirrored = W - cw - deck.x;
          if (mirrored > b.x + b.w + 12) cx = mirrored;
        }
      }
      // Bottom-aligned with the board, mirroring the deck on the other side.
      var cy = b.y + b.h - stackH;
      var mid = function (str) { return cx + ((cw - fb.textW(str,1)) >> 1); };
      if (resurrecting) {
        hud('SPLIT', mid('SPLIT'), cy + 25, p.hudInk);
        hud('REVIVE A PILE', mid('REVIVE A PILE'), cy + 38, p.hudInk);
        return;
      }
      /* The label is not the action. game.js still hears HI, LO and SPLIT,
         so a log replays the same whatever these come to read. */
      button(cx, cy, cw, 'HIGH', { t:'call', call:'HI' }, on, 'hot');
      button(cx, cy + ch + gp, cw, 'LOW', { t:'call', call:'LO' }, on, 'cold');
      /* Suit slots in above Split in a room, so Split stays the foot of the
         column whether there are three calls or four. */
      if (suit) {
        button(cx, cy + 2*(ch + gp), cw, 'SUIT',  { t:'call', call:'SUIT' },  on);
        button(cx, cy + 3*(ch + gp), cw, 'SPLIT', { t:'call', call:'SPLIT' }, on, 'cut');
      } else {
        button(cx, cy + 2*(ch + gp), cw, 'SPLIT', { t:'call', call:'SPLIT' }, on, 'cut');
      }
      if (!on) {
        /* Always under the calls in a room — above them it sat against the
           board's top edge, which is now where the eye starts. */
        var under = suit || L.rowFor(g.cols, g.rows, device, W > H).pickUnder;
        hud('PICK A PILE', mid('PICK A PILE'),
            under ? cy + stackH + 6 : cy - 13, p.hudDim);
      }
      return;
    }

    var by = b.y + b.h + 14;
    if (resurrecting) {
      var m2 = 'SPLIT - REVIVE A PILE';
      hud(m2, (W - fb.textW(m2,1)) >> 1, by + 5, p.hudInk);
      return;
    }
    /* The row is as wide as the cards above it and shares their edges — the
       calls and the board read as one block rather than a wide thing over a
       narrow one. Widths are divided from that span rather than fixed, so the
       four never add up to something the board's width has to accommodate. */
    var n = suit ? 4 : 3, gapb = 7;
    var span = rm().callSpan === 'board' ? b.w : Math.min(b.w, CALLS_W + 24);
    var each = Math.floor((span - gapb * (n - 1)) / n);
    var tot = each * n + gapb * (n - 1);
    var cxr = b.x + ((b.w - tot) >> 1);
    var LABELS = suit ? [['HIGH','HI','hot'], ['LOW','LO','cold'],
                         ['SPLIT','SPLIT','cut'], ['SUIT','SUIT', null]]
                      : [['HIGH','HI','hot'], ['LOW','LO','cold'],
                         ['SPLIT','SPLIT','cut']];
    for (var q = 0; q < LABELS.length; q++) {
      button(cxr, by, each, LABELS[q][0], { t:'call', call:LABELS[q][1] }, on, LABELS[q][2]);
      cxr += each + gapb;
    }
    if (!on) {
      var m = 'PICK A PILE';
      hud(m, b.x + ((b.w - fb.textW(m,1)) >> 1), by + 24, p.hudDim);
    }
  }

  /* The result reads as a card laid over the table, so it does not have to fit
     whichever gap the layout happened to leave. */
  function drawResult() {
    var p = pal();
    fb.dim(0, 0, W, H, 0.45);
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
    fb.dim(0, 0, W, H, 0.45);

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
    leaveRoom();
    screen = 'MENU'; g = null; fx = null; confirmMenu = false;
    fit();
    if (history.replaceState) history.replaceState(null, '', location.pathname);
    say('Split. Solo or play with friends.');
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
    /* The points show when the card lands. Raised at the moment of the call
       instead, the figure sat over a pile whose card was still in the air.
       g.last still describes this call: applyRemote flushes the running fx
       before applying the next action, so nothing has overwritten it. */
    if (was.kind === 'deal' && mp() && g) {
      var pay = payFor(g.last);
      if (pay) pops.push({ pile: was.pile, v: pay.v, kind: pay.kind, at: now });
    }
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

  /* ── the room, from this side ──
     One handler per server message. The client never decides anything about
     the game: it applies what arrives, in the order it arrives. */
  function enterRoom(code) {
    netMsg = 'CONNECTING…';
    if (net) net.close();
    mpOver = null;
    net = Net.join(code, Net.name() || 'PLAYER', {
      SYNC: function (m) {
        room = m;
        netMsg = '';
        if (m.started) {
          g = HiLo.replay(m.seed, m.cols, m.rows, m.players, m.log);
          /* A resync replays the whole log at once. Anything still on screen
             belongs to the game before the reconnect. */
          screen = 'GAME'; fx = null; focus = 0; pops.length = 0;
          turnEndsAt = m.msLeft > 0 ? Date.now() + m.msLeft : 0;
          turnSpan = m.msLeft > 0 ? m.msLeft : 0;
          fit();
        } else if (screen !== 'LOBBY') { screen = 'LOBBY'; fit(); }
        if (history.replaceState) {
          history.replaceState(null, '', location.pathname + '?room=' + m.code);
        }
        say('In room ' + m.code.split('').join(' ') + '.');
      },
      ROSTER: function (m) { if (room) room.seats = m.seats; },
      BEGIN: function (m) {
        if (room) room.seats = m.seats;
        g = HiLo.create(m.seed, m.cols, m.rows, m.players);
        screen = 'GAME'; fx = null; focus = 0; mpOver = null;
        turnEndsAt = 0; turnSpan = 0; pops.length = 0;
        fit();
        say('Game started. ' + m.players + ' players.');
      },
      ACT:  function (m) { applyRemote(m.action); },
      TURN: function (m) {
        /* Guarded on > 0 rather than on truthiness. A turn nobody is on the
           clock for sends 0, and a server that ever sends a negative must not
           be read as "a clock that ran out" — that is what put a frozen 0 in
           the corner for the length of every bot's turn. */
        turnEndsAt = m.msLeft > 0 ? Date.now() + m.msLeft : 0;
        turnSpan = m.msLeft > 0 ? m.msLeft : 0;
        if (m.turn === mySeat()) say('Your turn.');
      },
      TIMEOUT: function (m) {
        netMsg = '';
        if (m.seat === mySeat()) say('You ran out of time.');
      },
      OVER: function (m) { mpOver = m; turnEndsAt = 0; turnSpan = 0; describe(); },
      ERR:  function (m) { netMsg = String(m.msg || '').toUpperCase(); },
      drop: function () { netMsg = 'RECONNECTING…'; },
      open: function () { if (netMsg === 'RECONNECTING…') netMsg = ''; }
    });
  }

  /* An action the server accepted. A call is animated the same way a solo
     call is, so a remote player's move reads exactly like your own. */
  function applyRemote(action) {
    if (!g) return;
    flushFx();
    if (action.t === 'CALL' && g.selected >= 0) {
      var i = g.selected, card = g.deck[g.next];
      var from = stockBox(), to = pileBox(i);
      HiLo.apply(g, action);
      fx = { kind:'deal', pile:i, card:card, t:0, dur:DEAL_MS,
             fx: from.big ? from.x : W-40, fy: from.big ? from.y : 10,
             tx: to.x, ty: to.y };
      return;
    }
    HiLo.apply(g, action);
  }

  /* The address bar carries ?room= only while you are actually in one.
     Joining writes it so a refresh reconnects to the same seat; leaving has
     to take it off again, or the next refresh offers to rejoin a game you
     deliberately walked out of. Play Again is where this showed: it leaves
     the room for the profile screen, and a refresh there landed on JOIN
     <dead code> instead of the menu.

     Only the room key is removed. A seed or a setting in the same query
     string belongs to the player, not to the room, and survives. */
  function dropRoomFromUrl() {
    if (!history.replaceState) return;
    try {
      var q = new URLSearchParams(location.search);
      if (!q.has('room')) return;
      q['delete']('room');
      var rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
    } catch (e) { /* a browser without URLSearchParams keeps its stale link */ }
  }

  function leaveRoom() {
    if (queued) { queued.leave(); queued = null; }
    if (net) net.close();
    net = null; room = null; mpOver = null; turnEndsAt = 0; turnSpan = 0; netMsg = '';
    pops.length = 0;
    typing = null; roomMode = 'pick';
    pendingRoom = '';
    dropRoomFromUrl();
  }

  function dispatch(act) {
    if (!act) return;
    if (act.t === 'solo')  { screen = 'SETUP'; fit(); say('Choose a grid size and a setting, then deal.'); return; }
    if (act.t === 'multiplayer') { screen = 'MODE'; fit(); say('Play online, or play with friends.'); return; }

    if (act.t === 'mp-friends') {
      screen = 'ROOM'; roomMode = 'pick'; netMsg = ''; typing = null;
      fit(); say('Host a game, or join one.'); return;
    }

    /* The name is a step on the way in, not a gate in front of the choice.
       Whatever asked for it is remembered so the player lands where they
       were going rather than back at the fork. */
    function askName(next) {
      afterName = next; roomMode = 'name'; netMsg = '';
      typing = { field: 'name', value: Net.name() };
      say('Enter a name.');
    }
    if (act.t === 'mp-name-go') {
      if (!Net.name()) { netMsg = 'A NAME FIRST'; return; }
      typing = null; netMsg = '';
      var next = afterName; afterName = '';
      if (next === 'host') return dispatch({ t: 'mp-host' });
      if (next === 'link') return dispatch({ t: 'mp-join-link' });
      roomMode = 'join'; typing = { field: 'code', value: '' };
      say('Enter the room code.');
      return;
    }
    if (act.t === 'mp-online') {
      screen = 'ONLINE'; netMsg = ''; typing = null;
      fit(); say('Choose a name, an avatar and a setting.'); return;
    }
    if (act.t === 'mp-avatar') { Net.avatar(act.i); return; }

    if (act.t === 'mp-find') {
      if (!Net.name()) { netMsg = 'A NAME FIRST'; typing = { field:'name', value:'' }; return; }
      screen = 'SEARCH'; netMsg = ''; typing = null;
      fit(); say('Searching for a game.');
      queued = Net.queue(Net.name(), {
        /* Still worth hearing even though the count is not shown: it is
           the queue confirming you are in it. */
        WAITING: function () { netMsg = ''; },
        MATCH: function (m) {
          /* The queue closes its own socket once it has matched you, so this
             is not a drop — tell the client that before joining the room, or
             it reports a lost connection on the way to a game. */
          if (queued) queued.matched();
          queued = null;
          say('Match found. Joining.');
          enterRoom(m.code);
        },
        ERR:  function (m) { netMsg = String(m.msg || '').toUpperCase(); },
        drop: function () { netMsg = 'LOST THE QUEUE'; }
      });
      return;
    }
    if (act.t === 'mp-unqueue') {
      if (queued) queued.leave();
      queued = null; netMsg = '';
      screen = 'ONLINE'; fit(); say('Choose a name, an avatar and a setting.');
      return;
    }
    if (act.t === 'mp-type-name') { typing = { field:'name', value: Net.name() }; return; }
    if (act.t === 'mp-type-code') { typing = { field:'code', value: typing ? typing.value : '' }; return; }
    if (act.t === 'mp-join-pick') {
      if (!Net.name()) return askName('join');
      roomMode = 'join'; netMsg = ''; typing = { field:'code', value:'' };
      say('Enter the room code.'); return;
    }
    if (act.t === 'mp-host') {
      pendingRoom = '';
      if (!Net.name()) return askName('host');
      netMsg = 'MAKING A ROOM…';
      Net.createRoom().then(function (r) { enterRoom(r.code); })
                      .catch(function () { netMsg = 'COULD NOT REACH THE SERVER'; });
      return;
    }
    if (act.t === 'mp-join-go') {
      var code = (typing && typing.value || '').toUpperCase();
      if (code.length !== 4) { netMsg = 'FOUR LETTERS'; return; }
      if (!Net.name()) return askName('join');
      netMsg = 'LOOKING…';
      Net.probeRoom(code).then(function (r) {
        if (!r.exists) { netMsg = 'NO ROOM ' + code; return; }
        if (r.started) { netMsg = 'THAT GAME HAS STARTED'; return; }
        typing = null; enterRoom(code);
      }).catch(function () { netMsg = 'COULD NOT REACH THE SERVER'; });
      return;
    }
    if (act.t === 'mp-join-link') {
      if (!Net.name()) return askName('link');
      var pc = pendingRoom; pendingRoom = ''; typing = null;
      enterRoom(pc); return;
    }
    if (act.t === 'mp-start') { if (net) net.start(); return; }
    if (act.t === 'mp-copy') {
      var link = Net.linkFor(room ? room.code : '');
      try {
        navigator.clipboard.writeText(link);
        netMsg = 'LINK COPIED';
      } catch (e) { netMsg = link.replace(/^https?:\/\//, '').toUpperCase(); }
      return;
    }
    if (act.t === 'mp-leave') { leaveRoom(); toMenu(); return; }
    if (act.t === 'mp-again') {
      leaveRoom();
      screen = 'ONLINE'; typing = null; netMsg = ''; fit();
      say('Choose a name, an avatar and a setting.');
      return;
    }

    if (act.t === 'back')  {
      if (screen === 'MODE') { toMenu(); return; }
      if (screen === 'ONLINE') { screen = 'MODE'; typing = null; netMsg = ''; fit(); return; }
      if (screen === 'SEARCH') return dispatch({ t: 'mp-unqueue' });
      if (screen === 'ROOM') {
        if (roomMode !== 'pick') {
          roomMode = 'pick'; typing = null; netMsg = ''; afterName = '';
          say('Host a game, or join one.'); return;
        }
        /* Backing out of the join screen abandons the invite too. Without
           this the code stayed in the address bar and in pendingRoom, and
           the next refresh walked straight back into the screen just left. */
        pendingRoom = ''; dropRoomFromUrl();
        screen = 'MODE'; typing = null; netMsg = ''; fit(); return;
      }
      if (screen === 'LOBBY') { leaveRoom(); screen = 'MODE'; fit(); return; }
      toMenu(); return;
    }
    if (act.t === 'grid')  { pickC = act.c; pickR = act.r; return; }
    if (act.t === 'scene') { pickScene = act.i; bgDirty = true; return; }
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
    /* In a room the move is a request, not a change: send it and wait for the
       server to echo it back. Nothing is applied locally first, so there is
       never a board to roll back. Being turn-based is what makes that cost
       one round trip rather than a whole prediction layer. */
    if (mp()) {
      if (!myTurn()) return;
      if (act.t === 'select') { focus = act.pile; net.act({ t:'SELECT', pile:act.pile }); return; }
      if (act.t === 'call')   { net.act({ t:'CALL', call:act.call }); return; }
      if (act.t === 'revive') { net.act({ t:'REVIVE', pile:act.pile }); return; }
      return;
    }

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

  /* ── a room with nobody in it ──
     `?mock=` builds a multiplayer board locally, with no server and no second
     player, so the scoreboard, the fourth call and the standings can be
     designed by editing and reloading rather than by getting four people into
     a lobby. It is the same idea as `?seed=`, which has always let a solo deal
     be named in the URL.

     It drives the *real* drawing code — the mock only stands in for the wire,
     which is why what you see here is what ships. Actions apply locally so the
     board stays explorable; nothing it does can touch a real room. */
  function startMock(kind) {
    var seed = 20260828;
    g = HiLo.create(seed, 4, 4, 4);

    room = {
      code: 'MOCK', you: 0, started: true,
      seats: [
        { seat:0, name:'ALPHA',   av:0, host:true,  connected:true },
        { seat:1, name:'BEA',     av:3, host:false, connected:true },
        { seat:2, name:'CASIMIR', av:5, host:false, connected:true },
        { seat:3, name:'DOT',     av:6, host:false, connected:false }
      ]
    };
    /* Enough of a socket for mp() to be true. Acts apply straight to the
       board — a design harness you cannot click through is half a harness. */
    net = {
      act: function (a) {
        a.by = g.turn;
        var was = g.turn;
        applyRemote(a);
        if (g.turn !== was) { turnEndsAt = Date.now() + 10000; turnSpan = 10000; }
      },
      start: function () {}, close: function () {}, live: function () { return true; }
    };

    /* Play a deterministic stretch so the board is not a fresh deal: some
       piles down, scores spread, somebody clearly ahead. */
    var rnd = (function (s) {
      return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    })(seed);
    var steps = kind === 'fresh' ? 0 : 14;
    for (var n = 0; n < steps && g.phase === 'PLAY'; n++) {
      var alive = [];
      for (var i = 0; i < g.size; i++) if (g.piles[i].alive) alive.push(i);
      if (!alive.length) break;
      var pick = alive[(rnd() * alive.length) | 0];
      HiLo.apply(g, { t:'SELECT', pile:pick, by:g.turn });
      var r = rnd();
      var call = r < 0.55 ? (HiLo.value(g.deck[g.next]) > HiLo.value(HiLo.top(g, pick)) ? 'HI' : 'LO')
               : r < 0.8  ? 'HI' : (r < 0.93 ? 'LO' : 'SUIT');
      HiLo.apply(g, { t:'CALL', call:call, by:g.turn });
      if (g.phase === 'RESURRECT' && kind !== 'split') {
        var dead = 0; while (dead < g.size && g.piles[dead].alive) dead++;
        if (dead < g.size) HiLo.apply(g, { t:'REVIVE', pile:dead, by:g.turn });
      }
      if (g.phase === 'RESURRECT' && kind === 'split') break;
    }

    /* Whether the played stretch happens to land on a Split is luck, and a
       state you can only reach by luck is not a harness. Put the board there
       directly: a pile down, and the game holding for a choice. */
    if (kind === 'split' && g.phase !== 'RESURRECT') {
      var k = 0; while (k < g.size && !g.piles[k].alive) k++;
      if (k < g.size) g.piles[k].alive = false;
      g.phase = 'RESURRECT';
      g.selected = -1;
    }

    if (kind === 'over') {
      /* Stop the game where the standings are worth looking at: a close top
         two and somebody well behind. */
      g.phase = 'WON';
      g.scores[0].placements = 6; g.scores[0].suits = 1; g.scores[0].splits = 1;
      g.scores[0].kills = 2; g.scores[0].score = 11;
      g.scores[1].placements = 7; g.scores[1].suits = 0; g.scores[1].splits = 1;
      g.scores[1].kills = 3; g.scores[1].score = 10;
      g.scores[2].placements = 4; g.scores[2].suits = 2; g.scores[2].splits = 0;
      g.scores[2].kills = 4; g.scores[2].score = 0;
      g.scores[3].placements = 2; g.scores[3].suits = 0; g.scores[3].splits = 0;
      g.scores[3].kills = 5; g.scores[3].score = -8;
      mpOver = { phase:'WON', scores:g.scores, standings:HiLo.standings(g) };
    }

    /* `wait` shows the screen you see on somebody else's turn: calls dead,
       the accent and the clock on their cell rather than yours. */
    if (kind === 'wait' && g.turn === 0) g.turn = 1;
    if (kind === 'turn') g.turn = 0;

    /* `turn` opens with a pile already picked, because the calls only wear
       their ramps while they are live — an unselected board shows four grey
       buttons, which is not the thing anyone is here to look at. */
    if (kind === 'turn' && g.phase === 'PLAY' && g.selected < 0) {
      var a = 0; while (a < g.size && !g.piles[a].alive) a++;
      if (a < g.size) HiLo.apply(g, { t: 'SELECT', pile: a, by: g.turn });
    }

    turnEndsAt = (kind === 'over') ? 0 : Date.now() + 7000;
    turnSpan = turnEndsAt ? 10000 : 0;
    screen = 'GAME'; fx = null; focus = 0;
    fit();
    say('Mock room. Nothing here is live.');
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
    if (fx) {
      flushFx();
      if (!(g && (g.phase === 'WON' || g.phase === 'LOST'))) return;
    }
    for (var i = hits.length - 1; i >= 0; i--) {
      var h = hits[i];
      if (q.x >= h.x && q.x < h.x+h.w && q.y >= h.y && q.y < h.y+h.h) { dispatch(h.act); return; }
    }
  }

  function onKey(e) {
    var k = e.key;

    /* A field has the keyboard while it is open, so Enter commits rather
       than doing whatever the screen behind would have done with it. */
    if (typing) {
      if (k === 'Enter') {
        if (typing.field === 'name') {
          Net.name(typing.value.trim() || 'PLAYER');
          /* On the online screen the name is one field among several, so
             committing it stays put; in the room flow it is a step on the
             way somewhere, so it continues. */
          if (screen === 'ONLINE') typing = null;
          else dispatch({ t: 'mp-name-go' });
        }
        else dispatch({ t: 'mp-join-go' });
        e.preventDefault(); return;
      }
      if (k === 'Escape') { typing = null; e.preventDefault(); return; }
      if (k === 'Backspace') {
        typing.value = typing.value.slice(0, -1);
        if (typing.field === 'name') Net.name(typing.value);
        e.preventDefault(); return;
      }
      if (k.length === 1) {
        var cap = typing.field === 'code' ? 4 : 12;
        var ch = k.toUpperCase();
        var okc = typing.field === 'code' ? /[2-9A-HJ-NP-Z]/.test(ch) : /[A-Z0-9 ]/.test(ch);
        if (okc && typing.value.length < cap) {
          typing.value += ch;
          if (typing.field === 'name') Net.name(typing.value);
        }
        e.preventDefault(); return;
      }
      return;
    }

    if (screen === 'MODE' || screen === 'ROOM' || screen === 'LOBBY' ||
        screen === 'ONLINE' || screen === 'SEARCH') {
      if (k === 'Escape') { dispatch({ t:'back' }); e.preventDefault(); }
      return;
    }
    if (screen === 'MENU') {
      if (k === 'Enter' || k === ' ') { dispatch({ t:'solo' }); e.preventDefault(); }
      else if (k === 'm' || k === 'M') { dispatch({ t:'multiplayer' }); e.preventDefault(); }
      else return;
      e.preventDefault(); return;
    }
    if (screen === 'SETUP') {
      if (k === 'Enter' || k === ' ') { dispatch({ t:'deal' }); e.preventDefault(); }
      else if (k === 'Escape') { dispatch({ t:'back' }); e.preventDefault(); }
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
    if (/^(Arrow(Right|Left|Down|Up)|Enter| |[hHlLsSuU])$/.test(k)) kbNav = true;
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
    else if (k === 'u' || k === 'U') { dispatch({ t:'call', call:'SUIT' }); return; }
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

    if (bgDirty) drawBackground();
    else if (bgMotion) drawBackgroundMotion();

    hits.length = 0;
    fb.clear();
    if (screen === 'MENU') drawMenu();
    else if (screen === 'SETUP') drawSetup();
    else if (screen === 'MODE') drawMode();
    else if (screen === 'ROOM') drawRoom();
    else if (screen === 'ONLINE') drawOnline();
    else if (screen === 'SEARCH') drawSearch();
    else if (screen === 'LOBBY') drawLobby();
    else { drawGame(); if (confirmMenu) drawConfirm(); }

    var img = ctx.createImageData(W, H);
    img.data.set(fb.d);
    ctx.putImageData(img, 0, 0);
  }

  function boot() {
    canvas = document.getElementById('stage');
    ctx = canvas.getContext('2d');
    bgCanvas = document.getElementById('bg');
    bgCtx = bgCanvas.getContext('2d');
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
      /* A shared room link lands on the name field with the code already
         held, so the invitee types one thing and is in. */
      /* ?mock=turn|wait|split|over|fresh — a multiplayer board with no
         server behind it, for designing the room screens. */
      var mk = q.get('mock');
      /* ?mock=search is the odd one out: no board at all, just the wheel with
         nobody behind it. Searching is a state you pass through, so without
         this there is no way to sit and look at it. */
      if (mk === 'search') { screen = 'SEARCH'; }
      else if (mk) { startMock(mk === 'pop' ? 'turn' : mk); mockPops = (mk === 'pop'); }

      var rc = mk ? '' : Net.codeFromUrl();
      if (rc) {
        pendingRoom = rc;
        screen = 'ROOM'; roomMode = 'pick';
        if (!Net.name()) typing = { field: 'name', value: '' };
      }
    } catch (e) {
      /* A malformed link should just open the menu rather than a broken page.
         But swallowing the reason silently makes a debug link that throws look
         exactly like one the app chose to ignore, which cost real time to
         diagnose — so it is ignored out loud. */
      if (window.console) console.warn('boot: ignoring URL state —', e && e.message);
    }

    window.addEventListener('resize', fit);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerleave', function () { mouse.x = mouse.y = -1e5; });
    window.addEventListener('keydown', onKey);
    say('Split. Solo or play with friends.');
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
