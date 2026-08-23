/* ── HI LO · sizing ───────────────────────────────────────────────────────
   Every grid gets its own row. Nothing here is shared between them beyond
   the card's dimensions, so a change to one board cannot reach another —
   which is the whole reason this is a table and not a formula with flags.

   Pure and side-effect free: it takes a viewport and returns numbers, so
   the whole space (16 grids x any viewport x either pixel density) can be
   computed and diffed outside a browser before anything ships.
   ──────────────────────────────────────────────────────────────────────── */

var HiLoLayout = (function () {
  'use strict';

  var CARD_W = 54, CARD_H = 74, GAP = 5;
  var SIDE_W = 88;                       // the call column, when beside
  var CALLS_W = 40 + 40 + 54 + 14;       // the call row, when beneath
  var WORLD_MAX = 3;                     // furthest the setting may be zoomed
  var STEPS = [1, 1.5, 2, 2.5, 3];
  var DECK_KEEP = 0.85;                  // what a withDeck board will pay for it

  /* One row per grid.

     edge   – side margin when the board stands alone; on a board that scales
              continuously this is what sets its share of the width, since it
              lands on bw / (bw + edge) of it
     head   – vertical reserve when the calls sit beneath the board
     sideH  – vertical reserve when they sit beside it. On a row that scales
              continuously this is what sets how much height the board takes,
              since it grows until this reserve stops it
     fine   – scale continuously rather than in steps, on a dense screen only
     withDeck– keep the deck in the row: ask outright for the margin the deck
              needs, rather than settling for the arrangement that drops it
              into the corner
     sideFit– when the calls sit beside the board, reserve what the whole row
              (deck | board | calls) actually needs and centre that row, rather
              than centring the board alone. The calls are wider than the deck,
              so a centred board pushes them off the right edge
     sideEdge– margin each end of that row, when sideFit is set
     on     – overrides for one kind of screen, e.g. on:{ tablet:{ sideFit:true } };
              add '-wide' to mean that screen on its side, e.g. 'tablet-wide',
              which is applied after the plain key. Anything not named here
              behaves the same everywhere
     callsBeside– take the calls-beside-the-board arrangement even where
              stacking them underneath would give a bigger card
     pickUnder– put PICK A PILE below the calls rather than above them. The
              calls are as tall as a card, so above a board one row deep the
              label clears the board's own top edge and floats in the sky
     sideDrop– push the board down off centre, in units. A two-row board puts
              its deck-count and its PICK A PILE in the gap between the rows,
              which lands on the scene's horizon; this carries them clear
     hudGap – centre in the space under the wordmark rather than the canvas
     count  – which side of the deck its remaining-cards figure sits on. Above
              is the default; on a board one row deep the deck starts at the
              top, which puts that figure up beside the wordmark             */
  var GRIDS = {
    '1x1': { count:'below', edge:20, head:64, sideH:8, fine:false, hudGap:false, sideFit:true, pickUnder:true,
             /* the calls sit beside the board wherever there is width for
                it, as they do on every deeper board */
             on: { desktop: { callsBeside:true }, 'tablet-wide': { callsBeside:true } } },
    '1x2': { count:'above', edge:20, head:64, sideH:48, fine:true,  hudGap:false, sideDrop:9 },
    '1x3': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false,
             /* three cards tall ran to nine tenths of a phone; stepped it
                lands anywhere from 72% to 89%, so scale it continuously and
                let the reserves set the height. On a tablet on its side it
                sat at 94% where 2x3 and 4x3 sat at 85% — same reserve there */
             on: { phone: { fine:true, head:128, sideH:50 },
                   'tablet-wide': { fine:true, sideH:42 } } },
    '1x4': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false,
             on: { tablet: { sideFit:true }, 'tablet-wide': { fine:true, sideH:54 },
                   phone:         { fine:true, head:134, sideH:140, sideFit:true },
                   'phone-wide': { callsBeside:true, fine:true, sideH:54 } } },

    '2x1': { count:'below', edge:20, head:64, sideH:8, fine:false, hudGap:false, sideFit:true, pickUnder:true,
             /* the calls sit beside the board wherever there is width for
                it, as they do on every deeper board */
             on: { desktop:       { callsBeside:true },
                   'tablet-wide': { callsBeside:true },
                   'phone-wide':  { callsBeside:true } } },
    '2x2': { count:'above', edge:20, head:64, sideH:48, fine:true,  hudGap:false, sideDrop:9 },
    '2x3': { count:'above', edge:20, head:97, sideH:42, fine:true,  hudGap:true,
             on: { phone: { head:128, sideH:50 } } },
    '2x4': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false,
             /* on a tablet on its side, stepped scaling tied with the stacked
                arrangement and the tie went to stacking; 4x4's reserves put
                all four four-row boards on the same footing */
             on: { 'tablet-wide': { fine:true, sideH:54 },
                   phone:         { fine:true, head:134 },
                   'phone-wide': { callsBeside:true, fine:true, sideH:54 } } },

    '3x1': { count:'below', edge:20, head:64, sideH:8, fine:false, hudGap:false, sideFit:true, pickUnder:true,
             /* the calls sit beside the board wherever there is width for
                it, as they do on every deeper board */
             on: { desktop:      { callsBeside:true, fine:true, sideEdge:13 },
                   'tablet-wide': { callsBeside:true },
                   'phone-wide':  { callsBeside:true, fine:true } } },
    '3x2': { count:'above', edge:20, head:64, sideH:48, fine:true,  hudGap:false, sideFit:true, sideEdge:13, sideDrop:9 },
    '3x3': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false,
             on: { phone: { fine:true, head:128, sideH:50 },
                   'tablet-wide': { fine:true, sideH:42 } } },
    '3x4': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false,
             /* on a tablet on its side, stepped scaling tied with the stacked
                arrangement and the tie went to stacking; 4x4's reserves put
                all four four-row boards on the same footing */
             on: { 'tablet-wide': { fine:true, sideH:54 },
                   phone:         { fine:true, head:134 },
                   'phone-wide': { callsBeside:true, fine:true, sideH:54 } } },

    '4x1': { count:'below', edge:26, head:64, sideH:8, fine:true,  hudGap:false, withDeck:true, sideFit:true, pickUnder:true, sideEdge:15,
             /* the calls sit beside the board wherever there is width for
                it, as they do on every deeper board */
             on: { desktop:      { callsBeside:true },
                   'tablet-wide': { callsBeside:true },
                   'phone-wide':  { callsBeside:true } } },
    '4x2': { count:'above', edge:26, head:64, sideH:8, fine:true,  hudGap:false, sideFit:true, sideEdge:15, sideDrop:9,
             /* on a tablet on its side it stacked the calls underneath, which
                bought a bigger card but left no room for the deck */
             on: { 'tablet-wide': { callsBeside:true } } },
    '4x3': { count:'above', edge:26, head:64, sideH:42, fine:true,  hudGap:false,
             /* centred on the board alone it left 96px one side and 10px the
                other on an iPad Air; centre the whole row instead */
             on: { 'tablet-wide': { sideFit:true } } },
    '4x4': { count:'above', edge:26, head:64, sideH:54, fine:true,  hudGap:false,
             /* on a tablet held upright the board filled the screen: cards over
                the wordmark, and PICK A PILE a unit off the bottom edge */
             on: { tablet: { head:112 },
                   phone:  { head:134 } } }
  };

  function clampGrid(n) { return Math.max(1, Math.min(4, n | 0)); }

  /* Which kind of screen this is. Size alone cannot tell a tablet from a
     desktop window of the same proportions — 1180x692 is both an iPad in
     landscape and an ordinary browser window — so the pointer decides, and a
     desktop resized small stays a desktop. Absent that signal it is a desktop,
     which keeps every existing caller on the behaviour it already had. */
  function device(vw, vh, coarse) {
    if (!coarse) return 'desktop';
    return Math.max(vw, vh) <= 950 ? 'phone' : 'tablet';
  }

  /* What a kind of screen wants of every board, before any row speaks. A
     tablet on its side is wide and shallow, so the calls belong beside the
     board there whatever the board is; a row can still say otherwise. */
  var DEFAULTS = { 'tablet-wide': { callsBeside: true } };

  /* A row, with any overrides for this kind of screen folded in. A row says
     what it does everywhere; `on` names the exceptions, so a screen that is
     not mentioned keeps the shared behaviour and cannot drift from it. */
  function rowFor(cols, rows, dev, wide) {
    var row = GRIDS[clampGrid(cols) + 'x' + clampGrid(rows)];
    /* 'tablet' covers the tablet held either way; 'tablet-wide' refines it on
       its side, and is applied second so it wins where both are given. Within
       a key the screen's default goes first and the row's own word second. */
    var keys = wide ? [dev, dev + '-wide'] : [dev];
    var merged = null, i, j, k;
    for (i = 0; i < keys.length; i++) {
      var layers = [DEFAULTS[keys[i]], row.on && row.on[keys[i]]];
      for (j = 0; j < 2; j++) {
        var over = layers[j];
        if (!over) continue;
        if (!merged) { merged = {}; for (k in row) if (k !== 'on') merged[k] = row[k]; }
        for (k in over) merged[k] = over[k];
      }
    }
    return merged || row;
  }

  function boardW(cols) { return cols*CARD_W + (cols-1)*GAP; }
  function boardH(rows) { return rows*CARD_H + (rows-1)*GAP; }

  /* Largest scale that fits. On a dense screen a `fine` grid takes whatever
     actually fits; everything else lands on a clean step, because on a 1x
     display an uneven pixel shows in the dithering. */
  function step(needW, needH, vw, vh, fine, dpr) {
    if (fine && (dpr || 1) >= 2) {
      return Math.max(1, Math.min(WORLD_MAX, Math.min(vw / needW, vh / needH)));
    }
    var best = STEPS[0];
    for (var i = 0; i < STEPS.length; i++) {
      if (STEPS[i] > WORLD_MAX) break;
      if (needW * STEPS[i] <= vw && needH * STEPS[i] <= vh) best = STEPS[i];
    }
    return best;
  }

  /* Three arrangements, richest first: deck beside the board with the calls
     beneath; the board alone with the calls beneath; and the calls in a
     column beside it. Whichever leaves the biggest card wins, ties to the
     earlier — so the calls only move aside when that buys a step, and the
     deck only leaves the table when there is no room for it. */
  /* What a withDeck board asks for: the margin the deck actually needs on
     both sides, since the board is centred. */
  function keepPlan(cols, rows, row) {
    return { side:false, w: Math.max(boardW(cols) + 2*(CARD_W + 44), CALLS_W + 24),
                         h: boardH(rows) + row.head };
  }

  function plans(cols, rows, row) {
    var bw = boardW(cols), bh = boardH(rows);
    var side = { side:true, w: row.sideFit
          ? bw + (CARD_W + 26) + (SIDE_W + 26) + 2*(row.sideEdge || 8)
          : bw + (CARD_W + 26) + SIDE_W + 36,                          h: bh + row.sideH };
    /* Some boards want the calls beside them whatever that costs in scale —
       stacking them underneath would otherwise win on card size alone. */
    if (row.callsBeside) return [side];
    return [
      { side:false, w: Math.max(bw + (CARD_W + 26) + 40, CALLS_W + 24), h: bh + row.head },
      { side:false, w: Math.max(bw + row.edge,           CALLS_W + 24), h: bh + row.head },
      side
    ];
  }

  function game(cols, rows, vw, vh, dpr, coarse) {
    var row = rowFor(cols, rows, device(vw, vh, coarse), vw > vh);
    var ps = plans(cols, rows, row);
    var scale = 1, uiSide = false;
    for (var i = 0; i < ps.length; i++) {
      var sc = step(ps[i].w, ps[i].h, vw, vh, row.fine, dpr);
      if (sc > scale) { scale = sc; uiSide = ps[i].side; }
    }
    /* A board that keeps its deck takes the arrangement with room for it as
       long as that is nearly free. On a screen too narrow to hold the columns
       and the deck together, buying the deck would cost most of the card, so
       there it keeps the cards and the deck goes back to the corner. */
    if (row.withDeck && !row.callsBeside) {
      var k = keepPlan(cols, rows, row);
      var ks = step(k.w, k.h, vw, vh, row.fine, dpr);
      if (ks >= scale * DECK_KEEP) { scale = ks; uiSide = k.side; }
    }
    return {
      scale: scale,
      uiSide: uiSide,
      W: Math.max(120, Math.round(vw / scale)),
      H: Math.max(120, Math.round(vh / scale))
    };
  }

  /* The setting and the wordmark are drawn at their own scale, the same for
     every grid, so the city does not shrink when the board does. Defined as
     whatever a three-row board would take — that is the look this was tuned
     against — and it depends only on the viewport, never on what is dealt. */
  function world(vw, vh, dpr, coarse) { return game(3, 3, vw, vh, dpr, coarse).scale; }

  /* Where the board sits in the canvas the scale produced. */
  function board(cols, rows, W, H, uiSide, dev) {
    var row = rowFor(cols, rows, dev || 'desktop', W > H);
    var bw = boardW(cols), bh = boardH(rows);
    var blockH = uiSide ? bh : bh + 14 + 18;
    var y;
    if (!uiSide && row.hudGap) {
      y = Math.max(18, 30 + Math.round((H - 30 - blockH - 21) / 2));
    } else {
      y = Math.max(uiSide ? 4 : 18, Math.round((H - blockH) / 2));
    }
    if (uiSide && row.sideDrop) y += row.sideDrop;
    var lean = (uiSide && row.sideFit) ? Math.round((SIDE_W - CARD_W) / 2) : 0;
    /* Held upright, a phone or tablet does without the deck: it may have the
       width for the card but not the height to spare beside a board that
       already fills the screen, and the corner figure carries the count
       instead. Turned on its side there is room, so the deck comes back. The
       canvas keeps the viewport's own proportions, so W against H is the
       orientation, and turning the device re-fits and moves the deck. A
       desktop window is not held, and keeps the deck whenever it fits. */
    var big = (W - bw) / 2 >= CARD_W + 44;
    if ((dev === 'phone' || dev === 'tablet') && W <= H) big = false;
    return {
      x: Math.round((W - bw) / 2) - lean, y: y, w: bw, h: bh,
      big: big
    };
  }

  return {
    CARD_W: CARD_W, CARD_H: CARD_H, GAP: GAP,
    SIDE_W: SIDE_W, CALLS_W: CALLS_W, WORLD_MAX: WORLD_MAX, STEPS: STEPS,
    GRIDS: GRIDS, rowFor: rowFor, device: device,
    step: step, game: game, board: board, world: world,
    boardW: boardW, boardH: boardH
  };
})();

if (typeof module !== 'undefined') module.exports = HiLoLayout;
