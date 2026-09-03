/* ── SPLIT STACK · the entry Worker ────────────────────────────────────────
   Thin on purpose: it mints room codes and hands the socket to the right
   Durable Object. All the game logic lives in the room.
   ──────────────────────────────────────────────────────────────────────── */

export { Room } from './room.js';
export { Queue } from './queue.js';

import { claimRoom } from './code.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type'
};

const json = (body, status) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: { 'content-type': 'application/json', ...CORS }
});

function room(env, code) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // POST /new — mint a code nobody is using and claim it
    if (url.pathname === '/new' && request.method === 'POST') {
      const code = await claimRoom(env);
      return code ? json({ code }) : json({ error: 'could not mint a code' }, 503);
    }

    /* GET /queue — matchmaking. One object for everybody, because matching is
       a rendezvous and two players can only be paired by something that sees
       them both. */
    if (url.pathname === '/queue') {
      const stub = env.QUEUE.get(env.QUEUE.idFromName('main'));
      const res = await stub.fetch(new Request('https://queue/ws', { headers: request.headers }));
      if (res.webSocket) return res;
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: { 'content-type': 'application/json', ...CORS }
      });
    }

    // GET /room/CODE — websocket upgrade, or a plain probe of whether it exists
    const m = /^\/room\/([A-Za-z0-9]{4})$/.exec(url.pathname);
    if (m) {
      const code = m[1].toUpperCase();
      const res = await room(env, code).fetch(
        new Request('https://room/ws', { headers: request.headers })
      );
      if (res.webSocket) return res;
      // a probe response is JSON and wants the CORS headers the DO cannot add
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: { 'content-type': 'application/json', ...CORS }
      });
    }

    if (url.pathname === '/health') return json({ ok: true });
    return json({ error: 'not found' }, 404);
  }
};
