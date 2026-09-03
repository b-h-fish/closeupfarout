/* ── SPLIT STACK · a room ──────────────────────────────────────────────────
   One Durable Object per room. The object is the room: its sockets, its
   roster, its game. Nothing is shared between rooms, so rooms scale sideways
   without contending on anything.

   The server runs the same `game.js` the browser runs, and that is the whole
   design. Clients send an *intent*; the server stamps the seat, asks the
   engine whether it is legal, applies it, and fans out the accepted action.
   Every client then applies the same action to its own copy. Because the
   engine is deterministic and the server fixes the order, all five copies of
   the board stay identical without a snapshot ever crossing the wire.

   The client's `by` field is never trusted — the server overwrites it with
   the seat that owns the socket. The engine's own turn check is the second
   line, not the first: it is what makes a replayed log safe.
   ──────────────────────────────────────────────────────────────────────── */

import HiLo from '../../split-stack/game.js';
import { botTurn, botDelay, botNames, botId, botAvatars } from './bots.js';

const MAX_SEATS = 4;
const TIMEOUTS_TO_FORFEIT = 3;

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    /* The settled clock is 10s. It reads from the environment so the timeout
       path can be tested against a shorter one — waiting out the real clock
       once per assertion is how a rule ends up untested. */
    this.turnMs = Number(env.TURN_MS) || 10000;
    /* A seat's first turn is not on the clock: you are reading a board you
       have never seen, and ten seconds is not enough to do that in. It still
       has a deadline, just a long one nobody is shown — without it a player
       who walks away on their opening turn holds the table forever. */
    this.firstMs = Number(env.FIRST_MS) || 60000;
    this.game = null;          // built lazily from the stored log
    this.loaded = false;
  }

  /* Room state lives in storage rather than only in memory: a Durable Object
     can be evicted between turns, and a game that forgot its log would strand
     everyone in it. */
  async load() {
    if (this.loaded) return;
    const s = await this.ctx.storage.get(['meta', 'log', 'seats']);
    this.meta = s.get('meta') || null;
    this.log = s.get('log') || [];
    this.seats = s.get('seats') || [];
    this.loaded = true;
    if (this.meta && this.meta.started) this.rebuild();
  }

  rebuild() {
    const m = this.meta;
    this.game = HiLo.replay(m.seed, m.cols, m.rows, m.players, this.log);
  }

  async save() {
    await this.ctx.storage.put({
      meta: this.meta, log: this.log, seats: this.seats
    });
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);

    /* `claim` is how the entry Worker finds an unused code: a room that
       already has a roster refuses, and the Worker rolls another code. */
    if (url.pathname.endsWith('/claim')) {
      if (this.meta) return new Response('taken', { status: 409 });
      this.meta = {
        code: url.searchParams.get('code'),
        /* A matched room knows how many are coming and starts itself when
           they arrive — there is no host in a matched game to press START,
           and asking four strangers to elect one would be absurd. */
        auto: parseInt(url.searchParams.get('auto'), 10) || 0,
        /* How many seats the house fills when the people have arrived. Kept
           in meta rather than inferred at start time so a game that was
           mostly bots stays identifiable after the fact — leaderboards will
           want to decline it. */
        bots: parseInt(url.searchParams.get('bots'), 10) || 0,
        hostId: null, started: false, over: false,
        seed: 0, cols: 4, rows: 4, players: 0,
        turnStartedAt: 0, deadline: 0, timeouts: {},
        /* Turns taken per seat, so a seat's first can be told from its
           second. `shown` is whether the clock the deadline belongs to
           is one the players are being shown. */
        turns: {}, shown: false
      };
      this.seats = [];
      await this.save();
      return new Response('ok');
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(JSON.stringify({
        exists: !!this.meta,
        started: this.meta ? this.meta.started : false,
        seated: this.seats.length
      }), { headers: { 'content-type': 'application/json' } });
    }
    if (!this.meta) return new Response('no such room', { status: 404 });

    const pair = new WebSocketPair();
    /* Hibernation: the object may sleep between turns with sockets still
       open, which is what keeps an idle room from being billed. Handlers are
       webSocketMessage/Close below rather than addEventListener. */
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  seatOf(ws) {
    const a = ws.deserializeAttachment();
    return a ? a.seat : -1;
  }

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch (e) { /* closing socket */ }
  }

  broadcast(msg, except) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(text); } catch (e) { /* closing socket */ }
    }
  }

  /* No ids on the wire. A seat's id is the token that claims it back after a
     dropped connection, and roster() goes to everybody in the room — so
     broadcasting them handed every player the means to take somebody else's
     seat through onHello. Nothing in the client ever read the field. It also
     spelled out which seats were the house, which is the one thing the house
     is not supposed to say. */
  roster() {
    return this.seats.map((s, i) => ({
      seat: i, name: s.name, av: s.av | 0,
      connected: !!s.bot || this.ctx.getWebSockets().some(w => this.seatOf(w) === i),
      host: s.id === this.meta.hostId
    }));
  }

  /* Everything a client needs to draw the room, whether it is joining for the
     first time or coming back after a dropped connection. The log is the
     whole game — the client replays it rather than being handed a board. */
  syncFor(seat) {
    const m = this.meta;
    return {
      t: 'SYNC', code: m.code, you: seat, seats: this.roster(),
      started: m.started, over: m.over,
      seed: m.seed, cols: m.cols, rows: m.rows, players: m.players,
      log: this.log,
      turn: this.game ? this.game.turn : 0,
      msLeft: this.msLeft()
    };
  }

  /* What the clock is worth telling a client. Zero for a turn nobody is on
     the clock for — a bot thinking, or a seat taking its first turn — and
     zero rather than a negative, which is the whole of the bug that put a
     0 in the corner for the entire length of every bot's turn: deadline is
     0 on those turns, so `deadline - now` went out as minus a trillion, and
     a client reading it as truthy drew a clock that had run out in 1970. */
  msLeft() {
    const m = this.meta;
    if (!m.shown || !m.deadline) return 0;
    return Math.max(0, m.deadline - Date.now());
  }

  async webSocketMessage(ws, raw) {
    await this.load();
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.t === 'HELLO')  return this.onHello(ws, msg);
    const seat = this.seatOf(ws);
    if (seat < 0) return this.send(ws, { t: 'ERR', msg: 'say hello first' });

    if (msg.t === 'START')  return this.onStart(ws, seat);
    if (msg.t === 'ACT')    return this.onAct(ws, seat, msg.action);
    if (msg.t === 'PING')   return this.send(ws, { t: 'PONG' });
  }

  /* A returning player keeps the seat their id already holds — that is what
     makes a dropped connection a pause rather than an ejection. */
  async onHello(ws, msg) {
    const id = String(msg.id || '').slice(0, 64);
    const name = String(msg.name || 'PLAYER').slice(0, 12).toUpperCase();
    /* Clamped, not trusted: an index is drawn straight into a sprite table,
       and the client wraps it, but a non-number would ride the roster out to
       everyone else. */
    const av = Math.max(0, Math.min(63, parseInt(msg.av, 10) || 0));
    if (!id) return this.send(ws, { t: 'ERR', msg: 'no id' });

    let seat = this.seats.findIndex(s => s.id === id);
    if (seat < 0) {
      if (this.meta.started) return this.send(ws, { t: 'ERR', msg: 'game already started' });
      var cap = this.meta.auto || MAX_SEATS;
      if (this.seats.length >= cap) return this.send(ws, { t: 'ERR', msg: 'room full' });
      seat = this.seats.length;
      this.seats.push({ id, name, av });
      if (this.meta.hostId === null) this.meta.hostId = id;
      await this.save();
    } else {
      this.seats[seat].name = name;
      this.seats[seat].av = av;
      await this.save();
    }

    ws.serializeAttachment({ seat, id });
    this.send(ws, this.syncFor(seat));
    this.broadcast({ t: 'ROSTER', seats: this.roster() }, ws);

    if (this.meta.auto && !this.meta.started && this.seats.length >= this.meta.auto) {
      await this.begin();
    }
  }

  async onStart(ws, seat) {
    const m = this.meta;
    if (m.auto) return;   // a matched room starts itself
    if (this.seats[seat].id !== m.hostId) return this.send(ws, { t: 'ERR', msg: 'only the host starts' });
    if (m.started) return;
    if (this.seats.length < 2) return this.send(ws, { t: 'ERR', msg: 'need two players' });
    await this.begin();
  }

  /* The one place a game begins, whether a host asked for it or a matched
     room filled up. */
  async begin() {
    const m = this.meta;
    /* The house sits down last, so it fills exactly the seats nobody took
       and takes a handle nobody at this table is already using. */
    if (m.bots > 0) {
      const names = botNames(m.bots, this.seats.map(s => s.name));
      const avs = botAvatars(m.bots, this.seats.map(s => s.av | 0));
      for (let i = 0; i < names.length; i++) {
        /* Opaque, and deliberately shaped like anyone else's. The id no
           longer leaves the server, but a seat token that spells out what it
           is would be one echo away from undoing the disguise. */
        this.seats.push({ id: botId(), name: names[i], av: avs[i], bot: true });
      }
    }
    m.started = true;
    m.players = this.seats.length;
    m.seed = (Math.random() * 0x7fffffff) | 0;
    this.log = [];
    this.rebuild();

    m.deadline = 0;
    m.turns = {};
    await this.save();
    this.broadcast({
      t: 'BEGIN', seed: m.seed, cols: m.cols, rows: m.rows,
      players: m.players, seats: this.roster()
    });
    /* Seat zero can be a bot, so the opening turn may be theirs. */
    await this.armTurn(true);
  }

  isBot(seat) {
    const s = this.seats[seat];
    return !!(s && s.bot);
  }

  async onAct(ws, seat, action) {
    const m = this.meta;
    if (!m.started || m.over || !this.game) return;
    if (!action || typeof action.t !== 'string') return;

    // The seat comes from the socket, never from the message.
    const stamped = { t: action.t, by: seat };
    if (action.t === 'SELECT' || action.t === 'REVIVE') stamped.pile = action.pile | 0;
    if (action.t === 'CALL') stamped.call = action.call;

    if (!HiLo.legal(this.game, stamped)) {
      return this.send(ws, { t: 'ERR', msg: 'not now' });
    }
    const was = this.game.turn;
    this.commit(stamped);
    await this.afterAction(was);
  }

  commit(action) {
    HiLo.apply(this.game, action);
    this.log.push(action);
    this.broadcast({ t: 'ACT', action });
  }

  /* One place decides what happens after any accepted action, so a move made
     by a player and a move forced by the clock cannot drift apart. */
  async afterAction(turnBefore) {
    const m = this.meta;
    const g = this.game;

    if (g.phase === 'WON' || g.phase === 'LOST') {
      m.over = true;
      m.deadline = 0;
      await this.ctx.storage.deleteAlarm();
      await this.save();
      this.broadcast({
        t: 'OVER', phase: g.phase,
        scores: g.scores, standings: HiLo.standings(g)
      });
      return;
    }

    const moved = turnBefore === undefined || g.turn !== turnBefore;
    await this.armTurn(moved);
    await this.save();
    if (moved) {
      this.broadcast({ t: 'TURN', turn: g.turn, msLeft: this.msLeft() });
    }
  }

  /* One place decides what the clock is doing, so a turn taken by a person
     and a turn taken by the house cannot drift apart.

     The clock belongs to the turn, not to the action. Restarting it on every
     accepted action let a player hold the board indefinitely by picking one
     pile and then another — selecting is part of your turn, not a fresh one.
     It restarts only when the turn actually moves.

     A bot gets a think time in place of a deadline. It cannot run out of
     time, and the pause is most of what stops it reading as software: an
     opponent who answers in forty milliseconds is not one. `moved` is beside
     the point for them, because a made Split leaves the turn where it is and
     the revive still has to be thought about. */
  async armTurn(moved) {
    const m = this.meta, g = this.game;
    if (!m.turns) m.turns = {};              // a room claimed before this rule
    if (moved) m.turns[g.turn] = (m.turns[g.turn] || 0) + 1;

    if (this.isBot(g.turn)) {
      m.deadline = 0;
      m.shown = false;
      await this.ctx.storage.setAlarm(Date.now() + botDelay());
      return;
    }
    if (moved || !m.deadline) {
      const first = (m.turns[g.turn] || 0) <= 1;
      m.deadline = Date.now() + (first ? this.firstMs : this.turnMs);
      m.shown = !first;
      await this.ctx.storage.setAlarm(m.deadline);
    }
  }

  /* The clock ran out. The penalty is loss of agency, not points: the server
     makes a legal move on the seat's behalf. Three in a row and the seat
     forfeits — its score freezes and the rest play on. */
  async alarm() {
    await this.load();
    const m = this.meta, g = this.game;
    if (!m || !m.started || m.over || !g) return;

    /* The house plays through the same door everyone else does: actions the
       engine has to accept, committed and fanned out identically. A bot that
       could reach past legal() would be a second set of rules. */
    if (this.isBot(g.turn)) {
      const was = g.turn;
      let moves = botTurn(g, was);
      if (!moves.length) moves = this.forcedMove(g, was);
      if (!moves.length) return;                  // nothing legal; let it settle
      for (const a of moves) this.commit(a);
      await this.afterAction(was);
      return;
    }

    if (Date.now() < m.deadline - 250) {          // a rescheduled alarm
      await this.ctx.storage.setAlarm(m.deadline);
      return;
    }

    const seat = g.turn;
    m.timeouts[seat] = (m.timeouts[seat] || 0) + 1;
    const forfeited = m.timeouts[seat] >= TIMEOUTS_TO_FORFEIT;
    this.broadcast({ t: 'TIMEOUT', seat, count: m.timeouts[seat], forfeited });

    for (const a of this.forcedMove(g, seat)) this.commit(a);
    await this.afterAction();
  }

  /* A forced move, chosen at random from what is actually legal — the same
     shape of move the player would have made, so the game state cannot end up
     somewhere a real turn could not reach. */
  forcedMove(g, seat) {
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];

    if (g.phase === 'RESURRECT') {
      const dead = [];
      for (let i = 0; i < g.size; i++) if (!g.piles[i].alive) dead.push(i);
      return dead.length ? [{ t: 'REVIVE', pile: pick(dead), by: seat }] : [];
    }

    const out = [];
    if (g.selected < 0) {
      const alive = [];
      for (let i = 0; i < g.size; i++) if (g.piles[i].alive) alive.push(i);
      if (!alive.length) return out;
      out.push({ t: 'SELECT', pile: pick(alive), by: seat });
    }
    out.push({ t: 'CALL', call: pick(['HI', 'LO']), by: seat });
    return out;
  }

  async webSocketClose(ws) {
    await this.load();
    this.broadcast({ t: 'ROSTER', seats: this.roster() }, ws);
  }

  async webSocketError(ws) {
    await this.load();
    this.broadcast({ t: 'ROSTER', seats: this.roster() }, ws);
  }
}
