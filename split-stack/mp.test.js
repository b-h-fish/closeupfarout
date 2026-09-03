/* ── SPLIT STACK · the multiplayer rules ───────────────────────────────────
   Run with:  node split-stack/mp.test.js       (exits non-zero on a failure)

   Companion to rules.test.js, which covers the game itself. These cover the
   things a shared board adds: who is allowed to act, what a call is worth,
   and that nothing is paid beyond the calls themselves.

   Turn enforcement is tested here rather than trusted to the server on
   purpose. Because it lives in `legal`, a replayed log rejects an out-of-turn
   action exactly as a live game does — so if these drift, a late joiner
   rebuilding from the log would land on a different board from everyone else,
   and nothing on screen would say so.
   ──────────────────────────────────────────────────────────────────────── */

const H = require('./game.js');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}

/* Find a pile whose showing card gives the call we want to land, so a test
   asserts about scoring rather than about luck. */
function pileWhere(state, want) {
  const card = state.deck[state.next];
  for (let i = 0; i < state.size; i++) {
    if (!state.piles[i].alive) continue;
    const showing = H.top(state, i);
    const ov = H.value(showing), nv = H.value(card);
    if (want === 'SPLIT' && ov === nv) return i;
    if (want === 'HI'    && nv > ov)   return i;
    if (want === 'LO'    && nv < ov)   return i;
    if (want === 'SUIT'  && (card / 13 | 0) === (showing / 13 | 0) && ov !== nv) return i;
    if (want === 'KILL'  && nv < ov)   return i;   // caller will say HI
  }
  return -1;
}
/* Deal until a seed offers the situation a test needs. */
function dealFor(want, players) {
  for (let seed = 1; seed < 4000; seed++) {
    const g = H.create(seed, 4, 4, players || 4);
    const i = pileWhere(g, want);
    if (i >= 0) return { g, i };
  }
  return null;
}

// ── authorship ──
let g = H.create(1234, 4, 4, 4);
ok('a fresh game starts on seat 0', g.turn === 0);
ok('every seat gets a scoreline', g.scores.length === 4);

const snap = JSON.stringify(g);
H.apply(g, { t: 'SELECT', pile: 0, by: 1 });
ok('an out-of-turn action changes nothing', JSON.stringify(g) === snap);
H.apply(g, { t: 'SELECT', pile: 0 });
ok('an unauthored action changes nothing', JSON.stringify(g) === snap);
ok('out-of-turn actions never reach the log', g.log.length === 0);

H.apply(g, { t: 'SELECT', pile: 0, by: 0 });
ok('the seat whose turn it is may select', g.selected === 0);
ok('selecting does not pass the turn', g.turn === 0);

// ── the turn passes on the call, not the pick ──
g = H.create(1234, 4, 4, 4);
H.apply(g, { t: 'SELECT', pile: 0, by: 0 });
H.apply(g, { t: 'SELECT', pile: 1, by: 0 });
ok('a seat may change its mind before calling', g.selected === 1);
H.apply(g, { t: 'CALL', call: 'HI', by: 0 });
ok('the turn passes after a call', g.turn === 1 || g.phase === 'RESURRECT');

// ── solo is untouched ──
let solo = H.create(1234, 3, 3, 1);
H.apply(solo, { t: 'SELECT', pile: 0 });
ok('solo needs no author', solo.selected === 0);
const soloSnap = JSON.stringify(solo);
H.apply(solo, { t: 'CALL', call: 'SUIT' });
ok('SUIT is not a solo call', JSON.stringify(solo) === soloSnap);
ok('solo scores stay at zero', solo.scores[0].score === 0);

// ── what a call is worth ──
let d = dealFor('HI');
H.apply(d.g, { t: 'SELECT', pile: d.i, by: 0 });
H.apply(d.g, { t: 'CALL', call: 'HI', by: 0 });
ok('a placement is worth +1', d.g.scores[0].score === 1, 'got ' + d.g.scores[0].score);
ok('a placement is counted', d.g.scores[0].placements === 1);

d = dealFor('SUIT');
H.apply(d.g, { t: 'SELECT', pile: d.i, by: 0 });
H.apply(d.g, { t: 'CALL', call: 'SUIT', by: 0 });
ok('a suit call is worth +3', d.g.scores[0].score === H.PAYS.SUIT, 'got ' + d.g.scores[0].score);
ok('the suit payout is three', H.PAYS.SUIT === 3);
ok('the pile survives a made suit', d.g.piles[d.i].alive);

d = dealFor('SPLIT');
H.apply(d.g, { t: 'SELECT', pile: d.i, by: 0 });
H.apply(d.g, { t: 'CALL', call: 'SPLIT', by: 0 });
ok('a split is worth +4', d.g.scores[0].score === 4, 'got ' + d.g.scores[0].score);

d = dealFor('KILL');
H.apply(d.g, { t: 'SELECT', pile: d.i, by: 0 });
H.apply(d.g, { t: 'CALL', call: 'HI', by: 0 });   // deliberately the wrong way
ok('a kill is worth -2', d.g.scores[0].score === -2, 'got ' + d.g.scores[0].score);
ok('a kill is counted', d.g.scores[0].kills === 1);
ok('scores go negative rather than flooring', d.g.scores[0].score < 0);

// ── a failed suit kills, like any other call ──
(function () {
  for (let seed = 1; seed < 4000; seed++) {
    const t = H.create(seed, 4, 4, 4);
    const card = t.deck[t.next];
    for (let i = 0; i < t.size; i++) {
      const showing = H.top(t, i);
      if ((card / 13 | 0) === (showing / 13 | 0)) continue;   // want a MISS
      H.apply(t, { t: 'SELECT', pile: i, by: 0 });
      H.apply(t, { t: 'CALL', call: 'SUIT', by: 0 });
      ok('a failed suit kills the pile', !t.piles[i].alive);
      ok('a failed suit costs -2', t.scores[0].score === -2, 'got ' + t.scores[0].score);
      return;
    }
  }
  ok('a failed suit kills the pile', false, 'no deal found');
})();

// ── the splitter keeps the turn through the revive ──
(function () {
  for (let seed = 1; seed < 6000; seed++) {
    const t = H.create(seed, 4, 4, 4);
    // kill one pile on seat 0 so a later split has something to buy back
    const k = pileWhere(t, 'KILL');
    if (k < 0) continue;
    H.apply(t, { t: 'SELECT', pile: k, by: 0 });
    H.apply(t, { t: 'CALL', call: 'HI', by: 0 });
    if (H.deadCount(t) !== 1) continue;
    // walk seats forward until someone can split
    for (let step = 0; step < 40 && t.phase === 'PLAY'; step++) {
      const seat = t.turn;
      const sp = pileWhere(t, 'SPLIT');
      if (sp >= 0) {
        H.apply(t, { t: 'SELECT', pile: sp, by: seat });
        H.apply(t, { t: 'CALL', call: 'SPLIT', by: seat });
        if (t.phase !== 'RESURRECT') break;
        ok('a split holds the board for its author', t.turn === seat);
        const other = (seat + 1) % 4;
        const rs = JSON.stringify(t);
        H.apply(t, { t: 'REVIVE', pile: k, by: other });
        ok('another seat cannot take the revive', JSON.stringify(t) === rs);
        H.apply(t, { t: 'REVIVE', pile: k, by: seat });
        ok('the splitter revives', t.piles[k].alive && t.phase !== 'RESURRECT');
        ok('the turn passes after the revive', t.turn === (seat + 1) % 4);
        return;
      }
      const any = pileWhere(t, 'HI');
      if (any < 0) break;
      H.apply(t, { t: 'SELECT', pile: any, by: seat });
      H.apply(t, { t: 'CALL', call: 'HI', by: seat });
    }
  }
  ok('a split holds the board for its author', false, 'no deal found');
})();

/* A seat's score is the sum of what it called and nothing else. There used
   to be a board-clear bonus that paid a seat's placements and suits a second
   time; it is gone, and this is what says so. Asserted off PAYS rather than
   off literals, so the check follows the table if a call is ever repriced. */
function earned(s) {
  return s.placements * H.PAYS.PLACE + s.suits * H.PAYS.SUIT +
         s.splits * H.PAYS.SPLIT + s.kills * H.PAYS.KILL;
}

// ── clearing the board pays nothing extra ──
(function () {
  const t = H.create(1234, 4, 4, 4);
  let guard = 0;
  while (t.phase === 'PLAY' && guard++ < 200) {
    const seat = t.turn;
    let i = pileWhere(t, 'HI');
    if (i < 0) i = pileWhere(t, 'LO');
    if (i < 0) { i = 0; while (i < t.size && !t.piles[i].alive) i++; }
    if (i >= t.size) break;
    H.apply(t, { t: 'SELECT', pile: i, by: seat });
    H.apply(t, { t: 'CALL', call: H.value(t.deck[t.next]) > H.value(H.top(t, i)) ? 'HI' : 'LO', by: seat });
    if (t.phase === 'RESURRECT') {
      let dead = 0; while (dead < t.size && t.piles[dead].alive) dead++;
      H.apply(t, { t: 'REVIVE', pile: dead, by: t.turn });
    }
  }
  if (t.phase === 'WON') {
    let scored = 0;
    for (let i = 0; i < 4; i++) {
      ok('seat ' + i + ' is paid its calls and no more',
         t.scores[i].score === earned(t.scores[i]),
         'score ' + t.scores[i].score + ' vs calls ' + earned(t.scores[i]));
      if (t.scores[i].score !== 0) scored = 1;
    }
    /* Without this the check above passes on a game where nobody called
       anything, which is exactly the game it cannot speak for. */
    ok('somebody actually scored in it', scored === 1);
    ok('no seat carries a bonus field any more',
       t.scores.every(s => s.bonus === undefined), JSON.stringify(t.scores[0]));
  } else {
    ok('the cleared-board game reached WON', false, 'ended ' + t.phase);
  }
})();

// ── and neither does losing it ──
(function () {
  const t = H.create(1234, 2, 2, 4);
  let guard = 0;
  while (t.phase === 'PLAY' && guard++ < 200) {
    const seat = t.turn;
    let i = 0; while (i < t.size && !t.piles[i].alive) i++;
    if (i >= t.size) break;
    H.apply(t, { t: 'SELECT', pile: i, by: seat });
    // always call against the card, to lose piles quickly
    H.apply(t, { t: 'CALL', call: H.value(t.deck[t.next]) > H.value(H.top(t, i)) ? 'LO' : 'HI', by: seat });
    if (t.phase === 'RESURRECT') {
      let dead = 0; while (dead < t.size && t.piles[dead].alive) dead++;
      H.apply(t, { t: 'REVIVE', pile: dead, by: t.turn });
    }
  }
  ok('a finished board is still only worth its calls',
     t.scores.every(s => s.score === earned(s)),
     'phase ' + t.phase + ' ' + JSON.stringify(t.scores));
})();

// ── standings ──
(function () {
  const t = H.create(1234, 4, 4, 4);
  t.scores[0].score = 5;  t.scores[0].kills = 3;
  t.scores[1].score = 9;  t.scores[1].kills = 2;
  t.scores[2].score = 9;  t.scores[2].kills = 1;
  t.scores[3].score = -4; t.scores[3].kills = 6;
  const st = H.standings(t);
  ok('the highest score leads', st[0].player === 2);
  ok('fewest kills breaks a tie', st[0].kills === 1 && st[1].player === 1);
  ok('a negative score sorts last', st[3].player === 3);
  ok('a broken tie is not marked tied', !st[0].tied);

  t.scores[1].kills = 1;                    // now a genuine dead heat
  const st2 = H.standings(t);
  ok('a genuine tie is marked', st2[0].tied && st2[1].tied);
})();

// ── replay ──
(function () {
  const live = H.create(4242, 4, 4, 4);
  let guard = 0;
  while (live.phase === 'PLAY' && guard++ < 30) {
    const seat = live.turn;
    let i = 0; while (i < live.size && !live.piles[i].alive) i++;
    if (i >= live.size) break;
    H.apply(live, { t: 'SELECT', pile: i, by: seat });
    H.apply(live, { t: 'CALL', call: 'HI', by: seat });
    if (live.phase === 'RESURRECT') {
      let dead = 0; while (dead < live.size && live.piles[dead].alive) dead++;
      H.apply(live, { t: 'REVIVE', pile: dead, by: live.turn });
    }
  }
  const rebuilt = H.replay(4242, 4, 4, 4, live.log);
  ok('a replayed game matches the board',
     JSON.stringify(rebuilt.piles) === JSON.stringify(live.piles));
  ok('a replayed game matches the scores',
     JSON.stringify(rebuilt.scores) === JSON.stringify(live.scores));
  ok('a replayed game matches the turn', rebuilt.turn === live.turn);

  /* The point of enforcing turns in `legal` rather than in the server: a log
     with a forged author rebuilds to the same board, because the forged
     action is refused on the way back in too. */
  const forged = live.log.slice();
  forged.splice(1, 0, { t: 'SELECT', pile: 3, by: (live.log[0].by + 1) % 4 });
  const afterForgery = H.replay(4242, 4, 4, 4, forged);
  ok('a forged action is refused on replay',
     JSON.stringify(afterForgery.piles) === JSON.stringify(live.piles));
})();

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
