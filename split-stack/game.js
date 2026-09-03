/* ── SPLIT · rules ────────────────────────────────────────────────────────
   Pure and deterministic. No DOM, no rendering, no timers. A whole game is
   reconstructible from (seed, cols, rows) plus the action log, which is what
   will let a live game between friends sync by replaying actions rather than
   shipping board snapshots.

   The deck is shuffled once and never touched again — the card you are about
   to receive is the same whichever pile you choose, so the only decision that
   matters is which showing card gives you the best odds against it.
   ──────────────────────────────────────────────────────────────────────── */

var HiLo = (function () {
  'use strict';

  /* Ace plays high: 2=2 … K=13, A=14. This is the single place the ranking is
     defined; flip it to put the ace at the bottom instead. */
  var ACE_LOW = false;

  var RANKS = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
  var SUITS = ['S','H','D','C'];

  function rankOf(card) { return card % 13; }
  function suitOf(card) { return (card / 13) | 0; }
  function rankChar(card) { return RANKS[rankOf(card)]; }
  function suitChar(card) { return SUITS[suitOf(card)]; }

  /* Comparison value. Only rank counts — suits never break a tie, which is
     what makes an exact match a Split rather than a near miss. */
  function value(card) {
    var r = rankOf(card);
    if (ACE_LOW) return r + 1;
    return r === 0 ? 14 : r + 1;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffled(seed) {
    var rnd = mulberry32(seed), d = [], i, j, t;
    for (i = 0; i < 52; i++) d.push(i);
    for (i = 51; i > 0; i--) {          // Fisher–Yates, seeded
      j = Math.floor(rnd() * (i + 1));
      t = d[i]; d[i] = d[j]; d[j] = t;
    }
    return d;
  }

  /* One per seat. Kept even in a solo game so the shape of a state never
     depends on how many are playing — nothing accrues here below two. */
  function makeScores(n) {
    var s = [], i;
    for (i = 0; i < n; i++) {
      s.push({ score: 0, placements: 0, suits: 0, splits: 0, kills: 0 });
    }
    return s;
  }

  function create(seed, cols, rows, players) {
    cols = Math.max(1, Math.min(4, cols | 0));
    rows = Math.max(1, Math.min(4, rows | 0));
    var size = cols * rows;
    var deck = shuffled(seed);
    var piles = [], i;
    var n = Math.max(1, players | 0 || 1);
    for (i = 0; i < size; i++) piles.push({ cards: [deck[i]], alive: true });
    return autoPick({
      seed: seed, cols: cols, rows: rows, size: size,
      deck: deck,
      next: size,                 // index of the next card to come off the stock
      piles: piles,
      phase: 'PLAY',              // PLAY · RESURRECT · WON · LOST
      selected: -1,
      players: n,
      turn: 0,
      scores: makeScores(n),
      last: null,                 // what just happened, for the renderer to show
      log: []
    });
  }

  /* With one pile still alive there is nothing to choose between, so the game
     chooses: the player calls straight away rather than naming the only pile
     on the board first. A one-pile board is simply the case where this is
     true from the deal. */
  function autoPick(state) {
    if (state.phase !== 'PLAY' || aliveCount(state) !== 1) return state;
    for (var i = 0; i < state.size; i++) {
      if (state.piles[i].alive) { state.selected = i; break; }
    }
    return state;
  }

  function top(state, i) {
    var c = state.piles[i].cards;
    return c[c.length - 1];
  }

  function aliveCount(state) {
    var n = 0;
    for (var i = 0; i < state.size; i++) if (state.piles[i].alive) n++;
    return n;
  }

  function deadCount(state) { return state.size - aliveCount(state); }

  function stockLeft(state) { return 52 - state.next; }

  /* Does the call hold? A tie kills a Hi or a Lo — matching is what Split is
     for, and betting a direction against an equal card is simply wrong. */
  function succeeds(call, oldV, newV) {
    if (call === 'HI') return newV > oldV;
    if (call === 'LO') return newV < oldV;
    return newV === oldV;              // SPLIT
  }

  /* Who may act. A shared board is only honest if every action names its
     author and the engine — not the client, and not the server's good manners —
     refuses one that arrives out of turn. A solo game carries no author and
     skips the check, so single player is exactly what it was.

     This is the whole of turn enforcement: because it lives in `legal`, a
     replay of a log rejects an out-of-turn action the same way a live game
     does, and a client that tries to act early simply has nothing happen. */
  function mayAct(state, action) {
    if (state.players < 2) return true;
    return action.by === state.turn;
  }

  function legal(state, action) {
    if (!mayAct(state, action)) return false;
    if (action.t === 'SELECT') {
      return state.phase === 'PLAY' &&
             action.pile >= 0 && action.pile < state.size &&
             state.piles[action.pile].alive;
    }
    if (action.t === 'CALL') {
      /* Suit is a multiplayer call only. In solo it is a pure gamble with
         nothing to differentiate it from — there is no opponent to out-read. */
      var known = action.call === 'HI' || action.call === 'LO' ||
                  action.call === 'SPLIT' ||
                  (action.call === 'SUIT' && state.players > 1);
      return state.phase === 'PLAY' && state.selected >= 0 && known;
    }
    if (action.t === 'REVIVE') {
      return state.phase === 'RESURRECT' &&
             action.pile >= 0 && action.pile < state.size &&
             !state.piles[action.pile].alive;
    }
    return false;
  }

  /* Mutates and returns state. Illegal actions are ignored rather than thrown,
     so a stray click or a late packet can never corrupt a game. */
  function apply(state, action) {
    if (!legal(state, action)) return state;
    state.log.push(action);

    if (action.t === 'SELECT') {
      state.selected = action.pile;
      return state;
    }

    if (action.t === 'REVIVE') {
      // Comes back exactly as it died — the card that killed it still on top,
      // so a pile lost to a King is a liability you have chosen to take on.
      state.piles[action.pile].alive = true;
      state.phase = 'PLAY';
      state.selected = -1;
      advanceTurn(state);
      return settle(state);
    }

    // CALL
    var i = state.selected;
    var pile = state.piles[i];
    var showing = top(state, i);
    var oldV = value(showing);
    var card = state.deck[state.next];
    var newV = value(card);
    var suited = action.call === 'SUIT';
    var won = suited ? suitOf(card) === suitOf(showing)
                     : succeeds(action.call, oldV, newV);

    state.next++;
    pile.cards.push(card);           // the card is placed either way — a losing
    if (!won) pile.alive = false;    // card is still a card off the stock

    scoreCall(state, action.by, action.call, won);

    state.last = {
      pile: i, call: action.call, card: card,
      survived: won, wasSplit: action.call === 'SPLIT' && won,
      by: state.players > 1 ? action.by : undefined
    };
    state.selected = -1;

    // A made Split buys back a pile — but only if one is actually down.
    if (won && action.call === 'SPLIT' && deadCount(state) > 0) {
      state.phase = 'RESURRECT';
      return state;                  // hold here; the player must choose
    }

    advanceTurn(state);
    return settle(state);
  }

  function advanceTurn(state) {
    if (state.players > 1) state.turn = (state.turn + 1) % state.players;
  }

  /* What each call pays, and the whole of what anything pays. Clearing the
     board earns nothing beyond the calls that cleared it: a seat's score is
     the sum of what it called, start to finish, with no settling up at the
     end that can reorder the table after the last card. */
  var PAYS = { PLACE: 1, SUIT: 3, SPLIT: 4, KILL: -2 };

  /* Points ride on the call, not on the board: a player's score is theirs
     whatever happens to the pile afterwards. Nothing accrues in a solo game —
     scoring is a multiplayer idea and solo has no seat to attribute it to. */
  function scoreCall(state, by, call, won) {
    if (state.players < 2) return;
    var s = state.scores[by];
    if (!won) { s.kills++; s.score += PAYS.KILL; return; }
    if (call === 'SPLIT')     { s.splits++;     s.score += PAYS.SPLIT; }
    else if (call === 'SUIT') { s.suits++;      s.score += PAYS.SUIT; }
    else                      { s.placements++; s.score += PAYS.PLACE; }
  }

  /* Seats ordered as the end screen wants them: most points first, fewest
     kills breaking a tie. Genuine ties keep their shared rank rather than
     being separated by seat order, which would invent a winner. */
  function standings(state) {
    var rows = [], i;
    for (i = 0; i < state.players; i++) {
      rows.push({ player: i, score: state.scores[i].score,
                  kills: state.scores[i].kills, tied: false });
    }
    rows.sort(function (a, b) {
      return b.score - a.score || a.kills - b.kills;
    });
    for (i = 1; i < rows.length; i++) {
      if (rows[i].score === rows[0].score && rows[i].kills === rows[0].kills) {
        rows[0].tied = true; rows[i].tied = true;
      }
    }
    return rows;
  }

  /* Win by placing every card; lose when nothing is left to play on. Checked
     in that order, because emptying the stock with your last living pile is a
     win, not a loss. */
  function settle(state) {
    if (state.phase === 'RESURRECT') return state;
    if (stockLeft(state) === 0) state.phase = 'WON';
    else if (aliveCount(state) === 0) state.phase = 'LOST';
    else state.phase = 'PLAY';
    return autoPick(state);
  }

  /* Rebuild a game from its seed and action log — the hook multiplayer will
     use to bring a latecomer up to date. */
  function replay(seed, cols, rows, players, log) {
    var s = create(seed, cols, rows, players);
    for (var i = 0; i < log.length; i++) apply(s, log[i]);
    return s;
  }

  return {
    create: create, apply: apply, legal: legal, replay: replay,
    top: top, value: value, rankChar: rankChar, suitChar: suitChar,
    aliveCount: aliveCount, deadCount: deadCount, stockLeft: stockLeft,
    succeeds: succeeds, standings: standings,
    PAYS: PAYS, ACE_LOW: ACE_LOW
  };
})();

if (typeof module !== 'undefined') module.exports = HiLo;
