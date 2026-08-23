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
     hudGap – centre in the space under the wordmark rather than the canvas
     count  – which side of the deck its remaining-cards figure sits on. Above
              is the default; on a board one row deep the deck starts at the
              top, which puts that figure up beside the wordmark             */
  var GRIDS = {
    '1x1': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false },
    '1x2': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false },
    '1x3': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false },
    '1x4': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false },

    '2x1': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false },
    '2x2': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false },
    '2x3': { count:'above', edge:20, head:97, sideH:42, fine:true,  hudGap:true  },
    '2x4': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false },

    '3x1': { count:'below', edge:20, head:64, sideH:8, fine:false, hudGap:false },
    '3x2': { count:'above', edge:20, head:64, sideH:8, fine:true,  hudGap:false, sideFit:true, sideEdge:13 },
    '3x3': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false },
    '3x4': { count:'above', edge:20, head:64, sideH:8, fine:false, hudGap:false },

    '4x1': { count:'below', edge:26, head:64, sideH:8, fine:true,  hudGap:false, withDeck:true },
    '4x2': { count:'above', edge:26, head:64, sideH:8, fine:true,  hudGap:false, sideFit:true, sideEdge:15 },
    '4x3': { count:'above', edge:26, head:64, sideH:42, fine:true,  hudGap:false },
    '4x4': { count:'above', edge:26, head:64, sideH:54, fine:true,  hudGap:false }
  };

  function clampGrid(n) { return Math.max(1, Math.min(4, n | 0)); }
  function rowFor(cols, rows) {
    return GRIDS[clampGrid(cols) + 'x' + clampGrid(rows)];
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
    return [
      { side:false, w: Math.max(bw + (CARD_W + 26) + 40, CALLS_W + 24), h: bh + row.head },
      { side:false, w: Math.max(bw + row.edge,           CALLS_W + 24), h: bh + row.head },
      { side:true,  w: row.sideFit
            ? bw + (CARD_W + 26) + (SIDE_W + 26) + 2*(row.sideEdge || 8)
            : bw + (CARD_W + 26) + SIDE_W + 36,                          h: bh + row.sideH }
    ];
  }

  function game(cols, rows, vw, vh, dpr) {
    var row = rowFor(cols, rows), ps = plans(cols, rows, row);
    var scale = 1, uiSide = false;
    for (var i = 0; i < ps.length; i++) {
      var sc = step(ps[i].w, ps[i].h, vw, vh, row.fine, dpr);
      if (sc > scale) { scale = sc; uiSide = ps[i].side; }
    }
    /* A board that keeps its deck takes the arrangement with room for it as
       long as that is nearly free. On a screen too narrow to hold the columns
       and the deck together, buying the deck would cost most of the card, so
       there it keeps the cards and the deck goes back to the corner. */
    if (row.withDeck) {
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
  function world(vw, vh, dpr) { return game(3, 3, vw, vh, dpr).scale; }

  /* Where the board sits in the canvas the scale produced. */
  function board(cols, rows, W, H, uiSide) {
    var row = rowFor(cols, rows);
    var bw = boardW(cols), bh = boardH(rows);
    var blockH = uiSide ? bh : bh + 14 + 18;
    var y;
    if (!uiSide && row.hudGap) {
      y = Math.max(18, 30 + Math.round((H - 30 - blockH - 21) / 2));
    } else {
      y = Math.max(uiSide ? 4 : 18, Math.round((H - blockH) / 2));
    }
    var lean = (uiSide && row.sideFit) ? Math.round((SIDE_W - CARD_W) / 2) : 0;
    var big  = (W - bw) / 2 >= CARD_W + 44;
    return {
      x: Math.round((W - bw) / 2) - lean, y: y, w: bw, h: bh,
      big: big
    };
  }

  return {
    CARD_W: CARD_W, CARD_H: CARD_H, GAP: GAP,
    SIDE_W: SIDE_W, CALLS_W: CALLS_W, WORLD_MAX: WORLD_MAX, STEPS: STEPS,
    GRIDS: GRIDS, rowFor: rowFor, step: step, game: game, board: board, world: world,
    boardW: boardW, boardH: boardH
  };
})();

if (typeof module !== 'undefined') module.exports = HiLoLayout;
