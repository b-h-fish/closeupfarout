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
const MIN = 2;           // fewer than this is not a game
const PATIENCE_MS = 25000;

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
    return this.ctx.getWebSockets()
      .map(ws => ({ ws, a: ws.deserializeAttachment() }))
      .filter(x => x.a && x.a.since)
      .sort((a, b) => a.a.since - b.a.since);
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
      ws.serializeAttachment({ id, name, since: Date.now() });
      await this.settle();
      return;
    }

    if (m.t === 'LEAVE') { try { ws.close(); } catch (e) {} return; }
    if (m.t === 'PING')  return this.send(ws, { t: 'PONG' });
  }

  /* Match if we can, and otherwise make sure something will wake us when the
     oldest waiter has waited long enough. */
  async settle() {
    const q = this.seated();
    if (q.length >= FULL) return this.match(q.slice(0, FULL));

    if (q.length >= MIN) {
      const oldest = q[0].a.since;
      const due = oldest + this.patience;
      if (Date.now() >= due) return this.match(q.slice(0, FULL));
      await this.ctx.storage.setAlarm(due);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
    this.tellEveryone();
  }

  async alarm() {
    const q = this.seated();
    if (q.length >= MIN) return this.match(q.slice(0, FULL));
    this.tellEveryone();
  }

  /* Hand a group a room of their own. The room is claimed with the number of
     players it should expect, because a matched game has nobody to press
     START — it begins when the last of them arrives. */
  async match(group) {
    const code = await claimRoom(this.env, group.length);
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
      this.send(x.ws, { t: 'MATCH', code, players: group.length });
      try { x.ws.close(1000, 'matched'); } catch (e) {}
    }
    await this.settle();
  }

  async webSocketClose() { await this.settle(); }
  async webSocketError() { await this.settle(); }
}
