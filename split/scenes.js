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
  { key:'dusk', name:'Dusk Terrace',
    blurb:'Exterior, the last twenty minutes of light. Dithered sky over a flat skyline.',
    pal: P(Object.assign({}, DECK, {
      sky:['#2b1a4e','#4a2263','#77296a','#a83a63','#d25a51','#ef8248','#ffb267'],
      tower:'#1a1030', towerFar:'#2e1a48', lit:'#ffe3a0', litDim:'#d8a05e',
      cloudDim:'#40265c', cloudMid:'#6d3663', cloudLit:'#a85463',
      wall:'#1d1230', floor:'#241736', floorLit:'#43284a',
      ui:'#ffe0b0', uiDim:'#b08a72', uiShadow:'#170b26', btnBg:'#33204a', btnInk:'#ffe0b0',
      pick:'#ff7a5c'
    })) },
  { key:'palms', name:'Palm Court',
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
  { key:'space', name:'Space Port',
    blurb:'Docked, waiting on a berth. Gas and starlight overhead, deck plate underfoot.',
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
    })) },
  { key:'jungle', name:'Jungle Hike',
    blurb:'Mid-morning deep in it. Light comes down in columns and the trail goes on.',
    pal: P(Object.assign({}, DECK, {
      sky:['#16302a','#173424','#1a3a1e','#204718','#2e5c1c','#457c26','#68a634','#9ac95a'],
      mistFar:'#2a4a3c', mistNear:'#376248',
      leafFar:'#27473a', leafMid:'#16300f', leafNear:'#0b1808',
      trunkFar:'#2c4a2e', trunk:'#1d1610', trunkLit:'#3a2a1a',
      shaftDim:'#4a6b22', shaftMid:'#8aa63e', shaftLit:'#f2e9a2',
      pool:'#b9cf6a',
      hazeMid:'#6f9a45', hazeLit:'#cfdc8a',
      lit:'#eef6c0', litDim:'#84a05c',
      wall:'#16302a', floor:'#2e2718', floorLit:'#54462a',
      ui:'#eef5d8', uiDim:'#9aab84', uiShadow:'#0d1509', btnBg:'#26301c', btnInk:'#eef5d8',
      pick:'#f5c460'
    })) }
];

/* Towers with lit windows — the late-night lighting. Windows sit on a grid and
   are thinned out, so a tower reads as occupied rather than as a texture. */
/* Heights are a share of the band between y0 and baseY rather than a fixed
   count of pixels. They were 14 to 60 whatever the canvas, which was right when
   the ground plane sat at 0.42 and looked like a low wall once it dropped to
   0.58 and gave the sky half again as much room. The cap is deliberate: at
   0.63 of the band the tallest tower still stops short of the strip the clouds
   drift through, so that strip can be repainted without redrawing a skyline. */
function skyline(fb, x0, y0, w, baseY, col, litCol, litDimCol, seed, density, collect) {
  var r = rng(seed), x = x0, band = Math.max(8, baseY - y0);
  while (x < x0 + w) {
    var bw = 10 + Math.floor(r()*20);
    var bh = Math.round(band * (0.20 + r() * 0.43));
    var by = baseY - bh;
    if (by < y0) by = y0;
    fb.rect(x, by, Math.min(bw, x0+w-x), baseY-by, col);
    for (var wy = by+3; wy < baseY-3; wy += 4) {
      for (var wx = x+2; wx < x+bw-3 && wx < x0+w-2; wx += 4) {
        if (r() < density) {
          fb.rect(wx, wy, 2, 2, r() < 0.45 ? litDimCol : litCol);
          /* Where the lit windows are, for whoever wants to turn one off later.
             Collected as they are drawn rather than recomputed, so the two can
             never disagree about which pixels are a window. */
          if (collect) collect.push({ x: wx, y: wy, off: col });
        }
      }
    }
    x += bw + 1 + Math.floor(r()*3);
  }
}

/* A palm: a trunk that leans, then fronds that arc out and droop under their
   own weight. Drawn rather than tiled so no two are quite alike. */
/* `sway` is one sine wave's worth of lean, -1 to 1, applied to the fronds
   only — the trunk of a palm this size does not visibly move. It scales with
   u*u so the tip travels and the base stays put, which is how a frond bends. */
function palm(fb, x, baseY, h, lean, P2, seed, sway) {
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
      var fx = cx + Math.cos(a) * s + u * u * len * (sway || 0) * 0.16;
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
var GROUND = 0.58;
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
function cloud(fb, W, hz, tilt, cxf, cyf, across, along, gain, dim, mid, bright, seed, tail, gas) {
  var ca = Math.cos(tilt), sa = Math.sin(tilt);
  var cx = W * cxf, cy = hz * cyf;
  var n1 = vnoise(seed), n2 = vnoise(seed + 37);
  var s1 = Math.max(5, across * 0.30), s2 = Math.max(3, across * 0.11);
  for (var y = 0; y < hz; y++) {
    for (var x = 0; x < W; x++) {
      var dx = x - cx, dy = y - cy;
      var u =  ca * dx + sa * dy;
      var v = -sa * dx + ca * dy;
      // `tail` shortens the far end only, so a cloud can taper unevenly
      var reach = u > 0 ? along * (tail || 1) : along;
      var fu = 1 - Math.min(1, Math.abs(u) / reach);
      var fv = 1 - Math.min(1, Math.abs(v) / across);
      if (fu <= 0 || fv <= 0) continue;
      var shape = fv * (0.40 + 0.60 * fu);
      var billow = 0.22 + 0.90 * n1(x / s1, y / s1) + 0.40 * n2(x / s2, y / s2);
      var t = shape * billow * gain;
      var thr = BAYER[y & 7][x & 7] / 64;
      /* Handed a bag, the cloud is recorded rather than drawn. Every pixel the
         swell could ever reach is kept, not just the ones lit at rest, so the
         gas has somewhere to grow into; and none are drawn, because the still
         underneath has to be bare sky. Draw them here and the repaint would
         bury the stars, which go down last. */
      if (gas) {
        if (t > thr * GAS_KEEP) {
          gas.idx.push(y * W + x); gas.t.push(t); gas.thr.push(thr); gas.ci.push(gas.n);
        }
        continue;
      }
      if (t <= thr) continue;                        // full dither: gas thins out
      var col = t > 0.88 ? bright : (t > 0.62 ? mid : dim);
      if (col == null) continue;                     // a cloud may skip its
      fb.px(x, y, col);                              // faintest step entirely
    }
  }
  /* One bag holds all five clouds, so each closes its own slot on the way out
     and the next one lands in the next. */
  if (gas) { gas.cols.push(dim, mid, bright); gas.n++; }
}

/* Stars in a few temperatures, so the field is not one grey. The near ones
   get rays; the rest are single pixels, which is all a star is at this size. */
function stars(fb, W, hz, p, n, seed, collect, defer) {
  var q = rng(seed);
  for (var i = 0; i < n; i++) {
    var x = Math.round(q() * (W - 1)), y = Math.round(q() * (hz - 1)), b = q(), h = q();
    var col = h > 0.82 ? p.litWarm : (h > 0.62 ? p.litCool : p.lit);
    /* Collected with the colour and the shape each one got, so whatever
       repaints them later works from the same list the sky was made from.
       All of them now, not just the bright ones: the gas is repainted every
       frame and the whole field has to go back down on top of it. */
    if (collect) collect.push({ x: x, y: y, col: col, ray: b > 0.972, lit: b > 0.58 });
    if (defer) continue;
    if (b > 0.972) {
      fb.px(x, y, col);
      fb.px(x - 1, y, p.litDim); fb.px(x + 1, y, p.litDim);
      fb.px(x, y - 1, p.litDim); fb.px(x, y + 1, p.litDim);
    } else if (b > 0.58) fb.px(x, y, col);
    else fb.px(x, y, p.litDim);
  }
}

/* A column of light through a gap in the canopy. Unlike gas this wants clean
   edges — a beam that billows is smoke — so it is a plain distance falloff
   with no noise in it, fading as it falls away from the gap. */
function shaft(fb, W, hz, lean, cxf, wide, gain, dim, mid, lit, bag) {
  var c = Math.cos(lean), sn = Math.sin(lean), cx = W * cxf;
  for (var y = 0; y < hz; y++) {
    var fall = 1 - y / hz;
    for (var x = 0; x < W; x++) {
      var d = Math.abs((x - cx) * c - y * sn);
      if (d >= wide) continue;
      /* Linear across the beam, not squared — squared pulls it into a spine
         and a beam of light has body. Three tones: glow, beam, core. */
      var t = (1 - d / wide) * (0.66 + 0.34 * fall) * gain;
      var thr = BAYER[y & 7][x & 7] / 64;
      if (bag) {
        if (t > thr * BEAM_KEEP) {
          bag.idx.push(y * W + x); bag.t.push(t); bag.thr.push(thr); bag.ci.push(bag.n);
        }
        continue;
      }
      if (t <= thr) continue;
      fb.px(x, y, t > 0.82 ? lit : (t > 0.46 ? mid : dim));
    }
  }
  if (bag) { bag.cols.push(dim, mid, lit); bag.n++; }
}

/* Something moving through the undergrowth.

   Not wind. Wind would shiver the whole hedge at once, and what this wants is
   the other thing — a small animal crossing behind the leaves every twenty
   seconds or so, which is Dusk Terrace's lit windows rather than Space Port's
   gas: an event with a beginning and an end, not a cycle. Same sawtooth Dusk
   uses, with a short duty at the front of it.

   During a crossing the disturbance travels: a narrow bulge in the silhouette
   that slides along the bush, rises as the animal enters cover and falls as it
   leaves, with a fast tremble on top so it shakes rather than glides. Only the
   leaf edge is touched.

   It only ever adds leaves, never removes them. That is what keeps this cheap
   and exact: the still already holds the bush at rest, so a frame draws the
   few pixels standing proud of it and nothing has to be erased or restored. At
   rest it draws nothing at all. */
var JBRUSH = null;

function jungleBrush(h1, h2, W, gy, p) {
  /* The visible top edge at each column, and which layer owns it. */
  var top = new Int16Array(W), near = new Uint8Array(W), hi = 0, x;
  for (x = 0; x < W; x++) {
    var a = h1 ? h1[x] : 0, b = h2 ? h2[x] : 0;
    top[x] = a > b ? a : b;
    near[x] = b >= a ? 1 : 0;
    if (top[x] > hi) hi = top[x];
  }
  var q = rng(2207), n = Math.max(3, Math.round(W / 260)), list = [];
  /* Small animals: the bulge is a fraction of the bush, not a shove. At 0.030
     it lifted a sixth of the hedge and read as something large. */
  var amp = Math.max(2, Math.round(gy * 0.017));
  for (var i = 0; i < n; i++) {
    var reach = Math.round(W * (0.05 + q() * 0.07));       // how far it travels
    list.push({
      x0: Math.round(q() * (W - 1)),
      dir: q() < 0.5 ? -1 : 1,
      reach: reach,
      wide: Math.max(5, Math.round(W * (0.012 + q() * 0.014))),
      amp: amp * (0.7 + q() * 0.6),
      rate: 1 / (14000 + q() * 16000),   // a crossing every fourteen to thirty seconds
      phase: q(),
      win: 0.06 + q() * 0.05,            // and it takes a second or two
      jit: q() * 6.283
    });
  }
  JBRUSH = { top: top, near: near, gy: gy, list: list,
             mid: p.leafMid, nearCol: p.leafNear,
             y0: Math.max(0, gy - hi - Math.ceil(amp * 1.3) - 2) };
}

function jungleBush(fb, t) {
  var B = JBRUSH;
  if (!B) return;
  for (var i = 0; i < B.list.length; i++) {
    var c = B.list[i], f = ((t * c.rate) + c.phase) % 1;
    if (f >= c.win) continue;                       // nothing in the bush
    var u = f / c.win;
    var env = Math.sin(Math.PI * u);                // in and out of cover
    var cx = c.x0 + c.dir * c.reach * u;
    var lo = Math.round(cx - c.wide), hi2 = Math.round(cx + c.wide);
    for (var x = lo; x <= hi2; x++) {
      if (x < 0 || x >= B.top.length) continue;
      var d = Math.abs(x - cx) / c.wide;
      if (d > 1) continue;
      /* Cosine bump for the body of it, and a quick tremble so the leaves
         shake instead of the whole bulge sliding along smoothly. */
      var shake = 0.62 + 0.38 * Math.sin(t * 0.021 + x * 1.6 + c.jit);
      var add = Math.round(c.amp * env * Math.cos(d * 1.5708) * shake);
      if (add <= 0) continue;
      var base = B.gy - B.top[x];
      fb.rect(x, base - add, 1, add, B.near[x] ? B.nearCol : B.mid);
    }
  }
}

/* Jungle Hike's light, which strengthens and fades.

   Same trick as Space Port's gas: a beam is a distance falloff dithered
   against Bayer, so holding the falloff still and putting a slow gain on it
   walks the cut, and the column brightens and thins without being redrawn.

   One thing here that the gas did not have to deal with. The beams are drawn
   early, under three layers of canopy and a stand of near trunks, so most of
   what a beam lights is covered by leaves before the frame is finished.
   Repainting all of it would put light in front of the foliage. So the still
   is snapshotted at the moment the beams would go down, the rest of the scene
   is drawn on top as usual, and any candidate pixel the later layers wrote
   over is dropped: what survives is exactly the light that shows through the
   gaps, which is the only light there is anything to animate.

   Each beam and the pool it lays on the trail share a phase, so the column
   and the patch at its foot brighten together. */
var BEAM_SWING = 0.14, BEAM_KEEP = 1 / (1 + BEAM_SWING);
var JUNGLE = null;

function jungleBag() { return { idx: [], t: [], thr: [], ci: [], cols: [], n: 0 }; }

function jungleDone(bag, pre, fb, W) {
  var d = fb.d, keep = [], kt = [], kh = [], kc = [], y0 = 1e9, y1 = 0;
  for (var i = 0; i < bag.idx.length; i++) {
    var o = bag.idx[i] * 4;
    /* Untouched since the snapshot means nothing was drawn in front of it. */
    if (d[o] !== pre[o] || d[o+1] !== pre[o+1] || d[o+2] !== pre[o+2]) continue;
    keep.push(bag.idx[i]); kt.push(bag.t[i]); kh.push(bag.thr[i]); kc.push(bag.ci[i]);
    var y = (bag.idx[i] / W) | 0;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  var pk = new Uint32Array(bag.cols.length);
  for (var j = 0; j < bag.cols.length; j++) {
    var c = bag.cols[j];
    pk[j] = c ? (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0] : 0;
  }
  JUNGLE = {
    n: keep.length, idx: new Int32Array(keep), t: new Float32Array(kt),
    thr: new Float32Array(kh), ci: new Uint8Array(kc), pk: pk,
    g: new Float32Array(bag.n),
    y0: keep.length ? y0 : 0, y1: keep.length ? y1 : 0
  };
}

/* One frame of light. Beam i and pool i are slots 2i and 2i+1 and take the
   same phase, which is why the gain is indexed by the pair and not the slot. */
function jungleBeams(fb, t) {
  var J = JUNGLE;
  if (!J || !J.n) return;
  var g = J.g, c;
  for (c = 0; c < g.length; c++) g[c] = 1 + BEAM_SWING * Math.sin(t * 0.00035 + ((c >> 1) * 1.9));
  var u32 = new Uint32Array(fb.d.buffer, fb.d.byteOffset);
  var n = J.n, idx = J.idx, tt = J.t, thr = J.thr, ci = J.ci, pk = J.pk;
  for (var i = 0; i < n; i++) {
    var k = ci[i], v = tt[i] * g[k];
    if (v <= thr[i]) continue;
    var col = pk[k * 3 + (v > 0.82 ? 2 : (v > 0.46 ? 1 : 0))];
    if (col) u32[idx[i]] = col;
  }
}

/* The patch of light a beam lays on the trail, at the foot of its column.
   Pulled out of the scene so it can be recorded the same way the beam is —
   the two belong together and have to brighten as one. */
function pool(fb, W, gy, lean, cxf, wide, gain, col, bag) {
  var px2 = Math.round(W * cxf + Math.sin(lean) * gy), pw = Math.max(6, wide * 1.5);
  for (var pxx = -pw; pxx <= pw; pxx++) {
    var pt = (1 - Math.abs(pxx) / pw) * gain;
    for (var pyy = -3; pyy <= 2; pyy++) {
      var d = pt * (1 - Math.abs(pyy) / 4);
      var thr = BAYER[(gy + pyy) & 7][(px2 + pxx) & 7] / 64;
      if (bag) {
        /* fb.px truncates and bounds-checks; the bag has to do both itself or
           a beam near an edge would write into the wrong row. */
        var bx = (px2 + pxx) | 0, by = (gy - 4 + pyy) | 0;
        if (d > thr * BEAM_KEEP && bx >= 0 && bx < W && by >= 0 && by < fb.h) {
          bag.idx.push(by * W + bx); bag.t.push(d); bag.thr.push(thr); bag.ci.push(bag.n);
        }
        continue;
      }
      if (d > thr) fb.px(px2 + pxx, gy - 4 + pyy, col);
    }
  }
  if (bag) { bag.cols.push(col, col, col); bag.n++; }
}

/* Foliage hanging from the top of the frame. Two octaves of the same noise
   the gas clouds use — one for the overall sag of the canopy, one for the
   leafiness of its edge — so it reads as a mass rather than a wave. */
function canopy(fb, W, edge, depth, col, seed, coarse, up, heights, drop) {
  var n1 = vnoise(seed), n2 = vnoise(seed + 61), n3 = vnoise(seed + 149);
  for (var x = 0; x < W; x++) {
    var sag  = n1(x / coarse, 0.5);                     // how the mass hangs
    var lump = n2(x / (coarse * 0.26), 3.5) - 0.5;      // clusters of leaves
    var jag  = n3(x / (coarse * 0.07), 9.5) - 0.5;      // the edge itself
    var h = Math.round(depth * (0.40 + 0.60 * sag)
                     + depth * 0.42 * lump
                     + depth * 0.30 * jag);
    if (drop) h += Math.round(drop(x));               // hangs lower over a corner
    if (h <= 0) continue;
    if (heights) heights[x] = h;                      // for whoever disturbs it later
    if (up) fb.rect(x, edge - h, 1, h, col);          // rising from the trail
    else    fb.rect(x, edge, 1, h, col);              // hanging from the top
  }
}

/* A vine, falling from the canopy edge with a slow wander. Ends in a leaf,
   which is the only thing that tells it from a scratch. */
function vine(fb, x, top, len, p, seed) {
  var q = rng(seed), drift = 0;
  for (var i = 0; i < len; i++) {
    if (q() > 0.72) drift += q() > 0.5 ? 1 : -1;
    fb.px(x + drift, top + i, i > len - 4 ? p.leafFar : p.leafMid);
  }
  var ly = top + len;
  fb.rect(x + drift - 1, ly, 3, 2, p.leafFar);
  fb.px(x + drift, ly + 2, p.leafFar);
}

/* Palm Court's water, on its own so a frame can redraw it without paying for
   the whole scene — measured at 4-9ms, far too much to spend every frame.

   Waves crowd at the horizon and open out toward the shore. The banding used to
   be the row number modulo six: the same six rows tiled down the whole band,
   which passed while the water was an eighth of the canvas and became wallpaper
   once the ground plane moved to 0.58 and it took nearly a third. The phase is
   integrated down the rows instead of taken modulo, so the spacing widens
   smoothly rather than stepping — three rows between crests at the waterline,
   ten by the shore. Crest thickness is a fraction of the local period, so it
   thickens with the spacing for free, and the wobble is divided by that period
   so it stays a row or two of lateral wander at either end.

   `drift` rolls the crests shoreward. The lateral wobble depends only on x, so
   it is computed once per width rather than twice per pixel — that alone was
   most of the cost of the old loop. */
var W_WOB = null, W_WOB_W = -1;
function waterWobble(W) {
  if (W_WOB_W !== W) {
    W_WOB = new Float32Array(W);
    for (var x = 0; x < W; x++) {
      W_WOB[x] = Math.sin(x * 0.14) * 1.7 + Math.sin(x * 0.052) * 2.3;
    }
    W_WOB_W = W;
  }
  return W_WOB;
}

function water(fb, p, W, wtop, wbot, drift, fromY) {
  var rows = Math.max(1, wbot - wtop), wob = waterWobble(W);
  var ph = new Float32Array(rows), acc = 0, i;
  for (i = 0; i < rows; i++) {
    /* Five rows between crests at the waterline opening to twelve by the shore.
       Three was too fine: a crest a pixel thick with two pixels between it and
       the next reads as static however slowly it moves, which is what made the
       far water look busy. Fewer, larger crests up there is the fix — not a
       slower clock. */
    acc += 1 / (5 + 7 * (i / Math.max(1, rows - 1)));
    ph[i] = acc;
  }
  var y0 = fromY == null ? wtop + 2 : fromY;
  for (var y = y0; y < wbot; y++) {
    var d = y - wtop, near = d / Math.max(1, rows - 1);
    /* Uniform drift, every row advancing at the same phase rate, so a crest
       stays one line. Scaling the rate by depth did calm the horizon, but it
       let neighbouring rows drift apart without bound — seven periods after a
       minute, thirty-six after five — and the crests folded into loops and
       crossings. The screen speed still varies with depth for free, because
       one unit of phase is five rows at the waterline and twelve at the shore. */
    var base = ph[d] - drift;
    for (var x = 0; x < W; x++) {
      /* A fixed fraction of a period, not the wobble divided by it. Dividing
         gave the horizon a swing of ±1.33 periods, so the crest wrapped past
         itself and closed — those were the rings. At 0.055 it is ±0.22 of a
         period everywhere, which wanders without ever folding. */
      var t = base + wob[x] * 0.055, f = t - Math.floor(t);
      if (f < 0.20 && ((x + y) & 1) === 0) fb.px(x, y, p.litDim);
      /* Sparkles are the busiest thing in the band, so they keep off the far
         third where there is no room for them to read as anything but noise. */
      else if (near > 0.30 && f > 0.46 && f < 0.60 && (x & 3) === 0) fb.px(x, y, p.lit);
    }
  }
}

/* A cloud drawn only over its own bounding box. `cloud()` above walks the whole
   sky for every cloud it draws, which is affordable once at load — it is most of
   why Space Port measures 39ms — and hopeless sixty times a second. This one
   touches a few thousand pixels instead of eighty thousand.

   Drawn twice, a width apart, so a cloud leaving one edge is already arriving at
   the other and the drift never shows a seam. */
function driftCloud(fb, W, cx, cy, halfW, halfH, dim, mid, lit, seed) {
  var n = vnoise(seed), s = Math.max(6, halfW * 0.22);
  for (var pass = 0; pass < 2; pass++) {
    // the wrapped copy is only worth drawing when the cloud is over an edge
    if (pass && cx - halfW > 0 && cx + halfW < W) continue;
    var x = cx + (pass ? (cx > W / 2 ? -W : W) : 0);
    var x0 = Math.max(0, Math.floor(x - halfW)), x1 = Math.min(W, Math.ceil(x + halfW));
    var y0 = Math.max(0, Math.floor(cy - halfH)), y1 = Math.ceil(cy + halfH);
    for (var py = y0; py < y1; py++) {
      for (var px = x0; px < x1; px++) {
        var u = (px - x) / halfW, v = (py - cy) / halfH;
        var f = 1 - (u * u + v * v);
        if (f <= 0) continue;
        var t = f * (0.45 + 0.85 * n(px / s, py / s));
        if (t <= BAYER[py & 7][px & 7] / 64) continue;
        fb.px(px, py, t > 0.72 ? lit : (t > 0.45 ? mid : dim));
      }
    }
  }
}

/* The strip the clouds drift through: above every tower, so repainting it costs
   nothing but the clouds themselves. */
/* Space Port's sky, which breathes.

   A full redraw of this setting measures 39ms at 960x540: `cloud()` walks the
   whole sky once per cloud and there are five of them, each sampling two
   octaves of value noise per pixel. Redrawing that sixty times a second is not
   close to possible, which is why the first pass here moved eighteen stars and
   nothing else — true, and too small to notice.

   So the gas moves without being redrawn. Each cloud pixel is walked once, at
   load, and remembers two numbers: how dense the gas is there, and the Bayer
   threshold it is dithered against. Density over threshold is what decides
   whether the pixel is lit and how brightly. Hold the noise still and put a
   slow gain on the density, and the cut walks: the ragged edge of each cloud
   advances and retreats, pixels at the margin come and go, and the gas reads
   as billowing. It is the dither doing the work, which is the one kind of
   motion this renderer gets for free.

   About seven per cent of the sky changes at any moment, over a twenty-eight
   second breath, five clouds out of phase. That was fourteen to begin with,
   which read as weather rather than as gas: at this scale the eye wants the
   edge to be barely caught moving. Nothing shifts position and nothing
   changes colour — held at rest it is pixel-for-pixel the sky `drawScene`
   draws. */
var GAS_SWING = 0.13, GAS_KEEP = 1 / (1 + GAS_SWING);
var SPACE_GAS = null, SPACE_STARS = null, SPACE_PAL = null;

/* An empty bag for the five clouds to record themselves into. Deliberately not
   cached by size: a null bag means "draw normally", so handing one back for a
   size we had already seen would put the gas into the still and bury the stars
   under the first repaint. Filling it costs what drawing the clouds costs,
   which the scene was paying at this moment anyway. */
function spaceGasBag() {
  return { idx: [], t: [], thr: [], ci: [], cols: [], n: 0 };
}

/* Close the bag into typed arrays and pack the fifteen colours into one
   Uint32Array, so a frame is an index, a multiply, a compare and a single
   32-bit store. Done as plain arrays of boxed numbers it was eight times
   slower and would not have fitted in a frame. */
function spaceGasDone(gas, W) {
  var n = gas.idx.length;
  var pk = new Uint32Array(gas.cols.length);
  for (var i = 0; i < gas.cols.length; i++) {
    var c = gas.cols[i];
    pk[i] = c ? (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0] : 0;
  }
  SPACE_GAS = {
    n: n, W: W,
    idx: new Int32Array(gas.idx), t: new Float32Array(gas.t),
    thr: new Float32Array(gas.thr), ci: new Uint8Array(gas.ci),
    pk: pk, g: new Float32Array(gas.n)
  };
}

/* Which stars breathe, and how fast. Eighteen of the bright ones, out of
   phase, so the field never pulses together. */
function spaceSetLive(seen, p) {
  SPACE_STARS = seen; SPACE_PAL = p;
  var bright = [], i;
  for (i = 0; i < seen.length; i++) if (seen[i].lit) bright.push(seen[i]);
  if (!bright.length) return;
  var q = rng(1487), want = Math.min(18, bright.length), taken = {};
  for (i = 0; i < want * 6 && want > 0; i++) {
    var k = (q() * bright.length) | 0;
    if (taken[k]) continue;
    taken[k] = 1; want--;
    /* Radians per ms: a full breath is 2*PI/rate, so these are 3s to 8s.
       The first numbers here were a quarter of that and gave a 28-second
       cycle, which is not a twinkle. */
    bright[k].rate = 0.00079 + q() * 0.00130;
    bright[k].phase = q() * Math.PI * 2;
  }
}

/* One frame of sky: the gas at its current density, then the whole star field
   back on top of it.

   The gas does not move and is not redrawn — redrawing means walking two
   octaves of value noise over five overlapping clouds, which is most of the
   39ms a full Space Port costs and is hopeless at any frame rate. What moves
   is where each cloud's dither cuts off. Every pixel already knows its own
   density and its own threshold; a slow gain on the density walks the cut
   back and forth, so the ragged edge of each cloud advances and retreats and
   the gas reads as breathing. Five clouds, out of phase, about twenty-eight
   seconds each.

   The stars go down after, because they always did — they are drawn over the
   gas, and repainting the gas without them would bury a couple of hundred. */
function spaceSky(fb, t) {
  var G = SPACE_GAS;
  if (G) {
    var g = G.g, c;
    for (c = 0; c < g.length; c++) g[c] = 1 + GAS_SWING * Math.sin(t * 0.00022 + c * 1.7);
    var u32 = new Uint32Array(fb.d.buffer, fb.d.byteOffset);
    var n = G.n, idx = G.idx, tt = G.t, thr = G.thr, ci = G.ci, pk = G.pk;
    for (var i = 0; i < n; i++) {
      var k = ci[i], v = tt[i] * g[k];
      if (v <= thr[i]) continue;
      var col = pk[k * 3 + (v > 0.88 ? 2 : (v > 0.62 ? 1 : 0))];
      if (col) u32[idx[i]] = col;
    }
  }
  var S2 = SPACE_STARS, p = SPACE_PAL;
  if (!S2 || !p) return;
  for (var j = 0; j < S2.length; j++) {
    var s = S2[j], col = s.col;
    /* Three steps rather than a fade: dim, its own colour, and white. Anything
       smoother is invisible at this size and costs the same. */
    if (s.rate) {
      var b = 0.5 + 0.5 * Math.sin(t * s.rate + s.phase);
      col = b > 0.80 ? p.lit : (b > 0.30 ? s.col : p.litDim);
    } else if (!s.lit) col = p.litDim;
    if (s.ray) {
      fb.px(s.x, s.y, col);
      fb.px(s.x - 1, s.y, p.litDim); fb.px(s.x + 1, s.y, p.litDim);
      fb.px(s.x, s.y - 1, p.litDim); fb.px(s.x, s.y + 1, p.litDim);
    } else fb.px(s.x, s.y, col);
  }
}

function duskCloudBand(H) { return Math.round(H * 0.22); }

/* A dozen windows that will turn over, chosen once from the ones the skyline
   actually drew. Everything else stays exactly as the still has it.

   Repainting a band the way the clouds do would mean redrawing the whole sky,
   since the windows sit inside the skylines — 2.7ms at 640x360 against the
   cloud strip's 1.0, and a far bigger upload. A window is a 2x2 rect, so the
   cheaper thing by a long way is to repaint the dozen and nothing else.

   Twelve is chosen for the effect as much as the cost: a city where a light
   goes off now and then, not a string of fairy lights. Each keeps its own rate
   so they never turn together. */
var DUSK_LIVE = null, DUSK_LIVE_KEY = '';
function duskPickLive(found, W, H, p) {
  var key = W + 'x' + H;
  if (DUSK_LIVE_KEY === key) return;
  DUSK_LIVE_KEY = key; DUSK_LIVE = [];
  if (!found.length) return;
  var q = rng(1201), want = Math.min(12, found.length);
  var taken = {};
  for (var i = 0; i < want * 6 && DUSK_LIVE.length < want; i++) {
    var k = (q() * found.length) | 0;
    if (taken[k]) continue;
    taken[k] = 1;
    var f = found[k];
    DUSK_LIVE.push({
      x: f.x, y: f.y, off: f.off,
      on: q() < 0.55 ? p.lit : p.litDim,
      rate: 0.00004 + q() * 0.00007,     // a turn every four to sixteen seconds
      phase: q(),
      duty: 0.45 + q() * 0.25
    });
  }
}

function duskWindows(fb, t) {
  if (!DUSK_LIVE) return;
  for (var i = 0; i < DUSK_LIVE.length; i++) {
    var w = DUSK_LIVE[i];
    var f = ((t * w.rate) + w.phase) % 1;
    fb.rect(w.x, w.y, 2, 2, f < w.duty ? w.on : w.off);
  }
}

function duskClouds(fb, W, H, p, t) {
  var drift = (t || 0) * 0.0000085;          // a lap of the sky in a couple of minutes
  var band = duskCloudBand(H);
  var set = [[0.14, 0.34, 0.26, 0.42, 311],
             [0.52, 0.55, 0.20, 0.34, 617],
             [0.83, 0.30, 0.23, 0.38, 823]];
  for (var i = 0; i < set.length; i++) {
    var c = set[i];
    var fx = (c[0] + drift * (0.7 + i * 0.25)) % 1;
    driftCloud(fb, W, fx * W, band * c[1], W * c[2], band * c[3],
               p.cloudDim, p.cloudMid, p.cloudLit, c[4]);
  }
}

function drawScene(fb, S, W, H, noMotion) {
  var p = S.pal;
  var r = function (f) { return Math.round(H * f); };
  var gy = groundY(H);

  if (S.key === 'dusk') {
    var hz = gy - r(0.02);                 // the skyline meets the ground plane
    fb.skyBand(0, 0, W, hz, p.sky);
    /* Clouds rather than a sun. The sun sat at a fixed point doing nothing;
       the clouds occupy the same upper sky and move. Skipped when the caller
       means to animate them — it keeps the still free of clouds and composites
       them itself. */
    if (!noMotion) duskClouds(fb, W, H, p, 0);
    var found = [];
    skyline(fb, 0, r(0.10), W, hz - r(0.03), p.towerFar, p.lit, p.litDim, 3, 0.16, found);
    skyline(fb, 0, r(0.16), W, gy, p.tower, p.lit, p.litDim, 23, 0.26, found);
    duskPickLive(found, W, H, p);
    fb.rect(0, gy, W, H, p.floor);
    fb.skyBand(0, gy, W, groundBand(H), [p.floorLit, p.floor]);

  } else if (S.key === 'space') {
    fb.skyBand(0, 0, W, gy, p.sky);
    /* One galactic band across the whole sky, then gas at three temperatures
       laid over it at different angles. They overlap rather than tile, which
       is what keeps it from reading as one flat colour. */
    /* When the setting is going to move, the clouds are recorded into `gas`
       rather than drawn, and the still keeps nothing but the sky gradient. */
    var gas = noMotion ? spaceGasBag() : null;
    cloud(fb, W, gy, -0.22, 0.50, 0.44, Math.max(18, gy*0.40), W*0.58, 0.92, p.band, p.bandMid, p.bandLit, 91, 1, gas);
    cloud(fb, W, gy,  0.34, 0.17, 0.40, Math.max(13, gy*0.27), W*0.17, 0.80, p.teal, p.tealMid, p.tealLit, 214, 1, gas);
    cloud(fb, W, gy, -0.44, 0.79, 0.39, Math.max(12, gy*0.25), W*0.22, 0.76, p.rose, p.roseMid, p.roseLit, 377, 1, gas);
    // the gold runs up into the top left, and fades as it goes
    /* Its faintest step is a dark violet, not a dark olive — where the gold
       thins out over the band it now settles into the sky instead of browning
       it, and only shows its own colour where it is actually dense. */
    cloud(fb, W, gy,  0.46, 0.40, 0.30, Math.max(9,  gy*0.17), W*0.20, 0.84, p.gold, p.goldMid, p.goldLit, 508, 0.42, gas);
    // and a warm bank low on the right, under the rose
    cloud(fb, W, gy, -0.18, 0.82, 0.84, Math.max(11, gy*0.23), W*0.15, 0.90, p.coral, p.coralMid, p.coralLit, 733, 1, gas);
    /* and a small gold bank low on the left, where the sky was bare blue.
       Tapered on its inner end so it thins out toward the middle rather than
       stopping, which would read as an edge. */
    cloud(fb, W, gy, -0.26, 0.13, 0.82, Math.max(7,  gy*0.14), W*0.15, 0.86, p.gold, p.goldMid, p.goldLit, 941, 0.55, gas);
    if (gas) spaceGasDone(gas, W);
    var seen = [];
    stars(fb, W, gy, p, Math.max(90, Math.round(W * gy / 560)), 1301, seen, noMotion);
    if (noMotion) spaceSetLive(seen, p);
    // the deck: flat, and a lit lip where it meets the dark, like the others
    fb.rect(0, gy, W, H - gy, p.floor);
    fb.skyBand(0, gy, W, groundBand(H), [p.floorLit, p.floor]);

  } else if (S.key === 'jungle') {
    fb.skyBand(0, 0, W, gy, p.sky);        // dark overhead, bright down the trail

    /* Depth is carried by colour as much as value: the far layers are cooler
       and bluer, the near ones warm and almost black. */
    cloud(fb, W, gy, -0.03, 0.50, 0.46, Math.max(12, gy*0.30), W*0.75, 0.62, null, p.mistFar, p.mistNear, 611);

    /* Trees back in the haze. Dithered away toward the trail so they sink
       into the mist rather than standing there like poles. */
    var fq = rng(88), fn = Math.max(6, Math.round(W / 78));
    for (var fi = 0; fi < fn; fi++) {
      var fx = Math.round((fi + 0.1 + fq() * 0.8) * (W / fn));
      var fw = Math.max(1, Math.round(W * 0.0035));
      var ftop = Math.round(gy * fq() * 0.30);
      for (var fy = ftop; fy < gy; fy++) {
        var keep = 0.95 - 0.95 * ((fy - ftop) / (gy - ftop));
        if (BAYER[fy & 7][fx & 7] / 64 > keep) continue;
        fb.rect(fx, fy, fw, 1, p.trunkFar);
      }
    }

    canopy(fb, W, 0, gy * 0.46, p.leafFar, 512, 52, false);

    /* The far left carries a beam too, and one starting at the top of the
       frame would put light up behind the wordmark. So the two hanging layers
       reach lower over that corner and the new column emerges from under them,
       below the logo, rather than from the top edge. Squared, so it is a
       thickening at the corner and not a slope across the frame; by a third of
       the width it is gone and the other beams are untouched.

       The taper stays wide because the arc it throws around the scene is the
       point; only the depth came back, from 0.38, which hung too far down.

       The right corner does the same, a little shallower, which closes the arc
       into the vignette the two of them make together. It has no wordmark to
       clear, so it is set by how the frame looks and not by what it has to
       cover. */
    var cornerDrop = function (x) {
      var l = 1 - Math.min(1, x / (W * 0.30));
      var r = 1 - Math.min(1, (W - 1 - x) / (W * 0.30));
      return l * l * gy * 0.29 + r * r * gy * 0.24;
    };

    // light down through the gaps, and where each column lands on the trail
    var beams = [[0.26, 0.055, 0.038, 0.74], [0.20, 0.24, 0.070, 0.86],
                 [0.13, 0.45, 0.052, 0.88], [0.24, 0.66, 0.044, 0.80],
                 [0.17, 0.87, 0.036, 0.70]];
    /* Everything drawn from here on sits in front of the light, so the still
       is snapshotted at exactly this point: whatever the later layers write
       over is a beam pixel the frame must not repaint. */
    var bag = noMotion ? jungleBag() : null;
    var pre = bag ? fb.d.slice(0) : null;
    for (var bi = 0; bi < beams.length; bi++) {
      var bm = beams[bi], bwide = Math.max(7, W*bm[2]);
      shaft(fb, W, gy, bm[0], bm[1], bwide, bm[3], p.shaftDim, p.shaftMid, p.shaftLit, bag);
      pool(fb, W, gy, bm[0], bm[1], bwide, bm[3], p.pool, bag);
    }

    canopy(fb, W, 0, gy * 0.36, p.leafMid, 733, 33, false, null, cornerDrop);

    var tq = rng(404), tn = Math.max(5, Math.round(W / 96));
    for (var ti = 0; ti < tn; ti++) {
      var tx = Math.round((ti + 0.12 + tq() * 0.76) * (W / tn));
      var base = Math.max(3, Math.round(W * (0.005 + tq() * 0.014)));
      var lean = (tq() - 0.5) * 0.07;
      for (var ty = 0; ty < gy; ty++) {                // wider at the foot
        var tw = Math.max(2, Math.round(base * (0.66 + 0.34 * ty / gy)));
        var ox = Math.round(lean * (gy - ty));
        fb.rect(tx + ox, ty, tw, 1, p.trunk);
        fb.px(tx + ox + tw - 1, ty, p.trunkLit);
      }
    }

    canopy(fb, W, 0, gy * 0.24, p.leafNear, 951, 17, false, null, cornerDrop);
    var bh1 = bag ? new Int16Array(W) : null, bh2 = bag ? new Int16Array(W) : null;
    canopy(fb, W, gy, gy * 0.21, p.leafMid,  178, 21, true, bh1);
    canopy(fb, W, gy, gy * 0.13, p.leafNear, 266, 12, true, bh2);

    fb.rect(0, gy, W, H - gy, p.floor);
    fb.skyBand(0, gy, W, groundBand(H), [p.floorLit, p.floor]);
    if (bag) { jungleDone(bag, pre, fb, W); jungleBrush(bh1, bh2, W, gy, p); }

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
    /* Waves crowd at the horizon and open out toward the shore. The banding
       used to be the row number modulo six — the same six rows tiled down the
       whole band, which passed while the water was an eighth of the canvas and
       became wallpaper once the ground plane moved to 0.58 and it took nearly a
       third.

       The phase is integrated down the rows rather than taken modulo, so the
       spacing can widen smoothly instead of stepping: three rows between crests
       at the waterline, ten by the shore. Crest thickness is a fraction of the
       local period, so it thickens with the spacing for free, and the wobble is
       divided by that period so it stays a row or two of lateral wander at
       either end rather than growing with it. */
    /* Crests are part of the moving pass, so the still keeps the flat gradient
       only — redrawing them over a still that already had them would stack one
       set of crests on another. */
    if (!noMotion) water(fb, p, W, wtop, wbot, 0);
    fb.rect(0, wbot, W, H-wbot, p.floor);
    fb.skyBand(0, wbot, W, groundBand(H), [p.floorLit, p.floor]);
    // palms spread across whatever width we were given, rather than the four
    // hand-placed ones the mock could get away with
    /* Palms are placed rather than merely scattered: each one knows how far
       its own fronds reach, so it can be held clear of its neighbour and of
       the sun while keeping its jitter — the spacing reads as uneven without
       any two of them running together. And since a palm grows with the
       canvas, the count comes from the room each one wants rather than from
       the width alone, so they stay evenly spread at any size. */
    /* Skipped when the caller means to animate them: it keeps the still it
       cached free of palms and composites them itself, frame by frame. */
    if (!noMotion) palms(fb, p, palmSpots(W, H, wtop, px2, pr), 0);
  }
}

/* Where the palms stand. Split out from the drawing so a frame can redraw them
   over a cached still without recomputing anything, and so an extra one can be
   slipped in without disturbing the rest — the positions come from a per-palm
   seed and a cell width, so bumping the count would move every one of them. */
function palmSpots(W, H, wtop, sunX, sunR_) {
  /* Palms are placed rather than merely scattered: each one knows how far its
     own fronds reach, so it can be held clear of its neighbour and of the sun
     while keeping its jitter. And since a palm grows with the canvas, the count
     comes from the room each one wants rather than from the width alone. */
  var need = H * 0.18 * 1.24 + 8;
  var n = Math.max(3, Math.min(Math.round(W / 82), Math.floor(W / need)));
  var cell = W / n;
  /* How close a crown may come to the sun, tuned per side: the palm that steps
     right of it tucks in under the disc, where the fronds droop away and
     nothing actually meets. */
  var sunL = sunX - sunR_ + 3, sunR = sunX + sunR_ - 5;
  /* Hold them apart only where there is room to. A narrow canvas cannot fit
     three crowns side by side, and letting them crowd reads better than
     shoving one off the edge to keep a rule. */
  var roomy = cell >= need;
  var prevX = -1e9, prevHalf = 0, out = [];

  for (var i = 0; i < n; i++) {
    var q = rng(41 + i*17);
    var pxp = Math.round((i + 0.20 + q()*0.60) * cell);
    var ph  = Math.round(H * (0.13 + q()*0.10));
    var half = Math.round(ph * 0.62) + 2;        // how far the fronds carry
    var gap  = 5;

    if (roomy) {
      if (pxp - half < prevX + prevHalf + gap) pxp = prevX + prevHalf + half + gap;
      if (pxp + half > sunL && pxp - half < sunR) {        // and clear of the sun
        /* Step aside to whichever side it was already nearer. Always stepping
           right cascades: one palm shoved past the sun pushes every palm after
           it, and the last falls off the edge. */
        var toLeft = sunL - half, toRight = sunR + half;
        if (pxp < sunX && toLeft - half >= prevX + prevHalf + gap) pxp = toLeft;
        else if (toRight + half <= W + half) pxp = toRight;
        else pxp = toLeft;
      }
      if (pxp - half < prevX + prevHalf + gap) pxp = prevX + prevHalf + half + gap;
    }
    /* A palm is either wholly in frame or it is not there. `half` is how far
       its fronds carry, so bounding the trunk by the edge — which is what an
       earlier version of this did — only moved the fault: the trunk stayed but
       the crown was sliced, and a palm cut down the middle at the edge reads
       worse than one that is simply absent. Bound the reach instead. */
    var reach = half + 8;        // `half` ignores the trunk's lean, which
    if (pxp + reach > W - 2) pxp = W - 2 - reach;   // tilts the crown by up to
    if (pxp - reach < 2) pxp = 2 + reach;           // five px, and asymmetrically

    out.push({ x: pxp, h: ph,
               baseY: wtop + Math.round(H*0.012) + Math.round(q()*H*0.03),
               lean: (i % 2 ? 1 : -1) * (4 + Math.round(q()*7)),
               seed: 41 + i*17 });
    prevX = pxp; prevHalf = half;
  }

  /* Two hand-set heights, applied after placement so no x moves: the loop
     above derives each palm's frond reach from its height and spaces the row on
     it, so changing a height before it would shuffle the whole beach.

     The first stands where the corner mark does — its fronds reached y=11 into
     a mark whose box is y 10..29 — and it drew a third taller than its
     neighbours besides. The third sat low between two that did not. */
  /* 0.76 is as tall as the first one goes: at 0.80 its fronds meet the mark's
     box dead on at a world width of 480. Measured across four widths. */
  if (out.length > 0) out[0].h = Math.round(out[0].h * 0.76);
  if (out.length > 1) out[1].x -= 5;
  if (out.length > 2) out[2].h = Math.round(out[2].h * 1.35);

  /* One more between the fifth and the sixth — the gap that falls nearest the
     sun, which the sun-avoidance above opens up. Inserted after the fact rather
     than by raising the count, because the count sets the cell width and every
     palm's position with it. */
  if (out.length >= 6) {
    var a = out[4], b = out[5], q2 = rng(613);
    var hx = Math.round(H * (0.13 + q2()*0.10));
    var hh = Math.round(hx * 0.62) + 2;
    var mx = Math.round((a.x + b.x) / 2);
    /* That gap is wide precisely because the sun sits in it and the loop above
       steers everyone clear, so the midpoint lands on the disc at some canvas
       sizes and misses it at others. Give the newcomer the same rule the rest
       get, stepping to whichever side it was already nearer. */
    if (mx + hh > sunL && mx - hh < sunR) {
      mx = (mx < sunX) ? sunL - hh : sunR + hh;
    }
    var reachN = hh + 8;
    if (mx + reachN > W - 2) mx = W - 2 - reachN;
    if (mx - reachN < 2) mx = 2 + reachN;
    var np = {
      x: mx, h: hx,
      baseY: wtop + Math.round(H*0.012) + Math.round(q2()*H*0.03),
      lean: 4 + Math.round(q2()*7),
      seed: 613
    };
    /* Sort before choosing what to drop. The sun step above can carry the
       newcomer past the palm that was on its right, so its left-hand neighbour
       is not whichever index it was inserted at — taking index 4 on faith left
       a 192px gap and a 12px pair at 640 wide. Ask the sorted list instead.
       The count comes out unchanged, so it reads as that palm having moved
       along rather than as one more added. */
    out.push(np);
    out.sort(function (u, v) { return u.x - v.x; });
    var ni = out.indexOf(np);
    if (ni > 0) out.splice(ni - 1, 1);
  }
  /* A companion beside the second palm, so that one reads as a clump rather
     than a lone trunk. Shorter, a little to its right, its own seed. Added last
     and then re-sorted, so every palm already placed keeps its position — the
     three tuned by hand included. */
  if (out.length > 1) {
    /* The two rise from nearly the same spot and lean apart, the way a pair
       actually grows — so the bases sit close and the crowns do the spreading.
       Height comes off the double already standing at the right-hand end,
       where the shorter is roughly four fifths of the taller. */
    var c2 = out[1], qc = rng(877);
    var ch2 = Math.round(c2.h * 1.5 * (0.80 + qc() * 0.10));
    var cx2 = c2.x - Math.round(c2.h * (0.09 + qc() * 0.05));
    var cr2 = Math.round(ch2 * 0.62) + 10;
    if (cx2 + cr2 > W - 2) cx2 = W - 2 - cr2;
    if (cx2 - cr2 < 2) cx2 = 2 + cr2;
    out.push({
      x: cx2, h: ch2,
      baseY: wtop + Math.round(H*0.012) + Math.round(qc()*H*0.03),
      /* Arched against its partner rather than alongside it: with both leaning
         the same way the pair curved in parallel and read as one palm drawn
         twice. The sign is taken from the partner because that alternates with
         the palm's index rather than being fixed. */
      lean: (c2.lean > 0 ? -1 : 1) * (5 + Math.round(qc()*6)),
      seed: 877
    });
    out.sort(function (u, v) { return u.x - v.x; });
  }

  return out;
}

/* Drawn back to front so a nearer crown overlaps the one behind it. `t` is
   milliseconds; each palm takes its own phase off its seed so they do not
   sway in unison, which would read as the whole grove tipping. Nine seconds a
   cycle — slow enough that you notice the scene is alive without being able to
   point at what moved. */
function palms(fb, P2, spots, t) {
  for (var i = 0; i < spots.length; i++) {
    var sp = spots[i];
    var sway = t ? Math.sin(t * 0.0007 + (sp.seed % 17) * 0.37) : 0;
    palm(fb, sp.x, sp.baseY, sp.h, sp.lean, P2, sp.seed, sway);
  }
}

/* ── motion ────────────────────────────────────────────────────────────────

   Redrawing a whole scene every frame is not affordable: measured at 2ms for
   Dusk Terrace and 39ms for Space Port at 960x540, against a 16ms budget that
   the board and the cards also have to come out of. So a scene that moves
   names the band that moves, and the caller keeps a still of everything else
   and repaints only that band.

   Palm Court moves its fronds and nothing else — the motion belongs in the sky
   band beside the board rather than behind it, where the eye would have to
   compete with it to read a card. The water is left still on the same grounds:
   at a ground plane of 0.58 it sits squarely behind the board. */

/* Whether a scene moves at all — answerable before it has been drawn, which
   sceneMotion is not: Space Port's regions are its stars, and they are not known
   until the sky has put them down. The caller needs this first, to decide
   whether to keep a still. */
function sceneAnimates(S) {
  return S.key === 'palms' || S.key === 'dusk' || S.key === 'space' ||
         S.key === 'jungle';
}

/* Returns the regions a frame repaints, or null for a still scene. A list
   rather than one band: Dusk moves a wide strip of sky and a dozen 2x2 windows
   scattered under it, and repainting one band big enough to hold both would
   mean redrawing every tower sixty times a second. */
function sceneMotion(S, H, W) {
  if (S.key === 'dusk') {
    var out = [{ x: 0, y: 0, w: W, h: duskCloudBand(H) }];
    if (DUSK_LIVE) {
      for (var i = 0; i < DUSK_LIVE.length; i++) {
        out.push({ x: DUSK_LIVE[i].x, y: DUSK_LIVE[i].y, w: 2, h: 2 });
      }
    }
    return out;
  }
  /* The whole sky, in one piece. It was eighteen little squares when only the
     stars moved; now the gas breathes underneath them there is no smaller
     answer, and the star squares are inside this anyway. Two thirds of the
     canvas, the same share Palm Court repaints. */
  if (S.key === 'space') return [{ x: 0, y: 0, w: W, h: groundY(H) }];
  /* Just the rows the surviving light actually occupies — the beams reach the
     top of the frame but the pools stop a few rows short of the trail, and
     everything below that is floor. */
  if (S.key === 'jungle') {
    if (!JUNGLE || !JUNGLE.n) return null;
    var jy0 = JUNGLE.y0, jy1 = JUNGLE.y1;
    /* The bushes sit below the light and reach the trail, so the band has to
       cover both or a rustle would be uploaded from a rectangle it is not in. */
    if (JBRUSH) {
      if (JBRUSH.y0 < jy0) jy0 = JBRUSH.y0;
      if (JBRUSH.gy - 1 > jy1) jy1 = JBRUSH.gy - 1;
    }
    if (jy1 >= H) jy1 = H - 1;
    return [{ x: 0, y: jy0, w: W, h: jy1 - jy0 + 1 }];
  }
  if (S.key !== 'palms') return null;
  /* Down to the waterline's foot: the crowns reach from about 0.02H to just
     under it, and the crests run the whole way. The floor below never moves. */
  return [{ x: 0, y: 0, w: W, h: Math.min(H, groundY(H) + 1) }];
}

function drawSceneMotion(fb, S, W, H, t) {
  if (S.key === 'dusk') { duskClouds(fb, W, H, S.pal, t); duskWindows(fb, t); return; }
  if (S.key === 'space') { spaceSky(fb, t); return; }
  if (S.key === 'jungle') { jungleBeams(fb, t); jungleBush(fb, t); return; }
  if (S.key !== 'palms') return;
  var wtop = Math.round(H * 0.30), wbot = groundY(H);
  var pr = Math.max(12, Math.round(H * 0.05)), px2 = Math.round(W * 0.72);
  /* Crests roll shoreward. One crest's spacing every six seconds or so, which
     at three rows near the horizon and ten by the shore reads as a slow set
     rather than a current. */
  water(fb, S.pal, W, wtop, wbot, t * 0.00013);
  palms(fb, S.pal, palmSpots(W, H, wtop, px2, pr), t);
}
