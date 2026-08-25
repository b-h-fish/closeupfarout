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

  function create(seed, cols, rows, players) {
    cols = Math.max(1, Math.min(4, cols | 0));
    rows = Math.max(1, Math.min(4, rows | 0));
    var size = cols * rows;
    var deck = shuffled(seed);
    var piles = [], i;
    for (i = 0; i < size; i++) piles.push({ cards: [deck[i]], alive: true });
    return autoPick({
      seed: seed, cols: cols, rows: rows, size: size,
      deck: deck,
      next: size,                 // index of the next card to come off the stock
      piles: piles,
      phase: 'PLAY',              // PLAY · RESURRECT · WON · LOST
      selected: -1,
      players: Math.max(1, players | 0 || 1),
      turn: 0,
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

  function legal(state, action) {
    if (action.t === 'SELECT') {
      return state.phase === 'PLAY' &&
             action.pile >= 0 && action.pile < state.size &&
             state.piles[action.pile].alive;
    }
    if (action.t === 'CALL') {
      return state.phase === 'PLAY' && state.selected >= 0 &&
             (action.call === 'HI' || action.call === 'LO' || action.call === 'SPLIT');
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
    var oldV = value(top(state, i));
    var card = state.deck[state.next];
    var newV = value(card);
    var won = succeeds(action.call, oldV, newV);

    state.next++;
    pile.cards.push(card);           // the card is placed either way — a losing
    if (!won) pile.alive = false;    // card is still a card off the stock

    state.last = {
      pile: i, call: action.call, card: card,
      survived: won, wasSplit: action.call === 'SPLIT' && won
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
    succeeds: succeeds, ACE_LOW: ACE_LOW
  };
})();

if (typeof module !== 'undefined') module.exports = HiLo;
