/* ── SPLIT STACK · the room, over a real socket ────────────────────────────
   Run with:  npx wrangler dev --port 8787 --local   (in one shell)
              node server/room.test.js               (in another)

   This drives the actual Worker over actual WebSockets rather than calling
   the room's methods directly, because the things most likely to be wrong
   here are not rules — they are seat assignment, ordering, and whether four
   independent clients replaying the same log land on the same board.

   The convergence check at the end is the point of the whole architecture:
   no board state ever crosses the wire, so if the clients agree, the design
   works; if they drift, nothing on screen would have told anyone.
   ──────────────────────────────────────────────────────────────────────── */

import { WebSocket } from 'ws';
import HiLo from '../split-stack/game.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const WSBASE = BASE.replace(/^http/, 'ws');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* A client that mirrors what the browser will do: hold a socket, keep a local
   game, and rebuild it purely by applying the actions the server sends. */
class Client {
  constructor(code, id, name) {
    this.id = id; this.name = name;
    this.ws = new WebSocket(WSBASE + '/room/' + code);
    this.msgs = [];
    this.game = null;
    this.seat = -1;
    this.ready = new Promise(res => { this.ws.on('open', res); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m);
      if (m.t === 'SYNC') {
        this.seat = m.you;
        if (m.started) this.game = HiLo.replay(m.seed, m.cols, m.rows, m.players, m.log);
      }
      if (m.t === 'BEGIN') {
        this.game = HiLo.create(m.seed, m.cols, m.rows, m.players);
      }
      if (m.t === 'ACT' && this.game) HiLo.apply(this.game, m.action);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async hello() { await this.ready; this.send({ t: 'HELLO', id: this.id, name: this.name }); }
  waitFor(type, ms = 3000) {
    const started = Date.now();
    return (async () => {
      while (Date.now() - started < ms) {
        const hit = this.msgs.find(m => m.t === type);
        if (hit) return hit;
        await sleep(25);
      }
      return null;
    })();
  }
  clear() { this.msgs.length = 0; }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function newRoom() {
  const r = await fetch(BASE + '/new', { method: 'POST' });
  return (await r.json()).code;
}

const main = async () => {
  // ── a room takes four seats, in order ──
  const code = await newRoom();
  ok('a room code is four characters', /^[2-9A-HJ-NP-Z]{4}$/.test(code), code);

  const cs = [];
  for (let i = 0; i < 4; i++) cs.push(new Client(code, 'p' + i, 'SEAT' + i));
  for (const c of cs) { await c.hello(); await sleep(120); }

  ok('seats are handed out in join order', cs.map(c => c.seat).join(',') === '0,1,2,3',
     cs.map(c => c.seat).join(','));
  const sync0 = await cs[0].waitFor('SYNC');
  ok('the first to join is host', sync0.seats[0].host);

  // ── a fifth is turned away ──
  const fifth = new Client(code, 'p4', 'LATE');
  await fifth.hello();
  const err = await fifth.waitFor('ERR');
  ok('a fifth player is refused', err && /full/.test(err.msg), err && err.msg);
  fifth.close();

  // ── only the host starts ──
  cs[1].clear();
  cs[1].send({ t: 'START' });
  const notHost = await cs[1].waitFor('ERR');
  ok('a non-host cannot start', notHost && /host/.test(notHost.msg));

  for (const c of cs) c.clear();
  cs[0].send({ t: 'START' });
  const begin = await cs[0].waitFor('BEGIN');
  ok('the host starts the game', !!begin);
  ok('the deal is four-handed', begin && begin.players === 4);
  await sleep(250);
  ok('every client built the same board',
     cs.every(c => c.game && JSON.stringify(c.game.piles) === JSON.stringify(cs[0].game.piles)));

  // ── the wrong seat cannot act ──
  const g0 = cs[0].game;
  const live = [];
  for (let i = 0; i < g0.size; i++) if (g0.piles[i].alive) live.push(i);

  for (const c of cs) c.clear();
  cs[1].send({ t: 'ACT', action: { t: 'SELECT', pile: live[0] } });
  const refused = await cs[1].waitFor('ERR');
  ok('a seat cannot act out of turn', refused && /not now/.test(refused.msg));
  ok('the refused action reached nobody', cs[2].msgs.every(m => m.t !== 'ACT'));

  // ── a seat cannot forge another seat ──
  for (const c of cs) c.clear();
  cs[1].send({ t: 'ACT', action: { t: 'SELECT', pile: live[0], by: 0 } });
  await sleep(200);
  ok('a forged author is ignored, not honoured', cs[2].msgs.every(m => m.t !== 'ACT'));

  // ── a real turn, and everyone follows it ──
  for (const c of cs) c.clear();
  cs[0].send({ t: 'ACT', action: { t: 'SELECT', pile: live[0] } });
  await sleep(200);
  ok('the seat on turn may act', cs[0].game.selected === live[0]);
  ok('the action reached the other clients',
     cs.every(c => c.game.selected === live[0]));

  for (const c of cs) c.clear();
  cs[0].send({ t: 'ACT', action: { t: 'CALL', call: 'HI' } });
  const turnMsg = await cs[0].waitFor('TURN');
  ok('a call passes the turn', !!turnMsg);
  ok('the clock starts after the first move', turnMsg && turnMsg.msLeft > 0);
  await sleep(150);
  ok('all four boards still agree after a call',
     cs.every(c => JSON.stringify(c.game.piles) === JSON.stringify(cs[0].game.piles)));
  ok('all four scoreboards agree',
     cs.every(c => JSON.stringify(c.game.scores) === JSON.stringify(cs[0].game.scores)));

  // ── play a stretch, then check convergence properly ──
  for (let step = 0; step < 24; step++) {
    const g = cs[0].game;
    if (g.phase === 'WON' || g.phase === 'LOST') break;
    const seat = g.turn;
    const c = cs[seat];
    if (g.phase === 'RESURRECT') {
      let d = 0; while (d < g.size && g.piles[d].alive) d++;
      c.send({ t: 'ACT', action: { t: 'REVIVE', pile: d } });
    } else {
      let i = 0; while (i < g.size && !g.piles[i].alive) i++;
      if (i >= g.size) break;
      if (g.selected < 0) { c.send({ t: 'ACT', action: { t: 'SELECT', pile: i } }); await sleep(70); }
      c.send({ t: 'ACT', action: { t: 'CALL', call: 'HI' } });
    }
    await sleep(90);
  }
  ok('boards agree after a long exchange',
     cs.every(c => JSON.stringify(c.game.piles) === JSON.stringify(cs[0].game.piles)));
  ok('turn pointers agree', cs.every(c => c.game.turn === cs[0].game.turn));
  ok('logs are the same length', cs.every(c => c.game.log.length === cs[0].game.log.length));

  // ── a dropped player comes back to the same seat and the same game ──
  const before = JSON.stringify(cs[2].game.piles);
  const wasLog = cs[2].game.log.length;
  cs[2].close();
  await sleep(250);
  const back = new Client(code, 'p2', 'SEAT2');
  await back.hello();
  const resync = await back.waitFor('SYNC');
  ok('a returning player keeps their seat', resync && resync.you === 2, resync && String(resync.you));
  ok('a returning player is handed the whole log', resync && resync.log.length === wasLog);
  await sleep(120);
  ok('a returning player rebuilds the same board',
     back.game && JSON.stringify(back.game.piles) === before);

  for (const c of cs) c.close();
  back.close();

  /* ── the clock ──
     Only meaningful against a short TURN_MS; run the dev server with
     `--var TURN_MS:1200`. At the settled 30s this section is skipped rather
     than sitting there holding the suite up. */
  const clockCode = await newRoom();
  const t0 = new Client(clockCode, 'q0', 'ALPHA');
  const t1 = new Client(clockCode, 'q1', 'BETA');
  await t0.hello(); await sleep(100);
  await t1.hello(); await sleep(100);
  for (const c of [t0, t1]) c.clear();
  t0.send({ t: 'START' });
  const beg = await t0.waitFor('BEGIN');
  ok('the clock room started', !!beg);
  await sleep(150);

  // first turn carries no clock, so make one move to start it
  const cg = t0.game;
  let ci = 0; while (ci < cg.size && !cg.piles[ci].alive) ci++;
  t0.clear(); t1.clear();
  t0.send({ t: 'ACT', action: { t: 'SELECT', pile: ci } });
  await sleep(80);
  t0.send({ t: 'ACT', action: { t: 'CALL', call: 'HI' } });
  const firstTurn = await t0.waitFor('TURN');
  const shortClock = firstTurn && firstTurn.msLeft <= 3000;
  await sleep(150);

  if (shortClock) {
    const turnBefore = t0.game.turn;
    ok('the turn passed to the other seat', turnBefore === 1, 'turn=' + turnBefore);
    const logBefore = t0.game.log.length;
    t0.clear(); t1.clear();
    // let it lapse — nobody acts
    const to = await t0.waitFor('TIMEOUT', 5000);
    ok('a lapsed turn reports a timeout', !!to, to ? '' : 'none arrived');
    ok('the timeout names the seat that lapsed', to && to.seat === turnBefore);
    await sleep(300);
    ok('a lapsed turn is played for the seat', t0.game.log.length > logBefore);
    ok('the turn moves on after a timeout', t0.game.turn !== turnBefore);
    ok('both clients saw the forced move',
       JSON.stringify(t1.game.piles) === JSON.stringify(t0.game.piles));

    /* Selecting is part of your turn, not a fresh one — otherwise a player
       stalls the table forever by picking one pile and then another. */
    const staller = t0.game.turn === 0 ? t0 : t1;
    staller.clear();
    /* Keep selecting for well past the clock. The timeout has to arrive
       *while* the selects are still coming — pausing to wait for it is what
       made an earlier version of this test pass against the bug it was
       written to catch. */
    let sawTimeout = false, selects = 0;
    const until = Date.now() + 3600;
    while (Date.now() < until) {
      const g = t0.game;
      const alive = [];
      for (let i = 0; i < g.size; i++) if (g.piles[i].alive) alive.push(i);
      if (alive.length < 2) break;
      staller.send({ t: 'ACT', action: { t: 'SELECT', pile: alive[selects % 2] } });
      selects++;
      await sleep(250);
      if (staller.msgs.some(m => m.t === 'TIMEOUT')) { sawTimeout = true; break; }
    }
    ok('re-selecting does not hold the board open', sawTimeout,
       'survived ' + selects + ' selects over ' + Math.round(3600 / 1000) + 's with no timeout');
  } else {
    console.log('  – clock section skipped (TURN_MS is the full 30s)');
  }
  t0.close(); t1.close();

  // ── a room that does not exist ──
  const probe = await fetch(BASE + '/room/ZZZZ');
  const pj = await probe.json();
  ok('an unknown code reports itself unknown', pj.exists === false);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
