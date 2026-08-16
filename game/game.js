/* ── BOUNCE ──────────────────────────────────────────────────────────────
   A marble falls down a narrow column onto a curved spring you slide left
   and right. Keep it aloft.

   The bounce period is held exactly constant — every paddle contact launches
   the marble at the same speed, so the pulse is a metronome the player can
   learn by ear and hand. That reliability is load-bearing: the difficulty
   comes entirely from the camera, which pushes in over the course of a run
   and crops away the parts of the trajectory you were reading. Close
   observation costs you the wider field, so you end up playing from rhythm,
   from the marble's spin, and from the shadow it throws down the column
   ahead of itself.

   Control is mapped in WORLD coordinates, never screen coordinates: zoom
   changes what you can see and never how the paddle answers the pointer.

   Everything worth tuning is in CFG. The rest of the file is the machine.
   ──────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var pane = document.getElementById('game-pane');
  if (!pane) return;

  /* ═══ TUNING ═══════════════════════════════════════════════════════════ */

  var CFG = {

    /* ── Rhythm ──
       The metronome. Hold BOUNCE_PERIOD constant and the player can survive
       stretches where they cannot see the marble at all; let it vary and the
       blind sections become guesswork. Gravity is derived from these rather
       than set directly, so the pulse stays identical on every screen size. */
    BOUNCE_PERIOD: 1.15,   // seconds, paddle contact to paddle contact
    APEX_FRAC:     0.62,   // apex rise above the spring, as a fraction of column height
    PADDLE_Y:      0.86,   // spring's resting line, as a fraction of column height

    /* ── Bodies ──
       World units. The column is always 100 wide; its height follows the
       pane's aspect, so these read as percentages of the column's width. */
    BALL_R:        4.0,
    PADDLE_HALF:   13.0,   // half-width of the spring
    PADDLE_THICK:  2.4,
    PADDLE_ARC:    3.4,    // how far the spring's centre dips below its ends
    PADDLE_RECOIL: 5.0,    // dip on contact, world units
    RECOIL_TAU:    0.13,   // how fast that dip springs back, seconds
    SQUASH:        0.34,   // marble deformation on contact, 0 = rigid
    SQUASH_TAU:    0.11,

    /* ── Drift ──
       The vertical is fixed, so all the danger lives sideways. Contact off
       the spring's centre throws the marble; VX_KEEP decides how much of the
       old drift survives, and therefore how much authority the player has to
       steer a run back into a comfortable rhythm. */
    VX_KEEP:       0.72,
    VX_ENGLISH:    30.0,   // sideways kick at the very edge of the spring
    VX_MIN:        5.0,    // never let it settle into a dead vertical orbit
    VX_MAX:        44.0,
    VX_MAX_LATE:   60.0,   // ceiling once the run is fully wound up

    /* ── Control ──
       The pointer sweeps a band wider than the column itself, so a 115px
       playfield doesn't demand 115px of mouse precision. Raise the gain for
       a calmer hand, lower it for a twitchier one. */
    CONTROL_GAIN:  2.2,
    KEY_SPEED:     78.0,   // world units per second on the arrow keys
    PADDLE_TAU:    0.045,  // pointer-following smoothness; 0 is instant

    /* ── The lens ──
       Difficulty. CALM is the opening stretch at full view where the player
       finds the pulse; after that the camera starts taking shots, and the
       shots grow deeper, longer and closer together until DIFF_END. */
    CALM:          18.0,   // seconds of full column before the lens moves
    DIFF_END:      150.0,  // seconds to reach full difficulty
    ZOOM_EARLY:    1.35,
    ZOOM_LATE:     3.20,
    SHOT_EARLY:    2.2,    // how long the lens holds, seconds
    SHOT_LATE:     7.0,
    REST_EARLY:    6.0,    // full-column breathing room between shots
    REST_LATE:     1.2,
    EASE_EARLY:    1.10,   // how gently the lens travels; late shots snap
    EASE_LATE:     0.45,

    /* ── Reading the approach ──
       The marble throws a shadow down onto the spring. This is the whole
       reason a shot that hides the marble is still playable: you read the
       trace instead of the thing. Shorten the range to make late runs meaner. */
    SHADOW_RANGE:      150.0,
    SHADOW_RANGE_LATE: 78.0,

    /* ── The plate ──
       Strata and the sounding scale are the depth reference. Without them a
       zoomed view is featureless paper and the player loses all sense of
       where in the column they are. */
    STRATA_BANDS:  11,
    STRATA_ALPHA:  0.055,
    SCALE_ALPHA:   0.22,
    VIGNETTE_MAX:  0.16,   // field narrowing at full zoom
    TRAIL_N:       30,

    /* ── Ink ──
       Paper, ink, and one aged sepia for annotation. Nothing else. */
    INK:    '#1a1008',
    SEPIA:  '#c07a2b',
    PAPER:  '#ffffff',

    /* ── Idle ──
       The column self-plays until someone takes it. The demo never zooms —
       an idle front page should look composed, not frantic. */
    DEMO_TAU:    0.12,   // how tightly the demo tracks its prediction
    DEAD_HOLD:   3.2     // seconds on the score before returning to idle
  };

  /* ═══ SCAFFOLD ═════════════════════════════════════════════════════════ */

  var canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  pane.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  var score = document.createElement('div');
  score.id = 'game-score';
  pane.appendChild(score);

  var prompt = document.createElement('div');
  prompt.id = 'game-prompt';
  prompt.className = 'game-veil';
  prompt.textContent = 'Bounce';
  pane.appendChild(prompt);

  var over = document.createElement('div');
  over.id = 'game-over';
  over.className = 'game-veil';
  pane.appendChild(over);

  pane.tabIndex = 0;
  pane.setAttribute('aria-label',
    'Bounce: keep a marble aloft on a sliding spring. Arrow keys or pointer.');

  /* ═══ GEOMETRY ═════════════════════════════════════════════════════════ */

  /* The column is 100 units wide by definition; its height follows the pane's
     aspect so nothing is ever stretched. Gravity is re-derived whenever that
     height changes, which is what keeps the pulse identical across screens. */
  var W = 100, H = 600;
  var dpr = 1, cw = 0, ch = 0;
  var G = 0, LAUNCH = 0, PADY = 0;

  function derive() {
    // apex = v²/2g and rise time = period/2 together fix both constants.
    G = 8 * CFG.APEX_FRAC * H / (CFG.BOUNCE_PERIOD * CFG.BOUNCE_PERIOD);
    LAUNCH = G * CFG.BOUNCE_PERIOD / 2;
    PADY = CFG.PADDLE_Y * H;
  }

  function resize() {
    var r = pane.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { cw = ch = 0; return; }

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = Math.round(r.width * dpr);
    ch = Math.round(r.height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    // Rescale anything in flight so a window drag doesn't teleport the marble.
    var next = 100 * (r.height / r.width);
    if (H > 0 && Math.abs(next - H) > 0.001) {
      var k = next / H;
      ball.y *= k; ball.vy *= k;
      for (var i = 0; i < trail.length; i++) trail[i].y *= k;
      cam.y *= k;
    }
    H = next;
    derive();
  }

  /* ═══ STATE ════════════════════════════════════════════════════════════ */

  var MODE = { ATTRACT: 0, PLAY: 1, DEAD: 2 };
  var mode = MODE.ATTRACT;

  var ball  = { x: 50, y: 100, vx: 14, vy: 0, spin: 0, omega: 0, squash: 0 };
  var pad   = { x: 50, target: 50, recoil: 0 };
  var cam   = { x: 50, y: 300, zoom: 1, tx: 50, ty: 300, tzoom: 1, tau: 1.0 };
  var trail = [];

  var clock = 0;          // seconds since this run began; drives all difficulty
  var bounces = 0;
  var best = 0;
  try { best = parseInt(localStorage.getItem('cufo.bounce.best'), 10) || 0; } catch (e) {}

  var deadFor = 0;
  var keyLeft = false, keyRight = false;
  var usingKeys = false;

  // Director
  var shotUntil = 0, resting = true, shot = null;

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ═══ HELPERS ══════════════════════════════════════════════════════════ */

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* Clamped ramp from v0 to v1 as t crosses [t0, t1]. Every difficulty curve
     in the file is one of these, so they can all be read side by side. */
  function ramp(t, t0, t1, v0, v1) {
    if (t <= t0) return v0;
    if (t >= t1) return v1;
    return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }

  /* Reflect a coordinate back and forth inside [lo, hi] — the marble's path
     folded through the column walls. */
  function fold(v, lo, hi) {
    var span = hi - lo;
    if (span <= 0) return lo;
    var t = (v - lo) % (2 * span);
    if (t < 0) t += 2 * span;
    return lo + (t > span ? 2 * span - t : t);
  }

  /* Frame-rate independent exponential smoothing. */
  function approach(cur, goal, tau, dt) {
    if (tau <= 0) return goal;
    return goal + (cur - goal) * Math.exp(-dt / tau);
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* Strata are drawn every frame, so their irregularity is generated once and
     held — a bed that shifted under the marble would read as motion. */
  var strata = (function () {
    var rnd = mulberry32(0x5EAB2E), out = [], i;
    for (i = 0; i <= CFG.STRATA_BANDS; i++) {
      out.push({
        at:    i / CFG.STRATA_BANDS,
        amp:   0.004 + rnd() * 0.010,   // waviness, as a fraction of height
        phase: rnd() * Math.PI * 2,
        freq:  1.2 + rnd() * 2.4,
        tint:  0.45 + rnd() * 0.55      // relative weight of the band above
      });
    }
    return out;
  })();

  /* ═══ RUN LIFECYCLE ════════════════════════════════════════════════════ */

  function reset(startMode) {
    var rnd = Math.random();
    ball.x = 22 + rnd * 56;
    ball.y = 0.18 * H;
    ball.vx = (rnd < 0.5 ? -1 : 1) * (10 + rnd * 14);
    ball.vy = 0;
    ball.spin = 0; ball.omega = 0; ball.squash = 0;
    pad.x = pad.target = 50;
    pad.recoil = 0;
    trail.length = 0;
    clock = 0;
    bounces = 0;
    deadFor = 0;
    resting = true; shot = null; shotUntil = CFG.CALM;
    cam.tx = cam.x = 50;
    cam.ty = cam.y = H / 2;
    cam.tzoom = cam.zoom = 1;
    mode = startMode;
    paint();
  }

  function startPlay() {
    // Take over mid-flight rather than dropping a fresh marble: the handoff
    // from idle to play reads as picking something up, not as a level load.
    if (mode === MODE.PLAY) return;
    if (mode === MODE.DEAD) { reset(MODE.PLAY); return; }
    clock = 0;
    bounces = 0;
    resting = true; shot = null; shotUntil = CFG.CALM;
    mode = MODE.PLAY;
    paint();
  }

  function die() {
    mode = MODE.DEAD;
    deadFor = 0;
    // Withdraw from the eyepiece. The lens easing carries it back over the
    // next second or so, and the count settles over the whole column.
    shot = null;
    cam.tzoom = 1;
    cam.tx = 50;
    cam.ty = H / 2;
    cam.tau = 0.55;
    if (bounces > best) {
      best = bounces;
      try { localStorage.setItem('cufo.bounce.best', String(best)); } catch (e) {}
    }
    over.innerHTML = '<div class="big">' + bounces + '</div>' +
                     '<div>' + (bounces === 1 ? 'bounce' : 'bounces') + '</div>' +
                     (best > 0 ? '<div>best ' + best + '</div>' : '');
    paint();
  }

  /* DOM overlays only change when the mode does, so this is called on
     transitions rather than every frame. */
  function paint() {
    pane.classList.toggle('is-playing', mode === MODE.PLAY);
    // The invitation is hover-driven in CSS; nothing to toggle here.
    pane.classList.toggle('is-attract', mode === MODE.ATTRACT);
    over.classList.toggle('is-shown', mode === MODE.DEAD);
    score.classList.toggle('is-shown', mode === MODE.PLAY);
  }

  /* ═══ PHYSICS ══════════════════════════════════════════════════════════ */

  /* Where the marble will next cross the spring's line, folded through the
     walls. Used by the idle demo, and cheap enough to be worth the clarity. */
  function predictLanding() {
    var dy = PADY - CFG.BALL_R - ball.y;
    var disc = ball.vy * ball.vy + 2 * G * dy;
    if (disc < 0) return ball.x;
    var t = (-ball.vy + Math.sqrt(disc)) / G;
    if (!isFinite(t) || t < 0) return ball.x;
    return fold(ball.x + ball.vx * t, CFG.BALL_R, W - CFG.BALL_R);
  }

  function difficulty() {
    return clamp((clock - CFG.CALM) / (CFG.DIFF_END - CFG.CALM), 0, 1);
  }

  function step(dt) {
    var d = difficulty();

    /* ── Spring position ── */
    if (mode === MODE.ATTRACT) {
      pad.target = predictLanding();
      pad.x = approach(pad.x, pad.target, CFG.DEMO_TAU, dt);
    } else if (mode === MODE.PLAY) {
      if (usingKeys) {
        var dir = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
        pad.target = clamp(pad.target + dir * CFG.KEY_SPEED * dt,
                           CFG.PADDLE_HALF, W - CFG.PADDLE_HALF);
      }
      pad.x = approach(pad.x, pad.target, CFG.PADDLE_TAU, dt);
    }
    pad.x = clamp(pad.x, CFG.PADDLE_HALF, W - CFG.PADDLE_HALF);
    pad.recoil = approach(pad.recoil, 0, CFG.RECOIL_TAU, dt);
    ball.squash = approach(ball.squash, 0, CFG.SQUASH_TAU, dt);

    if (mode === MODE.DEAD) { deadFor += dt; return; }

    /* ── Flight ── */
    var prevY = ball.y;
    ball.vy += G * dt;
    ball.y += ball.vy * dt;
    ball.x += ball.vx * dt;
    ball.spin += ball.omega * dt;

    /* ── Walls ── */
    if (ball.x < CFG.BALL_R) { ball.x = CFG.BALL_R; ball.vx = Math.abs(ball.vx); ball.omega = ball.vx / CFG.BALL_R; }
    else if (ball.x > W - CFG.BALL_R) { ball.x = W - CFG.BALL_R; ball.vx = -Math.abs(ball.vx); ball.omega = ball.vx / CFG.BALL_R; }

    /* ── Spring contact ──
       Only on the way down, and only across the plane, so a marble already
       below the spring falls past instead of being caught from underneath.

       Detection runs against a plane that never moves, and deliberately not
       against the bowl drawn in drawSpring. The period is a whole number of
       substeps, so the marble returns to its launch height *exactly* — and a
       contact line that shifts with the marble's offset, even by a ten
       thousandth, can slip out from under a straddle test balanced that
       finely. It tunnels through a solid spring. A fixed plane cannot fail
       that way: the marble's descent is monotonic, so some substep always
       straddles it.

       Landing height is then snapped onto the bowl, which keeps the contact
       reading as curved without the physics depending on the curve. It also
       keeps the metronome honest — every catch launches from the same plane,
       so the pulse is identical wherever on the spring the marble lands. */
    var plane = PADY - CFG.BALL_R;
    if (ball.vy > 0 && prevY <= plane && ball.y >= plane) {
      var off = (ball.x - pad.x) / CFG.PADDLE_HALF;   // −1 .. 1 across the spring
      if (Math.abs(off) <= 1) {
        ball.y = plane - CFG.PADDLE_ARC * off * off;  // settle onto the bowl
        ball.vy = -LAUNCH;                            // fixed: the metronome

        var vmax = ramp(clock, CFG.CALM, CFG.DIFF_END, CFG.VX_MAX, CFG.VX_MAX_LATE);
        ball.vx = clamp(ball.vx * CFG.VX_KEEP + off * CFG.VX_ENGLISH, -vmax, vmax);
        if (Math.abs(ball.vx) < CFG.VX_MIN) {
          ball.vx = (ball.vx < 0 ? -1 : 1) * CFG.VX_MIN;
        }

        // Rolling condition: the spring's surface grips, so the marble leaves
        // spinning at the rate its sideways travel implies. Free flight can't
        // change that, which is why the spin reads as a memory of the contact.
        ball.omega = ball.vx / CFG.BALL_R;

        ball.squash = 1;
        pad.recoil = CFG.PADDLE_RECOIL;
        bounces++;
      }
    }

    if (ball.y > H + CFG.BALL_R * 3) {
      if (mode === MODE.PLAY) die(); else reset(MODE.ATTRACT);
    }

    if (mode === MODE.PLAY) clock += dt;

    /* ── Trace ── */
    trail.push({ x: ball.x, y: ball.y });
    if (trail.length > CFG.TRAIL_N) trail.shift();

    if (mode === MODE.PLAY) director(dt, d);
  }

  /* ═══ THE LENS ═════════════════════════════════════════════════════════
     Shots are chosen for what they take away. Holding on the spring loses the
     apex; holding on the apex loses the spring; holding mid-column leaves the
     marble only a flash on the way through. Each is a different gap in what
     the player knows, and none of them shows nothing at all. */

  function pickShot(d) {
    var r = Math.random();
    // Early runs stay on the spring, where the shadow still reads. The blinder
    // framings are earned.
    if (d < 0.30) return 'spring';
    if (d < 0.62) return r < 0.62 ? 'spring' : 'apex';
    return r < 0.44 ? 'spring' : (r < 0.80 ? 'apex' : 'mid');
  }

  function director(dt, d) {
    shotUntil -= dt;
    if (shotUntil <= 0) {
      if (resting) {
        shot = pickShot(d);
        shotUntil = ramp(d, 0, 1, CFG.SHOT_EARLY, CFG.SHOT_LATE);
        resting = false;
      } else {
        shot = null;
        shotUntil = ramp(d, 0, 1, CFG.REST_EARLY, CFG.REST_LATE);
        resting = true;
      }
    }

    var zoom = 1, ax = 50, ay = H / 2;
    if (shot) {
      zoom = ramp(d, 0, 1, CFG.ZOOM_EARLY, CFG.ZOOM_LATE);
      if (shot === 'spring')    { ax = pad.x;  ay = 0.80 * H; }
      else if (shot === 'apex') { ax = ball.x; ay = 0.28 * H; }
      else                      { ax = 50;     ay = 0.55 * H; }
    }

    // Keep the frame inside the column so a shot can never drift onto blank
    // paper — the crop should hide the marble, not the whole plate.
    var hw = W / (2 * zoom), hh = H / (2 * zoom);
    cam.tzoom = zoom;
    cam.tx = clamp(ax, hw, W - hw);
    cam.ty = clamp(ay, hh, H - hh);
    cam.tau = ramp(d, 0, 1, CFG.EASE_EARLY, CFG.EASE_LATE);
  }

  function moveCamera(dt) {
    cam.x = approach(cam.x, cam.tx, cam.tau, dt);
    cam.y = approach(cam.y, cam.ty, cam.tau, dt);
    // Zoom is eased in log space; interpolated linearly it appears to lurch.
    var lz = approach(Math.log(cam.zoom), Math.log(cam.tzoom), cam.tau, dt);
    cam.zoom = Math.exp(lz);
  }

  /* ═══ RENDER ═══════════════════════════════════════════════════════════ */

  function hex(c, a) {
    // Only ever called with the three CFG inks, all #rrggbb.
    var r = parseInt(c.slice(1, 3), 16),
        g = parseInt(c.slice(3, 5), 16),
        b = parseInt(c.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function draw() {
    if (!cw || !ch) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CFG.PAPER;
    ctx.fillRect(0, 0, cw, ch);

    // World → canvas. Line widths are given in world units from here on, so
    // everything thickens under the lens the way an engraving would.
    var s = cam.zoom * cw / W;
    ctx.setTransform(s, 0, 0, s, cw / 2 - cam.x * s, ch / 2 - cam.y * s);

    var px = 1 / s;   // one device pixel, in world units

    drawStrata();
    drawScale(px);
    drawTrail();
    drawShadow();
    drawSpring(px);
    drawMarble(px);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawVignette();
  }

  /* Bedding planes. They exist to give the eye something to hold onto when
     the lens is close — without them a zoomed frame is featureless paper. */
  function drawStrata() {
    for (var i = 0; i < strata.length - 1; i++) {
      var a = strata[i], b = strata[i + 1];
      ctx.beginPath();
      ctx.moveTo(0, a.at * H);
      var x;
      for (x = 0; x <= W; x += 5) {
        ctx.lineTo(x, (a.at + Math.sin(x / W * a.freq * Math.PI + a.phase) * a.amp) * H);
      }
      for (x = W; x >= 0; x -= 5) {
        ctx.lineTo(x, (b.at + Math.sin(x / W * b.freq * Math.PI + b.phase) * b.amp) * H);
      }
      ctx.closePath();
      ctx.fillStyle = hex(CFG.INK, CFG.STRATA_ALPHA * a.tint);
      ctx.fill();
    }
  }

  /* A sounding scale down the left edge. It subdivides as the lens pushes in,
     holding the ticks a readable distance apart — so the scale never tells you
     the magnification outright, only that the column has been re-ruled finer
     than it was. */
  function drawScale(px) {
    var stepWorld = 20;
    while (stepWorld * cam.zoom > 34) stepWorld /= 2;
    while (stepWorld * cam.zoom < 9)  stepWorld *= 2;

    var top = cam.y - H / (2 * cam.zoom), bot = cam.y + H / (2 * cam.zoom);
    var first = Math.floor(top / stepWorld) * stepWorld;

    // The scale is apparatus, not specimen, so it is drawn in the sepia of a
    // ruled notebook rather than in the ink the marble and spring are given.
    ctx.lineWidth = px;
    ctx.strokeStyle = hex(CFG.SEPIA, CFG.SCALE_ALPHA);
    ctx.beginPath();
    for (var y = first; y <= bot + stepWorld; y += stepWorld) {
      var major = Math.abs(y % (stepWorld * 5)) < 0.001;
      ctx.moveTo(0, y);
      ctx.lineTo(major ? 6 : 3, y);
    }
    ctx.stroke();
  }

  /* The path already travelled, plotted rather than smeared — a figure in a
     notebook, not a motion blur. It is cropped by the lens like everything
     else, so it never leaks information the framing meant to withhold. */
  function drawTrail() {
    for (var i = 0; i < trail.length; i++) {
      var t = i / trail.length;
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, CFG.BALL_R * 0.16 * t, 0, Math.PI * 2);
      ctx.fillStyle = hex(CFG.INK, 0.20 * t * t);
      ctx.fill();
    }
  }

  /* The marble throws a shadow onto the spring as it comes down. This is the
     reason a frame that hides the marble is still playable: the trace arrives
     before the thing does. Tightening SHADOW_RANGE late in a run is the
     cleanest way to make the closing minutes bite. */
  function drawShadow() {
    var range = ramp(clock, CFG.CALM, CFG.DIFF_END,
                     CFG.SHADOW_RANGE, CFG.SHADOW_RANGE_LATE);
    var gap = PADY - ball.y;
    if (gap < 0 || gap > range) return;

    var near = 1 - gap / range;                 // 0 far, 1 touching
    var rx = CFG.BALL_R * (1.55 - 0.55 * near);
    ctx.beginPath();
    ctx.ellipse(ball.x, PADY + pad.recoil * 0.35, rx, rx * 0.30, 0, 0, Math.PI * 2);
    ctx.fillStyle = hex(CFG.INK, 0.06 + 0.20 * near * near);
    ctx.fill();
  }

  /* The spring: a shallow arc that dips on contact and springs back. Hatching
     underneath gives it a drawn weight rather than a UI-bar flatness. */
  function drawSpring(px) {
    var y = PADY + pad.recoil;
    var L = pad.x - CFG.PADDLE_HALF, R = pad.x + CFG.PADDLE_HALF;
    // Contact flattens the arc — the dip and the straightening read as one move.
    var sag = CFG.PADDLE_ARC + pad.recoil * 0.5;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(L, y - sag);
    ctx.quadraticCurveTo(pad.x, y + sag, R, y - sag);
    ctx.lineWidth = CFG.PADDLE_THICK;
    ctx.strokeStyle = hex(CFG.INK, 0.92);
    ctx.stroke();

    ctx.beginPath();
    for (var i = 1; i <= 5; i++) {
      var t = i / 6;
      var hx = L + (R - L) * t;
      var hy = (1 - t) * (1 - t) * (y - sag) + 2 * (1 - t) * t * (y + sag) + t * t * (y - sag);
      ctx.moveTo(hx, hy + CFG.PADDLE_THICK * 0.7);
      ctx.lineTo(hx - 1.1, hy + CFG.PADDLE_THICK * 0.7 + 2.6);
    }
    ctx.lineWidth = px * 1.2;
    ctx.strokeStyle = hex(CFG.INK, 0.34);
    ctx.stroke();
  }

  /* The marble, as an engraved sphere: a body, a lit side, a specular point,
     and two surface marks carried around by the spin. The marks are what sell
     the rotation — a smooth ball in flight looks like a dot sliding. */
  function drawMarble(px) {
    var r = CFG.BALL_R;
    var sq = ball.squash * CFG.SQUASH;

    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.scale(1 + sq, 1 - sq);   // flattens against the spring, then recovers

    var g = ctx.createRadialGradient(-r * 0.34, -r * 0.40, r * 0.08, 0, 0, r);
    g.addColorStop(0, hex(CFG.INK, 0.62));
    g.addColorStop(0.55, hex(CFG.INK, 0.90));
    g.addColorStop(1, hex(CFG.INK, 1));
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // Marks placed on the equator and projected: horizontal squash by the
    // cosine, hidden entirely once they rotate around the back.
    for (var i = 0; i < 2; i++) {
      var phi = ball.spin + i * Math.PI * 0.72;
      var depth = Math.cos(phi);
      if (depth <= 0.06) continue;
      var mx = Math.sin(phi) * r * 0.60;
      var my = (i === 0 ? -0.16 : 0.30) * r;
      ctx.save();
      ctx.translate(mx, my);
      ctx.scale(depth, 1);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.20, 0, Math.PI * 2);
      ctx.fillStyle = hex(CFG.PAPER, 0.30 * depth);
      ctx.fill();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(-r * 0.36, -r * 0.40, r * 0.19, 0, Math.PI * 2);
    ctx.fillStyle = hex(CFG.PAPER, 0.80);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, r - px * 0.5, 0, Math.PI * 2);
    ctx.lineWidth = px;
    ctx.strokeStyle = hex(CFG.INK, 0.55);
    ctx.stroke();

    ctx.restore();
  }

  /* The field narrows as the lens pushes in — the cost of looking closely,
     made visible at the edges of the frame. */
  function drawVignette() {
    var d = clamp((cam.zoom - 1) / (CFG.ZOOM_LATE - 1), 0, 1);
    if (d < 0.01) return;
    var g = ctx.createRadialGradient(
      cw / 2, ch / 2, Math.min(cw, ch) * 0.30,
      cw / 2, ch / 2, Math.max(cw, ch) * 0.62);
    g.addColorStop(0, hex(CFG.INK, 0));
    g.addColorStop(1, hex(CFG.INK, CFG.VIGNETTE_MAX * d));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  }

  /* ═══ INPUT ════════════════════════════════════════════════════════════
     The pointer is read in world coordinates through a band wider than the
     column, so the lens never changes how the spring answers the hand. */

  function pointerToWorld(clientX) {
    var r = pane.getBoundingClientRect();
    var mid = r.left + r.width / 2;
    var band = r.width * CFG.CONTROL_GAIN;
    return clamp(50 + (clientX - mid) / band * W,
                 CFG.PADDLE_HALF, W - CFG.PADDLE_HALF);
  }

  // Tracked on the document: the column is narrow enough that demanding the
  // pointer stay inside it would be its own difficulty.
  document.addEventListener('pointermove', function (e) {
    if (mode !== MODE.PLAY) return;
    usingKeys = false;
    pad.target = pointerToWorld(e.clientX);
  }, { passive: true });

  pane.addEventListener('pointerdown', function (e) {
    pane.focus({ preventScroll: true });
    if (mode === MODE.PLAY) return;
    if (mode === MODE.DEAD && deadFor < 0.45) return;   // swallow the death click
    usingKeys = false;
    pad.target = pointerToWorld(e.clientX);
    startPlay();
  });

  pane.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft'  || e.key === 'a') { keyLeft = true;  usingKeys = true; }
    else if (e.key === 'ArrowRight' || e.key === 'd') { keyRight = true; usingKeys = true; }
    else if (e.key === 'Enter' || e.key === ' ') { usingKeys = true; }
    else return;
    e.preventDefault();
    if (mode !== MODE.PLAY) { pad.target = pad.x; startPlay(); }
  });

  pane.addEventListener('keyup', function (e) {
    if (e.key === 'ArrowLeft'  || e.key === 'a') keyLeft = false;
    if (e.key === 'ArrowRight' || e.key === 'd') keyRight = false;
  });

  /* ═══ LOOP ═════════════════════════════════════════════════════════════ */

  /* `allowed` is the master gate. Reduced motion clears it so that nothing —
     not the resize observer, not the visibility handler — can quietly start a
     marble bouncing on a page that asked for stillness. */
  var FIXED = 1 / 180, acc = 0, last = 0, running = false, allowed = true;

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);

    var dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) return;
    if (dt > 0.25) dt = 0.25;      // a backgrounded tab shouldn't fast-forward

    acc += dt;
    var steps = 0;
    while (acc >= FIXED && steps < 8) { step(FIXED); acc -= FIXED; steps++; }
    if (steps === 8) acc = 0;

    moveCamera(dt);

    if (mode === MODE.PLAY) {
      score.textContent = bounces;
    } else if (mode === MODE.DEAD && deadFor > CFG.DEAD_HOLD) {
      reset(MODE.ATTRACT);
    }

    draw();
  }

  function start() {
    if (running || !allowed || !cw || !ch) return;
    running = true;
    last = performance.now();
    acc = 0;
    requestAnimationFrame(frame);
  }

  function stop() { running = false; }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  // A pane collapsed to nothing — the mobile breakpoint hides it — has no
  // reason to be running a physics loop.
  var ro = new ResizeObserver(function () {
    resize();
    if (cw && ch) { start(); } else { stop(); }
  });
  ro.observe(pane);

  resize();
  reset(MODE.ATTRACT);

  /* Reduced motion gets a still plate — a marble resting in the spring —
     rather than one that never stops moving. The game stays entirely
     available; it just waits to be asked, and the ordinary pointerdown
     handler above is what asks. */
  if (reduceMotion) {
    allowed = false;
    ball.x = pad.x;
    ball.y = PADY - CFG.BALL_R;
    ball.vx = ball.vy = ball.omega = 0;
    trail.length = 0;
    draw();
    pane.addEventListener('pointerdown', function () {
      allowed = true;
      start();
    }, { once: true });
  } else {
    start();
  }
})();
