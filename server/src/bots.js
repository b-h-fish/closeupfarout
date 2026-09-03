/* ── SPLIT STACK · the house players ───────────────────────────────────────
   Nobody should sit in an empty queue at four in the morning. If thirty
   seconds pass without a table forming, the rest of the seats are filled
   here, and the game is the four-handed game the rules were tuned for.

   They are not labelled in the room. That is the point of them — a table
   that announces three of its players are software is a table nobody sits
   at. What they are *not* is hidden from the server: meta.bots records how
   many seats were filled this way, so when leaderboards arrive they can
   decline to count a game that was mostly house.

   Two rules make them read as people rather than as software:

     They do not see the stock. The whole deck is in memory a property away,
     and a bot that reads it is not a strong opponent, it is a cheat. These
     count what is face up on the board, exactly what a person at the table
     can count, and are wrong whenever the cards are genuinely unknowable.

     They are wrong on purpose besides. A player who never misjudges a
     marginal call is the tell; the error rate is what sells it. They also
     reach for Suit more often than the odds justify, which is the mistake a
     person makes when three points is sitting there.
   ──────────────────────────────────────────────────────────────────────── */

import HiLo from '../../split-stack/game.js';

/* Handles, not names — nobody at a card table online is called Player 2.
   Kept inside the twelve the room slices to, and free of the confusable
   characters room codes already avoid. */
const NAMES = [
  'MARLO', 'PIP', 'SUNNY', 'VESPER', 'DUKE', 'RENO', 'CLEO', 'AUGUST',
  'NIKO', 'WREN', 'HALCYON', 'JUNO', 'OSCAR', 'MAVIS', 'TEDDY', 'ROSA',
  'FELIX', 'IRIS', 'BASIL', 'NELL', 'ORSON', 'MABEL', 'GUS', 'LOTTIE'
];

/* Cards are 0-51: rank is the remainder, suit the quotient. game.js keeps
   these to itself, and two lines of arithmetic here is cheaper than widening
   its surface for the sake of the opposition. */
const rankOf = (c) => c % 13;
const suitOf = (c) => (c / 13) | 0;

const pick = (a) => a[(Math.random() * a.length) | 0];

/* Every card lying face up. Deliberately built from the piles and never from
   state.deck — see above. */
function seen(state) {
  const out = new Set();
  for (const p of state.piles) for (const c of p.cards) out.add(c);
  return out;
}

/* What each call is worth on this pile, given only what is showing. Returns
   the calls sorted best first, each with the chance it lands and what it is
   worth in points on average. */
function weigh(state, showing) {
  const known = seen(state);
  const oldV = HiLo.value(showing);
  const oldS = suitOf(showing);
  let hi = 0, lo = 0, same = 0, suited = 0, n = 0;

  for (let c = 0; c < 52; c++) {
    if (known.has(c)) continue;
    n++;
    const v = HiLo.value(c);
    if (v > oldV) hi++; else if (v < oldV) lo++; else same++;
    if (suitOf(c) === oldS) suited++;
  }
  if (!n) return [];

  const P = HiLo.PAYS;
  /* A made Split also buys a dead pile back, which is worth more the more of
     the board is down. Nothing else on this list changes the shape of the
     game, so nothing else gets a bonus. */
  const revive = HiLo.deadCount(state) > 0 ? 1.5 : 0;
  const ev = (p, pay) => p * pay + (1 - p) * P.KILL;

  return [
    { call: 'HI',    p: hi / n,     ev: ev(hi / n, P.PLACE) },
    { call: 'LO',    p: lo / n,     ev: ev(lo / n, P.PLACE) },
    { call: 'SUIT',  p: suited / n, ev: ev(suited / n, P.SUIT) },
    { call: 'SPLIT', p: same / n,   ev: ev(same / n, P.SPLIT + revive) }
  ].sort((a, b) => b.ev - a.ev);
}

const ERROR_RATE = 0.15;   // one call in six or so, misjudged
const SUIT_GREED = 0.12;   // and the occasional reach for three points

function chooseCall(state, showing) {
  const ranked = weigh(state, showing);
  if (!ranked.length) return 'HI';

  /* The greedy Suit comes first, because it is a particular mistake rather
     than a random one: a person takes the three points when the suit looks
     live, not when they have stopped paying attention. */
  const suit = ranked.find((r) => r.call === 'SUIT');
  if (suit && suit.p > 0.18 && Math.random() < SUIT_GREED) return 'SUIT';

  if (Math.random() < ERROR_RATE) {
    const rest = ranked.slice(1);
    if (rest.length) return pick(rest).call;
  }
  return ranked[0].call;
}

/* The pile a bot would rather play: the one whose best call is worth most.
   A misread here is the same misread as a bad call, so the error rate is not
   applied twice — it lands on the call, where a person would notice it. */
function choosePile(state) {
  let best = -1, bestEv = -Infinity;
  for (let i = 0; i < state.size; i++) {
    if (!state.piles[i].alive) continue;
    const ranked = weigh(state, HiLo.top(state, i));
    const ev = ranked.length ? ranked[0].ev : -Infinity;
    if (ev > bestEv) { bestEv = ev; best = i; }
  }
  return best;
}

/* Which pile to bring back. The extremes are worth most: a board showing a
   two can be called high with near certainty, and so can an ace called low.
   A seven is the pile nobody wants. */
function chooseRevive(state) {
  let best = -1, bestEdge = -1;
  for (let i = 0; i < state.size; i++) {
    if (state.piles[i].alive) continue;
    const v = HiLo.value(HiLo.top(state, i));
    const edge = Math.abs(v - 8);
    if (edge > bestEdge) { bestEdge = edge; best = i; }
  }
  return best;
}

/* The whole of a bot's turn, as actions the room can commit through the same
   path a person's arrive by. Nothing here touches state directly: a bot that
   could reach past legal() would be a second set of rules. */
export function botTurn(state, seat) {
  if (state.phase === 'RESURRECT') {
    const pile = chooseRevive(state);
    return pile < 0 ? [] : [{ t: 'REVIVE', pile, by: seat }];
  }
  if (state.phase !== 'PLAY') return [];

  const out = [];
  let showing;
  if (state.selected < 0) {
    const pile = choosePile(state);
    if (pile < 0) return out;
    out.push({ t: 'SELECT', pile, by: seat });
    showing = HiLo.top(state, pile);
  } else {
    showing = HiLo.top(state, state.selected);
  }
  out.push({ t: 'CALL', call: chooseCall(state, showing), by: seat });
  return out;
}

/* How long to think. Instant is the loudest tell there is, and a constant
   delay is the second loudest. */
export function botDelay() {
  return 1500 + Math.floor(Math.random() * 2500);
}

/* Distinct handles that do not collide with anybody already at the table. */
export function botNames(n, taken) {
  const used = new Set((taken || []).map((s) => String(s).toUpperCase()));
  const pool = NAMES.filter((x) => !used.has(x));
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
  }
  while (out.length < n) out.push('GUEST' + (out.length + 1));
  return out;
}

/* A seat token that looks like every other seat token. */
export function botId() {
  const r = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const BOT_FULL = 4;
