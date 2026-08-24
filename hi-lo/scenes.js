/* Three settings the player picks between. Same deck, same rules, different
   hour and latitude. Every backdrop is width-parametric so it can fill whatever
   viewport it is handed. */

function rng(seed){ return function(){ seed=(seed*1664525+1013904223)&0x7fffffff; return seed/0x7fffffff; }; }

var CARD_W = 54, CARD_H = 74, GAP = 5;

function P(o){
  var r={};
  for (var k in o) {
    var v=o[k];
    r[k]= Array.isArray(v) ? v.map(hex) : (typeof v==='string' ? hex(v) : v);
  }
  return r;
}

/* The deck itself never changes with the light — a pack of cards is a pack of
   cards. Only the room around it moves. */
var DECK = {
  ink:'#241c22', linen:'#f2ead6', red:'#c0303c', black:'#2a2430',
  gold:'#d8a13c', skin:'#e8b48c', courtBlue:'#2f4a86', hair:'#8a5a3c', trim:'#bfb094',
  hudInk:'#f4edda', hudDim:'#b9ae94', hudShadow:'#141019',
  backA:'#8e2230', backB:'#d0455a'
};

var SCENES = [
  { key:'dusk', jp:'黄昏', name:'Dusk Terrace',
    blurb:'Exterior, the last twenty minutes of light. Dithered sky over a flat skyline.',
    pal: P(Object.assign({}, DECK, {
      sky:['#2b1a4e','#4a2263','#77296a','#a83a63','#d25a51','#ef8248','#ffb267'],
      tower:'#1a1030', towerFar:'#2e1a48', lit:'#ffe3a0', litDim:'#d8a05e',
      wall:'#1d1230', floor:'#241736', floorLit:'#43284a',
      ui:'#ffe0b0', uiDim:'#b08a72', uiShadow:'#170b26', btnBg:'#33204a', btnInk:'#ffe0b0',
      pick:'#ff7a5c'
    })) },
  { key:'palms', jp:'常夏', name:'Palm Court',
    blurb:'Daylight, somewhere warm. Turquoise water, palms, and a sun that never quite sets.',
    pal: P(Object.assign({}, DECK, {
      sky:['#1f8fc0','#3fb0d8','#6fcde6','#a8e4f0','#d8f4f4','#ffd9cf'],
      water:['#12889c','#1ea3b2','#35c0c6','#5fd6d2'],
      trunk:'#4a3330', trunkLit:'#6b4a42', frond:'#1d6b52', frondLit:'#2e9a66',
      lit:'#fff2c0', litDim:'#ffd98a',
      wall:'#2a5f66', floor:'#255760', floorLit:'#3d7a80',
      ui:'#04222b', uiDim:'#0d3f4a', uiShadow:'#cfeef2', btnBg:'#f2ead6', btnInk:'#0b3540',
      pick:'#5fe0c8'
    })) },
  { key:'space', jp:'宇宙遊泳', name:'Space Walk',
    blurb:'Outside the station, tethered. Gas and starlight overhead, deck plate underfoot.',
    pal: P(Object.assign({}, DECK, {
      sky:['#0a0e28','#0b1030','#0d1338','#0f1740','#111a48','#131e50'],
      band:'#241f4a', bandMid:'#3f3474', bandLit:'#8779c4',
      teal:'#0d3a46', tealMid:'#186a76', tealLit:'#43b3ae',
      rose:'#3d1c3c', roseMid:'#77315c', roseLit:'#c9628f',
      gold:'#241f42', goldMid:'#7a5a2c', goldLit:'#d9a75a',
      coral:'#43203a', coralMid:'#95452f', coralLit:'#f0a05c',
      lit:'#fff6e2', litDim:'#93a0c6', litWarm:'#ffd2a0', litCool:'#a8dcff',
      wall:'#04050d', floor:'#2b2f38', floorLit:'#474e5c',
      ui:'#e2e8f4', uiDim:'#8d95ab', uiShadow:'#04050d', btnBg:'#232936', btnInk:'#e2e8f4',
      pick:'#7fd4ff'
    })) }
];

/* Towers with lit windows — the late-night lighting. Windows sit on a grid and
   are thinned out, so a tower reads as occupied rather than as a texture. */
function skyline(fb, x0, y0, w, baseY, col, litCol, litDimCol, seed, density) {
  var r = rng(seed), x = x0;
  while (x < x0 + w) {
    var bw = 8 + Math.floor(r()*16), bh = 14 + Math.floor(r()*46);
    var by = baseY - bh;
    if (by < y0) by = y0;
    fb.rect(x, by, Math.min(bw, x0+w-x), baseY-by, col);
    for (var wy = by+3; wy < baseY-3; wy += 4) {
      for (var wx = x+2; wx < x+bw-3 && wx < x0+w-2; wx += 4) {
        if (r() < density) fb.rect(wx, wy, 2, 2, r() < 0.45 ? litDimCol : litCol);
      }
    }
    x += bw + 1 + Math.floor(r()*3);
  }
}

/* A palm: a trunk that leans, then fronds that arc out and droop under their
   own weight. Drawn rather than tiled so no two are quite alike. */
function palm(fb, x, baseY, h, lean, P2, seed) {
  var r = rng(seed);
  for (var i = 0; i < h; i++) {
    var t = i / h;
    var tx = x + Math.round(Math.sin(t * 1.25) * lean);
    fb.px(tx, baseY - i, P2.trunk);
    fb.px(tx + 1, baseY - i, i % 5 === 0 ? P2.trunkLit : P2.trunk);
  }
  var cx = x + Math.round(Math.sin(1.25) * lean), cy = baseY - h;
  var n = 6 + Math.floor(r() * 2);
  for (var f = 0; f < n; f++) {
    var a = Math.PI + (f / (n - 1)) * Math.PI;      // sweep the upper half
    var len = h * (0.42 + r() * 0.20);
    var col = (f % 2) ? P2.frondLit : P2.frond;
    for (var s = 0; s < len; s++) {
      var u = s / len;
      var fx = cx + Math.cos(a) * s;
      var fy = cy + Math.sin(a) * s * 0.5 + u * u * len * 0.55;   // droop
      fb.px(Math.round(fx), Math.round(fy), col);
      if (u < 0.55) fb.px(Math.round(fx), Math.round(fy) + 1, col);
    }
  }
  fb.rect(cx - 1, cy - 1, 3, 3, P2.trunkLit);      // coconuts at the crown
}

/* Where every setting stops being sky and starts being ground. One number,
   shared, because the board is laid out against it: the deck-count and the
   PICK A PILE of a two-row board fall near this line, and while the settings
   each had their own the text had to clear all of them at once. A new setting
   inherits the whole of that work by calling these two. */
var GROUND = 0.42;
function groundY(H)    { return Math.round(H * GROUND); }
function groundBand(H) { return Math.min(22, Math.round(H * 0.05)); }

/* A galactic band. skyBand only ramps vertically, so this is the one genuinely
   new primitive the setting needs: distance from a tilted line, dithered so the
   dust breaks up rather than banding. Three steps of brightness, not a
   gradient — the spine reads as a spine that way. */
/* Smooth value noise. Gas has no straight edges, and a clean falloff drawn
   straight gives ribbons — this is what turns the ribbon into billows. */
function vnoise(seed) {
  function h(ix, iy) {
    var n = (ix * 374761393 + iy * 668265263 + seed * 1274126177) | 0;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) & 0x7fffffff) / 0x7fffffff;
  }
  return function (x, y) {
    var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    var a0 = h(x0, y0), b0 = h(x0 + 1, y0), c0 = h(x0, y0 + 1), d0 = h(x0 + 1, y0 + 1);
    var top = a0 + (b0 - a0) * sx, bot = c0 + (d0 - c0) * sx;
    return top + (bot - top) * sy;
  };
}

/* A cloud of gas: a tilted lens for the overall shape, broken up by two
   octaves of noise, then quantised to three steps of one hue. Several can
   overlap without turning to mud because each only ever writes its own three. */
function cloud(fb, W, hz, tilt, cxf, cyf, across, along, gain, dim, mid, bright, seed) {
  var ca = Math.cos(tilt), sa = Math.sin(tilt);
  var cx = W * cxf, cy = hz * cyf;
  var n1 = vnoise(seed), n2 = vnoise(seed + 37);
  var s1 = Math.max(5, across * 0.30), s2 = Math.max(3, across * 0.11);
  for (var y = 0; y < hz; y++) {
    for (var x = 0; x < W; x++) {
      var dx = x - cx, dy = y - cy;
      var u =  ca * dx + sa * dy;
      var v = -sa * dx + ca * dy;
      var fu = 1 - Math.min(1, Math.abs(u) / along);
      var fv = 1 - Math.min(1, Math.abs(v) / across);
      if (fu <= 0 || fv <= 0) continue;
      var shape = fv * (0.40 + 0.60 * fu);
      var billow = 0.22 + 0.90 * n1(x / s1, y / s1) + 0.40 * n2(x / s2, y / s2);
      var t = shape * billow * gain;
      var thr = BAYER[y & 7][x & 7] / 64;
      if (t <= thr) continue;                        // full dither: gas thins out
      var col = t > 0.88 ? bright : (t > 0.62 ? mid : dim);
      if (col == null) continue;                     // a cloud may skip its
      fb.px(x, y, col);                              // faintest step entirely
    }
  }
}

/* Stars in a few temperatures, so the field is not one grey. The near ones
   get rays; the rest are single pixels, which is all a star is at this size. */
function stars(fb, W, hz, p, n, seed) {
  var q = rng(seed);
  for (var i = 0; i < n; i++) {
    var x = Math.round(q() * (W - 1)), y = Math.round(q() * (hz - 1)), b = q(), h = q();
    var col = h > 0.82 ? p.litWarm : (h > 0.62 ? p.litCool : p.lit);
    if (b > 0.972) {
      fb.px(x, y, col);
      fb.px(x - 1, y, p.litDim); fb.px(x + 1, y, p.litDim);
      fb.px(x, y - 1, p.litDim); fb.px(x, y + 1, p.litDim);
    } else if (b > 0.58) fb.px(x, y, col);
    else fb.px(x, y, p.litDim);
  }
}

function drawScene(fb, S, W, H) {
  var p = S.pal;
  var r = function (f) { return Math.round(H * f); };
  var gy = groundY(H);

  if (S.key === 'dusk') {
    var hz = gy - r(0.02);                 // the skyline meets the ground plane
    fb.skyBand(0, 0, W, hz, p.sky);
    var sr = Math.max(16, Math.round(H * 0.085)), sx = (W>>1), sy = r(0.30);
    for (var y=-sr;y<=sr;y++) for (var x=-sr;x<=sr;x++) {
      if (x*x+y*y<=sr*sr) {
        var t=(y+sr)/(2*sr), thr=BAYER[(y+sr)&7][(x+sr)&7]/64;
        fb.px(sx+x, sy+y, t>thr ? p.lit : p.litDim);
      }
    }
    skyline(fb, 0, r(0.10), W, hz - r(0.03), p.towerFar, p.lit, p.litDim, 3, 0.16);
    skyline(fb, 0, r(0.16), W, gy, p.tower, p.lit, p.litDim, 23, 0.26);
    fb.rect(0, gy, W, H, p.floor);
    fb.skyBand(0, gy, W, groundBand(H), [p.floorLit, p.floor]);

  } else if (S.key === 'space') {
    fb.skyBand(0, 0, W, gy, p.sky);
    /* One galactic band across the whole sky, then gas at three temperatures
       laid over it at different angles. They overlap rather than tile, which
       is what keeps it from reading as one flat colour. */
    cloud(fb, W, gy, -0.22, 0.50, 0.44, Math.max(18, gy*0.40), W*0.58, 0.92, p.band, p.bandMid, p.bandLit, 91);
    cloud(fb, W, gy,  0.34, 0.17, 0.40, Math.max(13, gy*0.27), W*0.17, 0.80, p.teal, p.tealMid, p.tealLit, 214);
    cloud(fb, W, gy, -0.44, 0.79, 0.39, Math.max(12, gy*0.25), W*0.22, 0.76, p.rose, p.roseMid, p.roseLit, 377);
    // the gold runs up into the top left, and fades as it goes
    /* Its faintest step is a dark violet, not a dark olive — where the gold
       thins out over the band it now settles into the sky instead of browning
       it, and only shows its own colour where it is actually dense. */
    cloud(fb, W, gy,  0.46, 0.40, 0.30, Math.max(9,  gy*0.17), W*0.20, 0.84, p.gold, p.goldMid, p.goldLit, 508);
    // and a warm bank low on the right, under the rose
    cloud(fb, W, gy, -0.18, 0.82, 0.84, Math.max(11, gy*0.23), W*0.15, 0.90, p.coral, p.coralMid, p.coralLit, 733);
    stars(fb, W, gy, p, Math.max(90, Math.round(W * gy / 560)), 1301);
    // the deck: flat, and a lit lip where it meets the dark, like the others
    fb.rect(0, gy, W, H - gy, p.floor);
    fb.skyBand(0, gy, W, groundBand(H), [p.floorLit, p.floor]);

  } else {
    var wtop = r(0.30), wbot = gy;         // the waterline is the ground plane
    fb.skyBand(0, 0, W, wtop, p.sky);
    var pr = Math.max(12, Math.round(H*0.05)), px2 = Math.round(W*0.72), py2 = r(0.09);
    for (var yy=-pr;yy<=pr;yy++) for (var xx=-pr;xx<=pr;xx++) {
      if (xx*xx+yy*yy<=pr*pr) {
        var t2=1-(yy+pr)/(2*pr), th2=BAYER[(yy+pr)&7][(xx+pr)&7]/64;
        fb.px(px2+xx, py2+yy, t2>th2 ? p.lit : p.litDim);
      }
    }
    fb.skyBand(0, wtop, W, wbot-wtop, p.water);
    for (var wy3=wtop+2; wy3<wbot; wy3++) {
      for (var wx3=0; wx3<W; wx3++) {
        var wob = Math.sin(wx3*0.14)*1.7 + Math.sin(wx3*0.052)*2.3;
        var band = (wy3 + Math.round(wob)) % 6;
        if (band === 0 && ((wx3 + wy3) & 1) === 0) fb.px(wx3, wy3, p.litDim);
        else if (band === 3 && (wx3 & 3) === 0) fb.px(wx3, wy3, p.lit);
      }
    }
    fb.rect(0, wbot, W, H-wbot, p.floor);
    fb.skyBand(0, wbot, W, groundBand(H), [p.floorLit, p.floor]);
    // palms spread across whatever width we were given, rather than the four
    // hand-placed ones the mock could get away with
    var n = Math.max(3, Math.round(W / 110));
    for (var i = 0; i < n; i++) {
      var q = rng(41 + i*17);
      var pxp = Math.round((i + 0.18 + q()*0.64) * (W / n));
      var ph  = Math.round(H * (0.13 + q()*0.10));
      palm(fb, pxp, wtop + Math.round(H*0.012) + Math.round(q()*H*0.03), ph,
           (i % 2 ? 1 : -1) * (4 + Math.round(q()*7)), p, 41 + i*17);
    }
  }
}
