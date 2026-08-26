/* Software pixel renderer — direct framebuffer, no canvas primitives, so every
   pixel is placed deliberately and nothing is anti-aliased. */

// ── framebuffer ──────────────────────────────────────────────────────────
function FB(w, h) {
  this.w = w; this.h = h;
  this.d = new Uint8ClampedArray(w * h * 4);
}
FB.prototype.px = function (x, y, c) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return;
  var i = (y * this.w + x) * 4;
  this.d[i] = c[0]; this.d[i+1] = c[1]; this.d[i+2] = c[2]; this.d[i+3] = 255;
};
FB.prototype.rect = function (x, y, w, h, c) {
  for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) this.px(x+i, y+j, c);
};
FB.prototype.hline = function (x, y, w, c) { for (var i=0;i<w;i++) this.px(x+i,y,c); };
FB.prototype.vline = function (x, y, h, c) { for (var i=0;i<h;i++) this.px(x,y+i,c); };
FB.prototype.shade = function (x, y, w, h, f) {
  for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
    var px = x+i, py = y+j;
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) continue;
    var k = (py*this.w + px) * 4;
    this.d[k] *= f; this.d[k+1] *= f; this.d[k+2] *= f;
  }
};
/* Darkens a region on a transparent layer. Where something is already drawn
   the pixels are multiplied, exactly as shade does; where nothing is, black is
   written at partial alpha so whatever sits behind the canvas darkens instead.
   That is what lets a card's shadow fall on a background it cannot touch. */
FB.prototype.dim = function (x, y, w, h, f) {
  var a = Math.round((1 - f) * 255);
  for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
    var px = x+i, py = y+j;
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) continue;
    var k = (py*this.w + px) * 4;
    if (this.d[k+3] > 0) { this.d[k] *= f; this.d[k+1] *= f; this.d[k+2] *= f; }
    else { this.d[k] = 0; this.d[k+1] = 0; this.d[k+2] = 0; this.d[k+3] = a; }
  }
};
FB.prototype.clear = function () { this.d.fill(0); };
FB.prototype.frame = function (x, y, w, h, c) {
  this.hline(x, y, w, c); this.hline(x, y+h-1, w, c);
  this.vline(x, y, h, c); this.vline(x+w-1, y, h, c);
};

var hex = function (s) {
  return [parseInt(s.slice(1,3),16), parseInt(s.slice(3,5),16), parseInt(s.slice(5,7),16)];
};

// Bayer 8×8 — the dither that makes a limited palette read as a smooth sky.
var BAYER = [
  [ 0,32, 8,40, 2,34,10,42],[48,16,56,24,50,18,58,26],
  [12,44, 4,36,14,46, 6,38],[60,28,52,20,62,30,54,22],
  [ 3,35,11,43, 1,33, 9,41],[51,19,59,27,49,17,57,25],
  [15,47, 7,39,13,45, 5,37],[63,31,55,23,61,29,53,21]
];

/* Vertical dithered gradient across a ramp of palette colours. `t` is the
   continuous position; the Bayer threshold decides whether a given pixel
   rounds down or up, which is what produces the stipple. */
FB.prototype.skyBand = function (x0, y0, w, h, ramp) {
  for (var y = 0; y < h; y++) {
    var t = (y / (h - 1)) * (ramp.length - 1);
    var lo = Math.floor(t), frac = t - lo;
    for (var x = 0; x < w; x++) {
      var thr = BAYER[y & 7][x & 7] / 64;
      var idx = frac > thr ? lo + 1 : lo;
      this.px(x0 + x, y0 + y, ramp[Math.min(idx, ramp.length - 1)]);
    }
  }
};

// ── bitmap font: 5×7 ─────────────────────────────────────────────────────
var GLYPH = {
  '0':['.###.','#...#','#..##','#.#.#','##..#','#...#','.###.'],
  '1':['..#..','.##..','..#..','..#..','..#..','..#..','.###.'],
  '2':['.###.','#...#','....#','...#.','..#..','.#...','#####'],
  '3':['####.','....#','....#','.###.','....#','....#','####.'],
  '4':['...#.','..##.','.#.#.','#..#.','#####','...#.','...#.'],
  '5':['#####','#....','####.','....#','....#','#...#','.###.'],
  '6':['..##.','.#...','#....','####.','#...#','#...#','.###.'],
  '7':['#####','....#','...#.','..#..','.#...','.#...','.#...'],
  '8':['.###.','#...#','#...#','.###.','#...#','#...#','.###.'],
  '9':['.###.','#...#','#...#','.####','....#','...#.','.##..'],
  'A':['..#..','.#.#.','#...#','#...#','#####','#...#','#...#'],
  'J':['..###','...#.','...#.','...#.','...#.','#..#.','.##..'],
  'Q':['.###.','#...#','#...#','#...#','#.#.#','#..#.','.##.#'],
  'K':['#...#','#..#.','#.#..','##...','#.#..','#..#.','#...#'],
  'i':['.#.','##.','.#.','.#.','.#.','.#.','###'],
  'o':['.##.','#..#','#..#','#..#','#..#','#..#','.##.'],
  '/':['....#','....#','...#.','..#..','.#...','#....','#....'],
  '|':['..#..','..#..','..#..','..#..','..#..','..#..','..#..'],
  '?':['.###.','#...#','....#','...#.','..#..','.....','..#..'],
  '<':['...#.','..#..','.#...','#....','.#...','..#..','...#.'],
  '>':['.#...','..#..','...#.','....#','...#.','..#..','.#...'],
  '-':['.....','.....','.....','#####','.....','.....','.....'],
  '.':['.....','.....','.....','.....','.....','.##..','.##..'],
  'B':['####.','#...#','#...#','####.','#...#','#...#','####.'],
  'C':['.###.','#...#','#....','#....','#....','#...#','.###.'],
  'D':['####.','#...#','#...#','#...#','#...#','#...#','####.'],
  'E':['#####','#....','#....','####.','#....','#....','#####'],
  'F':['#####','#....','#....','####.','#....','#....','#....'],
  'G':['.###.','#...#','#....','#.###','#...#','#...#','.###.'],
  'H':['#...#','#...#','#...#','#####','#...#','#...#','#...#'],
  'I':['.###.','..#..','..#..','..#..','..#..','..#..','.###.'],
  'L':['#....','#....','#....','#....','#....','#....','#####'],
  'M':['#...#','##.##','#.#.#','#.#.#','#...#','#...#','#...#'],
  'N':['#...#','##..#','#.#.#','#..##','#...#','#...#','#...#'],
  'O':['.###.','#...#','#...#','#...#','#...#','#...#','.###.'],
  'P':['####.','#...#','#...#','####.','#....','#....','#....'],
  'R':['####.','#...#','#...#','####.','#.#..','#..#.','#...#'],
  'S':['.###.','#...#','#....','.###.','....#','#...#','.###.'],
  'T':['#####','..#..','..#..','..#..','..#..','..#..','..#..'],
  'U':['#...#','#...#','#...#','#...#','#...#','#...#','.###.'],
  'V':['#...#','#...#','#...#','#...#','#...#','.#.#.','..#..'],
  'W':['#...#','#...#','#...#','#.#.#','#.#.#','##.##','#...#'],
  'X':['#...#','#...#','.#.#.','..#..','.#.#.','#...#','#...#'],
  'Y':['#...#','#...#','.#.#.','..#..','..#..','..#..','..#..'],
  'Z':['#####','....#','...#.','..#..','.#...','#....','#####']
};

// ── suits: 5×6 ───────────────────────────────────────────────────────────
var BIG = {
  S:['......#......','.....###.....','....#####....','...#######...','..#########..',
     '.###########.','#############','#############','#############','.###########.',
     '..####.####..','......#......','.....###.....','....#####....','...#######...'],
  H:['..###...###..','.#####.#####.','#############','#############','#############',
     '#############','.###########.','.###########.','..#########..','..#########..',
     '...#######...','....#####....','.....###.....','......#......','.............'],
  D:['......#......','.....###.....','....#####....','...#######...','..#########..',
     '.###########.','#############','.###########.','..#########..','...#######...',
     '....#####....','.....###.....','......#......','.............','.............'],
  /* The small club at double size, pixel for pixel. It is fourteen by twelve
     where the others are thirteen by fifteen; nothing reads these sizes, they
     are centred from the art itself. */
  C:['....######....','....######....','....######....','....######....',
     '##############','##############','####..##..####','####..##..####',
     '......##......','......##......','....######....','....######....']
};

/* The club is seven wide where the others are five. Three lobes need a centre
   column and two either side, and four-pixel lobes cannot be made symmetric in
   five — which is why the old club was a spade with one pixel missing. Its flat
   top is what separates it from the spade at a glance; rounding it gives back
   the spade's own silhouette. Anything reading these is width-agnostic. */
var SUIT = {
  S:['..#..','.###.','#####','#####','..#..','.###.'],
  H:['.#.#.','#####','#####','#####','.###.','..#..'],
  D:['..#..','.###.','#####','#####','.###.','..#..'],
  C:['..###..','..###..','#######','##.#.##','...#...','..###..']
};

FB.prototype.blit = function (art, x, y, c, flip) {
  var H = art.length;
  for (var j = 0; j < H; j++) {
    var row = art[flip ? H - 1 - j : j];
    for (var i = 0; i < row.length; i++) {
      var ch = row[flip ? row.length - 1 - i : i];
      if (ch !== '.') this.px(x + i, y + j, c);
    }
  }
};
FB.prototype.text = function (s, x, y, c) {
  for (var i = 0; i < s.length; i++) {
    var g = GLYPH[s[i]];
    if (g) this.blit(g, x, y, c);
    x += 6;
  }
};

/* Pip layouts, in the arrangement a real deck actually uses: three columns,
   seven row stops, with the extra pips of 7–10 sitting on the half-steps. */
var PIPS = {
  2:[[1,0],[1,6]],
  3:[[1,0],[1,3],[1,6]],
  4:[[0,0],[2,0],[0,6],[2,6]],
  5:[[0,0],[2,0],[1,3],[0,6],[2,6]],
  6:[[0,0],[2,0],[0,3],[2,3],[0,6],[2,6]],
  7:[[0,0],[2,0],[1,1.5],[0,3],[2,3],[0,6],[2,6]],
  8:[[0,0],[2,0],[1,1.5],[0,3],[2,3],[1,4.5],[0,6],[2,6]],
  9:[[0,0],[2,0],[0,2],[2,2],[1,3],[0,4],[2,4],[0,6],[2,6]],
  10:[[0,0],[2,0],[1,1],[0,2],[2,2],[0,4],[2,4],[1,5],[0,6],[2,6]]
};

/* Court figure, one half — mirrored to make the two-headed card.
   1 outline · 2 robe (suit colour) · 3 gold · 4 skin · 5 linen */
var KING = [
  '.......3..3..3..3..3.......',
  '.......3..3..3..3..3.......',
  '.......3333333333333.......',
  '.......3113113113113.......',
  '.......3333333333333.......',
  '........11111111111........',
  '.........444444444.........',
  '.........441444144.........',
  '.........444444444.........',
  '.........441111144.........',
  '..........5555555..........',
  '.........555555555.........',
  '.........555555555.........',
  '..........5555555..........',
  '.......2222222222222.......',
  '.....22222222222222222.....',
  '....2222222222222222222....',
  '....2222222222222222222....',
  '...222222222222222222222...',
  '...222222233333222222222...',
  '..22222222222222222222222..',
  '.2222222222222222222222222.',
  '222222222222222222222222222',
  '222222222222222222222222222'
];

var QUEEN = [
  '.........333333333.........',
  '.........331313133.........',
  '.........333333333.........',
  '........66666666666........',
  '.......6666666666666.......',
  '......666644444446666......',
  '......666644144146666......',
  '......666644444446666......',
  '......666644444446666......',
  '.......6666444446666.......',
  '.......6666644466666.......',
  '........66666666666........',
  '.........666666666.........',
  '..........5555555..........',
  '.......2222222222222.......',
  '.....22222222222222222.....',
  '....2222222555552222222....',
  '....2222222536352222222....',
  '....2222222555552222222....',
  '...222222222222222222222...',
  '..22222222222222222222222..',
  '.2222222222222222222222222.',
  '222222222222222222222222222',
  '222222222222222222222222222'
];

var JACK = [
  '..................555......',
  '.................555.......',
  '................555........',
  '........11111111155........',
  '.......13333333331.........',
  '.......13333333331.........',
  '........111111111..........',
  '.........444444444.........',
  '.........441444144.........',
  '.........444444444.........',
  '.........444444444.........',
  '..........4444444..........',
  '..........5555555..........',
  '.......2222222222222.......',
  '.....22222222222222222.....',
  '....2222222222222222222....',
  '....2222222222222222222....',
  '...222222222222222222222...',
  '...222221222222221222222...',
  '...222222222222222222222...',
  '..22222222222222222222222..',
  '.2222222222222222222222222.',
  '222222222222222222222222222',
  '222222222222222222222222222'
];

/* Rider-Back analog: a dense diagonal lattice inside a white margin, with a
   centre medallion. The lattice is what reads as "real deck" at this size —
   an even field of ornament rather than a flat colour. */
function cardBack(fb, x, y, w, h, P) {
  fb.rect(x, y, w, h, P.ink);
  fb.rect(x+1, y+1, w-2, h-2, P.linen);
  var ix = x+3, iy = y+3, iw = w-6, ih = h-6;
  fb.rect(ix, iy, iw, ih, P.backA);
  for (var j = 0; j < ih; j++) {
    for (var i = 0; i < iw; i++) {
      var u = i + j, v = i - j;
      if ((u % 4 === 0) || (v % 4 === 0)) fb.px(ix+i, iy+j, P.backB);
      if ((u % 8 === 0) && (v % 8 === 0)) fb.px(ix+i, iy+j, P.linen);
    }
  }
  fb.frame(ix, iy, iw, ih, P.backB);
  var cx = x + (w>>1), cy = y + (h>>1);
  for (var a = 0; a < 360; a += 12) {
    var r = a % 24 === 0 ? 6 : 4;
    fb.px(cx + Math.round(Math.cos(a*Math.PI/180)*r),
          cy + Math.round(Math.sin(a*Math.PI/180)*r), P.linen);
  }
  fb.rect(cx-2, cy-2, 4, 4, P.backB);
  fb.px(cx-1, cy-1, P.linen); fb.px(cx, cy, P.linen);
  // clipped corners
  [[x,y],[x+w-1,y],[x,y+h-1],[x+w-1,y+h-1]].forEach(function(c){ fb.px(c[0],c[1],null); });
}

/* A face card. Cream stock, a white margin, corner indices top-left and
   bottom-right (the second rotated, as printed), then pips or a court. */
function cardFace(fb, x, y, w, h, rank, suit, P) {
  var red = (suit === 'H' || suit === 'D');
  var ink = red ? P.red : P.black;
  var ten = (rank === 'T');

  fb.rect(x, y, w, h, P.ink);
  fb.rect(x+1, y+1, w-2, h-2, P.linen);
  [[x,y],[x+w-1,y],[x,y+h-1],[x+w-1,y+h-1]].forEach(function(c){ fb.px(c[0],c[1],null); });

  // corner indices — rank over a small suit, repeated rotated at bottom-right
  function index(ax, ay, flip) {
    if (ten) {
      fb.blit(GLYPH[flip?'o':'i'], ax, ay, ink, flip);
      fb.blit(GLYPH[flip?'i':'o'], ax + (flip?5:4), ay, ink, flip);
    } else {
      fb.blit(GLYPH[rank], ax, ay, ink, flip);
    }
    var iw = ten ? 8 : 5;
    fb.blit(SUIT[suit], ax + ((iw - SUIT[suit][0].length) >> 1), flip ? ay-7 : ay+8, ink, flip);
  }
  index(x+3, y+4, false);
  index(x+w-3-(ten?8:5), y+h-11, true);

  var cx = x + (w>>1);
  var gap = Math.round(w * 0.173);
  var cols = [cx-gap, cx, cx+gap];
  var top = y + 13, span = h - 32;

  if (rank === 'J' || rank === 'Q' || rank === 'K') {
    var COURT = rank === 'K' ? KING : rank === 'Q' ? QUEEN : JACK;
    var cw = COURT[0].length, chh = COURT.length;
    var ox = cx - (cw>>1);
    var map = {'1':P.ink,'2':red?P.red:P.courtBlue,'3':P.gold,'4':P.skin,'5':P.trim,'6':P.hair};
    var mid = y + (h>>1);
    for (var f = 0; f < 2; f++) {
      for (var j = 0; j < chh; j++) {
        var row = COURT[f ? chh-1-j : j];
        for (var i2 = 0; i2 < row.length; i2++) {
          var ch = row[f ? row.length-1-i2 : i2];
          if (ch !== '.') fb.px(ox+i2, f ? mid+j : mid-chh+j, map[ch]);
        }
      }
    }
  } else if (rank === 'A') {
    var big = BIG[suit], mid2 = y + (h>>1);
    var bw = big[0].length, bh = big.length;
    if (suit === 'S') {   // the ace of spades gets the maker's flourish
      fb.frame(cx-12, mid2-16, 25, 33, ink);
      fb.frame(cx-11, mid2-15, 23, 31, P.linen);
      for (var q = 0; q < 4; q++) {
        var qx = q & 1 ? cx+10 : cx-12, qy = q & 2 ? mid2+14 : mid2-16;
        fb.px(qx, qy, P.linen); fb.px(qx + (q&1?-1:1), qy, ink);
        fb.px(qx, qy + (q&2?-1:1), ink);
      }
    }
    fb.blit(big, cx - (bw>>1), mid2 - (bh>>1), ink);
  } else {
    var n = ten ? 10 : parseInt(rank, 10);
    PIPS[n].forEach(function (p) {
      fb.blit(SUIT[suit], cols[p[0]] - (SUIT[suit][0].length >> 1),
              top + Math.round(span*(p[1]/6)), ink, p[1] > 3);
    });
  }
}

/* ── extras the game needs beyond the mock ─────────────────────────────── */

/* The bitmap font at whole-number multiples, for titles and results. */
FB.prototype.textBig = function (s, x, y, c, k) {
  for (var i = 0; i < s.length; i++) {
    var g = GLYPH[s[i]];
    if (g) for (var j = 0; j < g.length; j++) {
      for (var m = 0; m < g[j].length; m++) {
        if (g[j][m] !== '.') this.rect(x + m*k, y + j*k, k, k, c);
      }
    }
    x += 6 * k;
  }
};
FB.prototype.textW = function (s, k) { return s.length * 6 * (k || 1) - (k || 1); };

/* Lift pixels toward a colour — used for the glow on a resurrectable pile,
   where darkening would read as "disabled" rather than "pick me". */
FB.prototype.tint = function (x, y, w, h, c, amt) {
  for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
    var px = x+i, py = y+j;
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) continue;
    var k = (py*this.w + px) * 4;
    this.d[k]   += (c[0] - this.d[k])   * amt;
    this.d[k+1] += (c[1] - this.d[k+1]) * amt;
    this.d[k+2] += (c[2] - this.d[k+2]) * amt;
  }
};

/* A card seen edge-on, for the flip when a pile dies or comes back. */
FB.prototype.cardEdge = function (cx, y, w, h, face, P) {
  if (w < 1) w = 1;
  var x = cx - (w >> 1);
  this.rect(x, y, w, h, P.ink);
  if (w > 2) this.rect(x+1, y+1, w-2, h-2, face);
};

/* ── the SPLIT STACK mark ──────────────────────────────────────────────── */

/* Two words, one over the other, with a white rule between them. SPLIT takes
   the hot ramp downward and STACK the cold one upward, so both run deepest
   where they meet the rule — the same crossing the one-word mark had, except it
   now happens between the lines instead of inside a letter. Nothing is cut, so
   no glyph has to be redrawn to survive the cut.

   Seven steps to a ramp, one per row of the font, so the heat belongs to the
   glyph rather than being a gradient laid over it. Both ramps stop short of
   their dark end on purpose: a red falling to near-black and a blue falling to
   navy each lose one of the four settings, so hue does the hot/cold work and
   brightness stays put.

   Lives here rather than in a caller because the menu, the corner of a live
   game and the front-page teaser all draw it, and a mark that drifts between
   them is worse than no mark at all. */
var SPLIT_HOT  = ['#fff3cc','#ffda78','#ffb443','#ff8a33','#f7632c','#e6462e','#d0342f'];
var SPLIT_COLD = ['#f4fcff','#d8f3ff','#aee3fb','#83cbf2','#5cafe6','#3f93da','#2d79cb'];
var SPLIT_WORDS = ['SPLIT', 'STACK'], SPLIT_ROWS = 7;
var SPLIT_PACKED = null;

/* Set on the font's own five-column cell rather than on each letter's real ink.
   Ink spacing reads better for one word — I is the only letter that does not
   fill its cell, and closing up around it evens the word out. But both words
   here are five letters, so the box puts every letter over its opposite: S over
   S, I over C, T over K. In that grid I's loose column stops reading as a
   spacing fault and starts reading as alignment, which is worth more than the
   evenness is. */
function splitRing(k) { return Math.max(1, Math.round(k * 0.5)); }
function splitAdvance(k) { return 6 * k + 2 * splitRing(k); }

/* The gap between the lines carries the rule with a ring's worth of dark either
   side, so it widens with the mark rather than closing up as the ring grows. */
function splitLineGap(k) { return k + 2 * splitRing(k); }

function splitMarkW(k) { return 4 * splitAdvance(k) + 5 * k; }
function splitMarkH(k) { return 2 * SPLIT_ROWS * k + splitLineGap(k); }

/* A word, a screen row at a time, so each row can take its own colour. `down`
   runs the ramp bright to deep; the second word runs it the other way. */
function splitWord(fb, word, x, y, k, ramp, down, flat) {
  var adv = splitAdvance(k), total = SPLIT_ROWS * k;
  for (var i = 0; i < word.length; i++) {
    var g = GLYPH[word[i]];
    if (!g) continue;
    for (var j = 0; j < SPLIT_ROWS; j++) {
      for (var sub = 0; sub < k; sub++) {
        var sy = j * k + sub, f = sy / (total - 1);
        var col = flat || ramp[Math.min(Math.round((down ? f : 1 - f) * (ramp.length - 1)),
                                        ramp.length - 1)];
        for (var m = 0; m < g[j].length; m++) {
          if (g[j][m] !== '.') fb.rect(x + i * adv + m * k, y + sy, k, 1, col);
        }
      }
    }
  }
}

var SPLIT_RING = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];

function splitMark(fb, x, y, k, shadow) {
  if (!SPLIT_PACKED) {
    SPLIT_PACKED = { hot: SPLIT_HOT.map(hex), cold: SPLIT_COLD.map(hex),
                     white: hex('#ffffff') };
  }
  var gap = splitLineGap(k), ring = splitRing(k);
  var y2 = y + SPLIT_ROWS * k + gap;
  var r, d;

  /* A ring rather than an offset drop shadow. The mark lands on cream card
     stock as often as on sky, and a shadow on one side only leaves the other
     three sitting on a tone as light as the letters are. Half an art pixel, not
     a whole one — at a whole pixel the rings of neighbouring letters meet in
     the gaps and the outline stops being an outline. */
  for (r = 0; r < SPLIT_RING.length; r++) {
    d = SPLIT_RING[r];
    splitWord(fb, SPLIT_WORDS[0], x + d[0]*ring, y  + d[1]*ring, k, null, true,  shadow);
    splitWord(fb, SPLIT_WORDS[1], x + d[0]*ring, y2 + d[1]*ring, k, null, false, shadow);
  }
  splitWord(fb, SPLIT_WORDS[0], x, y,  k, SPLIT_PACKED.hot,  true);
  splitWord(fb, SPLIT_WORDS[1], x, y2, k, SPLIT_PACKED.cold, false);

  /* The rule overshoots the block at both ends — the old vertical divider
     overshot the caps for the same reason — so it reads as a rule laid across
     the mark rather than a stroke belonging to a letter. */
  var over = 2 * k, w = splitMarkW(k);
  var ry = y + SPLIT_ROWS * k + ((gap - k) >> 1);
  fb.rect(x - over - ring, ry - ring, w + 2*over + 2*ring, k + 2*ring, shadow);
  fb.rect(x - over, ry, w + 2*over, k, SPLIT_PACKED.white);
}
/* Small text in the mark's two temperatures, for the call buttons. The font is
   seven rows and each ramp is seven steps, so at k=1 it is exactly one step per
   row — no interpolation, and the same colours the logo is built from.

   'hot' and 'cold' are the mark's own halves taken on their own: hot runs
   bright at the top and deepens downward, cold does the reverse, so HIGH and
   LOW read as the two ends of the same scale. 'cut' is the whole thing, hot
   over cold, which is what SPLIT wears. */
function callText(fb, s, x, y, k, mode) {
  if (!SPLIT_PACKED) {
    SPLIT_PACKED = { hot: SPLIT_HOT.map(hex), cold: SPLIT_COLD.map(hex),
                     white: hex('#ffffff') };
  }
  var total = SPLIT_ROWS * k, mid = total / 2;
  for (var i = 0; i < s.length; i++) {
    var g = GLYPH[s[i]];
    if (!g) continue;
    for (var j = 0; j < g.length; j++) {
      for (var sub = 0; sub < k; sub++) {
        var sy = j*k + sub, ramp, idx, f;
        if (mode === 'cut') {
          var warm = sy < mid;
          ramp = warm ? SPLIT_PACKED.hot : SPLIT_PACKED.cold;
          f = warm ? sy / mid : (sy - mid) / (total - mid);
          idx = warm ? Math.round(f * (ramp.length - 1))
                     : Math.round((1 - f) * (ramp.length - 1));
        } else {
          ramp = mode === 'cold' ? SPLIT_PACKED.cold : SPLIT_PACKED.hot;
          f = sy / (total - 1);
          idx = Math.round((mode === 'cold' ? 1 - f : f) * (ramp.length - 1));
        }
        for (var m = 0; m < g[j].length; m++) {
          if (g[j][m] !== '.') {
            fb.rect(x + i*6*k + m*k, y + sy, k, 1,
                    ramp[Math.min(idx, ramp.length - 1)]);
          }
        }
      }
    }
  }
}
