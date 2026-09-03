/* ── SPLIT STACK · the queue ───────────────────────────────────────────────
   One Durable Object for the whole of matchmaking. That is a serialization
   point on purpose: matching is a rendezvous, and two players can only be
   paired by something that sees them both. Rooms scale sideways because each
   is independent; a queue cannot, and should not try.

   The wait is not open-ended. Holding out for a full four is right when
   people are about, and wrong when they are not — so a table that has waited
   long enough starts with whoever showed up, down to two. A player who waits
   forever for the perfect table has been failed by the matchmaker.
   ──────────────────────────────────────────────────────────────────────── */

import { claimRoom } from './code.js';

const FULL = 4;          // the table this game is designed around
/* No longer a matching threshold — patience alone decides that, and one
   player is enough. It is what a waiting client is told it is waiting for. */
const MIN = 2;
/* Thirty seconds is the whole of the promise: wait that long and you get a
   game, whoever is or is not about. */
const PATIENCE_MS = 30000;
/* A waiter has to keep saying it is there. A socket whose client vanished —
   tab closed hard, laptop shut, network gone — stays in getWebSockets() until
   the runtime notices, and the local emulator reaps far faster than production
   does. Production had a ghost in the line matching live players into rooms
   with nobody in them. readyState catches the closing ones; only a heartbeat
   catches a connection that is dead but does not know it. */
const STALE_MS = 40000;  // four missed beats at the client's ten seconds
const SWEEP_MS = 15000;
const OPEN = 1;          // WebSocket.OPEN, spelled out for the DO runtime

export class Queue {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    /* The clock is short in tests. Without this a queue test would have to
       sit out the full patience before it could assert anything, which is
       how a timing rule ends up untested. */
    this.patience = Number(env.QUEUE_MS) || PATIENCE_MS;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(JSON.stringify({ waiting: this.seated().length }),
                          { headers: { 'content-type': 'application/json' } });
    }
    const pair = new WebSocketPair();
    /* Hibernation, same as a room: a queue with people in it but nothing
       happening should not be billed for waiting. */
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /* Everyone currently waiting, oldest first — the attachment is the whole
     of a waiter's state, so hibernation costs nothing to recover from. */
  seated() {
    const now = Date.now();
    return this.ctx.getWebSockets()
      .map(ws => ({ ws, a: ws.deserializeAttachment() }))
      .filter(x => x.a && x.a.since && x.ws.readyState === OPEN &&
                   now - (x.a.seen || x.a.since) < STALE_MS)
      .sort((a, b) => a.a.since - b.a.since);
  }

  /* Anyone who has stopped answering is put out of the line for good. The
     attachment goes first for the same reason it does in match(): close() is
     not immediate, and a socket that is merely closing still comes back from
     getWebSockets(). */
  sweep() {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a || !a.since) continue;
      if (ws.readyState === OPEN && now - (a.seen || a.since) < STALE_MS) continue;
      try { ws.serializeAttachment(null); } catch (e) {}
      try { ws.close(1001, 'stale'); } catch (e) {}
    }
  }

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch (e) { /* closing socket */ }
  }

  tellEveryone() {
    const q = this.seated();
    q.forEach((x, i) => this.send(x.ws, {
      t: 'WAITING', ahead: i, waiting: q.length, need: MIN
    }));
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }

    if (m.t === 'JOIN') {
      const id = String(m.id || '').slice(0, 64);
      const name = String(m.name || 'PLAYER').slice(0, 12).toUpperCase();
      if (!id) return this.send(ws, { t: 'ERR', msg: 'no id' });
      /* Rejoining replaces the old socket rather than queueing twice — a
         reconnect should not let one person hold two places in the line. */
      for (const x of this.seated()) {
        if (x.a.id === id && x.ws !== ws) { try { x.ws.close(); } catch (e) {} }
      }
      ws.serializeAttachment({ id, name, since: Date.now(), seen: Date.now() });
      await this.settle();
      return;
    }

    if (m.t === 'LEAVE') {
      try { ws.serializeAttachment(null); } catch (e) {}
      try { ws.close(1000, 'left'); } catch (e) {}
      await this.settle();
      return;
    }
    /* Any message is proof of life, but PING is the one a waiting client can
       send without asking for anything. */
    const a = ws.deserializeAttachment();
    if (a && a.since) { a.seen = Date.now(); try { ws.serializeAttachment(a); } catch (e) {} }
    if (m.t === 'PING') return this.send(ws, { t: 'PONG' });
  }

  /* Match if we can, and otherwise make sure something will wake us when the
     oldest waiter has waited long enough. */
  async settle() {
    this.sweep();
    const q = this.seated();
    if (q.length >= FULL) return this.match(q.slice(0, FULL));

    let due = 0;
    if (q.length) {
      /* One player is enough to start the clock now. Waiting for a second
         human before the timer even runs is how somebody sits alone at four
         in the morning watching a wheel spin: the house fills the rest. */
      due = q[0].a.since + this.patience;
      if (Date.now() >= due) return this.match(q.slice(0, FULL), true);
    }
    /* Something has to keep waking us while anyone is waiting, or a line of
       one is never swept and the ghost outlives everybody. */
    if (q.length) {
      const sweepAt = Date.now() + SWEEP_MS;
      await this.ctx.storage.setAlarm(due ? Math.min(due, sweepAt) : sweepAt);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
    this.tellEveryone();
  }

  async alarm() {
    this.sweep();
    const q = this.seated();
    if (q.length && Date.now() >= q[0].a.since + this.patience) {
      return this.match(q.slice(0, FULL), true);
    }
    await this.settle();
  }

  /* Hand a group a room of their own. The room is claimed with the number of
     people it should expect, because a matched game has nobody to press
     START — it begins when the last of them arrives, house included. */
  async match(group, fill) {
    /* Only a table that ran out of patience is filled. A full four never is,
       and neither is anyone who still has time on the clock. */
    const bots = fill ? Math.max(0, FULL - group.length) : 0;
    const code = await claimRoom(this.env, group.length, bots);
    if (!code) {
      for (const x of group) this.send(x.ws, { t: 'ERR', msg: 'no room could be made' });
      return;
    }
    for (const x of group) {
      /* Out of the queue before anything else. close() is not immediate and
         getWebSockets() keeps returning a closing socket, so a group that
         left only by closing was still standing in the line when settle()
         ran next — and got matched a second time, into a second room, over
         and over. Clearing the attachment is what actually removes them. */
      try { x.ws.serializeAttachment(null); } catch (e) {}
      this.send(x.ws, { t: 'MATCH', code, players: group.length + bots });
      try { x.ws.close(1000, 'matched'); } catch (e) {}
    }
    await this.settle();
  }

  async webSocketClose() { await this.settle(); }
  async webSocketError() { await this.settle(); }
}
