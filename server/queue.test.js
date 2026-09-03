/* ── SPLIT STACK · matchmaking, over a real socket ─────────────────────────
   Run with:  npx wrangler dev --port 8787 --local --var QUEUE_MS:1500
              node server/queue.test.js

   Matching is the kind of thing that looks right and pairs people wrongly:
   two players in one room, a third stranded, somebody holding two places in
   the line. None of that raises anything — it just quietly happens to a
   stranger. So every claim here is checked against what the server actually
   did rather than against what it was asked to do.
   ──────────────────────────────────────────────────────────────────────── */

import { WebSocket } from 'ws';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const WSBASE = BASE.replace(/^http/, 'ws');
/* Patience is short under `wrangler dev --var QUEUE_MS:1500` and is the
   settled 25s in production, so every wait here is sized from it. Hard-coded
   six-second waits passed locally and failed against the deployed Worker for
   no reason but the clock, which is the sort of red that teaches you to
   ignore red. */
const PATIENCE = Number(process.env.QUEUE_MS || 1500);
const SLACK = 6000;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* Someone standing in the queue. Keeps every message so a test can ask what
   it was told, not only where it ended up. */
class Waiter {
  constructor(id, name) {
    this.id = id; this.name = name;
    this.msgs = [];
    this.match = null;
    this.ws = new WebSocket(WSBASE + '/queue');
    this.ready = new Promise(res => this.ws.on('open', res));
    this.ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m);
      if (m.t === 'MATCH') this.match = m;
    });
    this.ws.on('error', () => {});
  }
  async join() {
    await this.ready;
    this.ws.send(JSON.stringify({ t: 'JOIN', id: this.id, name: this.name }));
  }
  last(type) { return [...this.msgs].reverse().find(m => m.t === type); }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function waitFor(fn, ms = 6000) {
  const started = Date.now();
  while (Date.now() - started < ms) { if (fn()) return true; await sleep(40); }
  return false;
}

const main = async () => {
  // ── four fill a table straight away ──
  const four = [0, 1, 2, 3].map(i => new Waiter('f' + i + Date.now(), 'F' + i));
  for (const w of four) { await w.join(); await sleep(60); }

  ok('four are matched without waiting out the clock',
     await waitFor(() => four.every(w => w.match), 2000));
  const codes = new Set(four.filter(w => w.match).map(w => w.match.code));
  ok('all four are sent to the same room', codes.size === 1, [...codes].join(','));
  ok('the table is reported as four handed',
     four.every(w => w.match && w.match.players === 4));
  const fourCode = four[0].match ? four[0].match.code : null;
  four.forEach(w => w.close());

  // ── that room starts itself: a matched game has no host ──
  await sleep(200);
  const seatedFour = fourCode ? await (await fetch(BASE + '/room/' + fourCode)).json() : {};
  ok('the matched room exists', !!seatedFour.exists);

  // ── two wait out the clock and are matched anyway ──
  const a = new Waiter('a' + Date.now(), 'ALPHA');
  const b = new Waiter('b' + Date.now(), 'BETA');
  /* Waited for rather than slept past: a fixed 60ms is plenty on localhost
     and not always enough over the internet, and a test that fails on the
     round trip teaches you to ignore its own red. */
  await a.join();
  const waited = await waitFor(() => !!a.last('WAITING'), 4000);
  await b.join();

  ok('a waiter is told the queue depth', waited, JSON.stringify(a.msgs.slice(-1)));
  ok('two do not match on the spot', !a.match && !b.match);

  /* Guarded, because a matcher that never matches should fail this suite
     with a message rather than crash it with a TypeError three lines later
     and take every remaining check down with it. */
  const paired = await waitFor(() => a.match && b.match, PATIENCE + SLACK);
  ok('two are matched once the wait is up', paired);
  ok('the pair share a room', paired && a.match.code === b.match.code);
  ok('the pair is reported as two handed', paired && a.match.players === 2);
  const pairCode = paired ? a.match.code : null;
  ok('the pair did not land in the four-handed room', paired && pairCode !== fourCode);
  a.close(); b.close();

  // ── a matched room starts itself when the last of them arrives ──
  await sleep(200);
  const roomState = pairCode ? await (await fetch(BASE + '/room/' + pairCode)).json() : {};
  ok('the pair have a room of their own', !!roomState.exists);

  // ── one player cannot hold two places ──
  const dupId = 'dup' + Date.now();
  const d1 = new Waiter(dupId, 'DUPE');
  await d1.join(); await sleep(80);
  const d2 = new Waiter(dupId, 'DUPE');
  await d2.join(); await sleep(200);

  const depth = await (await fetch(BASE + '/queue')).json();
  ok('rejoining replaces a place rather than adding one', depth.waiting === 1,
     'waiting ' + depth.waiting);

  // ── and one player alone is never matched ──
  await sleep(PATIENCE + 700);
  ok('one player alone is never matched', !d2.match);
  d1.close(); d2.close();

  await sleep(150);
  const empty = await (await fetch(BASE + '/queue')).json();
  ok('leaving empties the queue', empty.waiting === 0, 'waiting ' + empty.waiting);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
