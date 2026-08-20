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
  C:['.....###.....','....#####....','....#####....','..#########..','.###########.',
     '###.#####.###','###.#####.###','###.#####.###','.###########.','..####.####..',
     '......#......','.....###.....','....#####....','...#######...','.............']
};

var SUIT = {
  S:['..#..','.###.','#####','#####','..#..','.###.'],
  H:['.#.#.','#####','#####','#####','.###.','..#..'],
  D:['..#..','.###.','#####','#####','.###.','..#..'],
  C:['..#..','.###.','##.##','#####','..#..','.###.']
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
    fb.blit(SUIT[suit], ax + ((iw-5)>>1), flip ? ay-7 : ay+8, ink, flip);
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
      fb.blit(SUIT[suit], cols[p[0]]-2, top + Math.round(span*(p[1]/6)), ink, p[1] > 3);
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
