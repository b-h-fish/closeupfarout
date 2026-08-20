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
  { key:'window', jp:'深夜の窓', name:'Late Window',
    blurb:'Interior, high floor. A city held behind glass, a lamp just off the table.',
    pal: P(Object.assign({}, DECK, {
      sky:['#0a1030','#101a44','#17244f','#1d2c5c','#243668'],
      tower:'#151d40', towerFar:'#1b2450', lit:'#ffd489', litDim:'#c99a55',
      wall:'#191324', floor:'#221828', floorLit:'#3a2a34',
      ui:'#e8dcc0', uiDim:'#9b8a76', uiShadow:'#0b0812', btnBg:'#2e2438', btnInk:'#e8dcc0'
    })) },
  { key:'dusk', jp:'黄昏', name:'Dusk Terrace',
    blurb:'Exterior, the last twenty minutes of light. Dithered sky over a flat skyline.',
    pal: P(Object.assign({}, DECK, {
      sky:['#2b1a4e','#4a2263','#77296a','#a83a63','#d25a51','#ef8248','#ffb267'],
      tower:'#1a1030', towerFar:'#2e1a48', lit:'#ffe3a0', litDim:'#d8a05e',
      wall:'#1d1230', floor:'#241736', floorLit:'#43284a',
      ui:'#ffe0b0', uiDim:'#b08a72', uiShadow:'#170b26', btnBg:'#33204a', btnInk:'#ffe0b0'
    })) },
  { key:'palms', jp:'常夏', name:'Palm Court',
    blurb:'Daylight, somewhere warm. Turquoise water, palms, and a sun that never quite sets.',
    pal: P(Object.assign({}, DECK, {
      sky:['#1f8fc0','#3fb0d8','#6fcde6','#a8e4f0','#d8f4f4','#ffd9cf'],
      water:['#12889c','#1ea3b2','#35c0c6','#5fd6d2'],
      trunk:'#4a3330', trunkLit:'#6b4a42', frond:'#1d6b52', frondLit:'#2e9a66',
      lit:'#fff2c0', litDim:'#ffd98a',
      wall:'#2a5f66', floor:'#255760', floorLit:'#3d7a80',
      ui:'#04222b', uiDim:'#0d3f4a', uiShadow:'#cfeef2', btnBg:'#f2ead6', btnInk:'#0b3540'
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

function drawScene(fb, S, W, H) {
  var p = S.pal;
  var r = function (f) { return Math.round(H * f); };

  if (S.key === 'window') {
    fb.rect(0, 0, W, H, p.wall);
    var ww = Math.min(W - 44, Math.round(W * 0.74));
    var wh = r(0.40), wx = Math.round((W - ww) / 2), wy = r(0.07);
    fb.skyBand(wx, wy, ww, wh, p.sky);
    skyline(fb, wx, wy, ww, wy + wh - Math.round(wh*0.12), p.towerFar, p.lit, p.litDim, 7, 0.30);
    skyline(fb, wx, wy, ww, wy + wh, p.tower, p.lit, p.litDim, 19, 0.38);
    fb.frame(wx-1, wy-1, ww+2, wh+2, p.floorLit);
    // mullions, spaced so the panes stay squarish whatever the window's width
    var panes = Math.max(2, Math.round(ww / 130));
    for (var m = 1; m < panes; m++) fb.vline(wx + Math.round(ww*m/panes), wy, wh, p.floorLit);
    fb.hline(wx, wy + (wh >> 1), ww, p.floorLit);
    fb.rect(0, wy+wh+2, W, H-(wy+wh+2), p.floor);
    fb.skyBand(0, wy+wh+2, W, Math.min(30, r(0.07)), [p.floorLit, p.floor]);

  } else if (S.key === 'dusk') {
    var hz = r(0.44);
    fb.skyBand(0, 0, W, hz, p.sky);
    var sr = Math.max(16, Math.round(H * 0.085)), sx = (W>>1), sy = r(0.30);
    for (var y=-sr;y<=sr;y++) for (var x=-sr;x<=sr;x++) {
      if (x*x+y*y<=sr*sr) {
        var t=(y+sr)/(2*sr), thr=BAYER[(y+sr)&7][(x+sr)&7]/64;
        fb.px(sx+x, sy+y, t>thr ? p.lit : p.litDim);
      }
    }
    skyline(fb, 0, r(0.10), W, hz - r(0.03), p.towerFar, p.lit, p.litDim, 3, 0.16);
    skyline(fb, 0, r(0.16), W, hz + r(0.02), p.tower, p.lit, p.litDim, 23, 0.26);
    fb.rect(0, hz + r(0.02), W, H, p.floor);
    fb.skyBand(0, hz + r(0.02), W, Math.min(28, r(0.06)), [p.floorLit, p.floor]);

  } else {
    var wtop = r(0.30), wbot = r(0.42);
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
    fb.skyBand(0, wbot, W, Math.min(22, r(0.05)), [p.floorLit, p.floor]);
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
