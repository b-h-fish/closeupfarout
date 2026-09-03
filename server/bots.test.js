/* ── SPLIT STACK · the house players ───────────────────────────────────────
   Run with:  node server/bots.test.js      (no wrangler; pure functions)

   The claim that matters here is not "the bots play well". It is that they
   play by the same rules everyone else does and cannot see the stock. The
   whole deck is one property away from them, and nothing in a live game
   would ever reveal that they had read it — they would simply be uncanny.
   So that is tested directly, by shuffling the cards they must not know
   about and insisting their answer does not change.
   ──────────────────────────────────────────────────────────────────────── */

import HiLo from '../split-stack/game.js';
import { botTurn, botDelay, botNames } from './src/bots.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}

/* Math.random is the only thing a bot decides with beyond the board, so
   pinning it is what makes two calls comparable. */
const realRandom = Math.random;
function seedRandom(seed) {
  let s = seed >>> 0;
  Math.random = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const restore = () => { Math.random = realRandom; };

// ── they finish games, legally ──
let finished = 0, illegal = 0, longest = 0;
for (let n = 0; n < 300; n++) {
  const g = HiLo.create(1000 + n, 4, 4, 4);
  let steps = 0;
  while (g.phase !== 'WON' && g.phase !== 'LOST' && steps < 400) {
    const moves = botTurn(g, g.turn);
    if (!moves.length) break;
    for (const a of moves) {
      if (!HiLo.legal(g, a)) { illegal++; }
      HiLo.apply(g, a);
    }
    steps++;
  }
  longest = Math.max(longest, steps);
  if (g.phase === 'WON' || g.phase === 'LOST') finished++;
}
ok('every action a bot offers is legal', illegal === 0, 'illegal ' + illegal);
ok('300 all-bot games all reach an ending', finished === 300, 'finished ' + finished);
ok('and none of them runs away', longest < 400, 'longest ' + longest);

/* ── they cannot see the stock ──
   Play a game part-way, then reshuffle every card that has not been dealt.
   Nothing a player can observe has changed, so nothing a bot decides may
   change either. A bot reading state.deck fails this immediately. */
let peeked = 0, compared = 0;
for (let n = 0; n < 200; n++) {
  const g = HiLo.create(7000 + n, 4, 4, 4);
  seedRandom(99);
  for (let k = 0; k < 6 && g.phase === 'PLAY'; k++) {
    for (const a of botTurn(g, g.turn)) HiLo.apply(g, a);
  }
  restore();
  if (g.phase !== 'PLAY') continue;

  seedRandom(4242);
  const before = JSON.stringify(botTurn(g, g.turn));
  restore();

  // reshuffle only the undealt tail — the part nobody at the table can see
  const tail = g.deck.slice(g.next);
  for (let i = tail.length - 1; i > 0; i--) {
    const j = (realRandom() * (i + 1)) | 0;
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  for (let i = 0; i < tail.length; i++) g.deck[g.next + i] = tail[i];

  seedRandom(4242);
  const after = JSON.stringify(botTurn(g, g.turn));
  restore();

  compared++;
  if (before !== after) peeked++;
}
ok('a bot is unmoved by cards it cannot see', peeked === 0,
   peeked + ' of ' + compared + ' decisions changed');
ok('the anti-peek check actually ran', compared > 100, 'compared ' + compared);

/* ── they count, but not perfectly ──
   Against a bot that calls at random the counter should be clearly ahead;
   if it were not, "counts the deck" would be a comment rather than a fact. */
function randomCall(state) {
  const calls = ['HI', 'LO', 'SUIT', 'SPLIT'];
  const out = [];
  if (state.selected < 0) {
    const alive = [];
    for (let i = 0; i < state.size; i++) if (state.piles[i].alive) alive.push(i);
    if (!alive.length) return [];
    out.push({ t: 'SELECT', pile: alive[(realRandom() * alive.length) | 0], by: state.turn });
  }
  out.push({ t: 'CALL', call: calls[(realRandom() * 4) | 0], by: state.turn });
  return out;
}

let counterPts = 0, randomPts = 0;
for (let n = 0; n < 400; n++) {
  const g = HiLo.create(31000 + n, 4, 4, 2);   // seat 0 counts, seat 1 guesses
  let steps = 0;
  while (g.phase !== 'WON' && g.phase !== 'LOST' && steps < 400) {
    let moves;
    if (g.phase === 'RESURRECT') moves = botTurn(g, g.turn);
    else moves = g.turn === 0 ? botTurn(g, 0) : randomCall(g);
    if (!moves.length) break;
    for (const a of moves) HiLo.apply(g, a);
    steps++;
  }
  counterPts += g.scores[0].score;
  randomPts += g.scores[1].score;
}
ok('counting beats guessing over 400 games', counterPts > randomPts,
   'counter ' + counterPts + ' vs random ' + randomPts);

/* But not by so much that it stops being beatable — a bot that never
   misjudges a marginal call is the tell. */
let errorful = 0, calls = 0;
for (let n = 0; n < 300; n++) {
  const g = HiLo.create(51000 + n, 4, 4, 4);
  let steps = 0;
  while (g.phase !== 'WON' && g.phase !== 'LOST' && steps < 200) {
    const moves = botTurn(g, g.turn);
    if (!moves.length) break;
    const call = moves.find(m => m.t === 'CALL');
    if (call && g.selected >= 0) { /* counted below after apply */ }
    for (const a of moves) HiLo.apply(g, a);
    if (g.last && g.last.call) { calls++; if (!g.last.survived) errorful++; }
    steps++;
  }
}
const killRate = errorful / calls;
ok('bots lose piles at a human sort of rate', killRate > 0.15 && killRate < 0.6,
   'kill rate ' + killRate.toFixed(3) + ' over ' + calls + ' calls');

// ── the disguise ──
const names = botNames(3, ['MARLO', 'PIP']);
ok('handles are distinct', new Set(names).size === 3, names.join(','));
ok('handles avoid the people already seated',
   !names.includes('MARLO') && !names.includes('PIP'), names.join(','));
ok('handles fit the twelve a room keeps', names.every(n => n.length <= 12), names.join(','));
const big = botNames(40, []);
ok('asking for more handles than exist still returns that many', big.length === 40);
ok('and they are still distinct', new Set(big).size === 40);

const delays = Array.from({ length: 200 }, botDelay);
ok('nobody answers instantly', Math.min(...delays) >= 1500, 'min ' + Math.min(...delays));
ok('and nobody sits there forever', Math.max(...delays) <= 4000, 'max ' + Math.max(...delays));
ok('the pause varies', new Set(delays).size > 50, 'distinct ' + new Set(delays).size);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
