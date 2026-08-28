/* ── SPLIT STACK · the entry Worker ────────────────────────────────────────
   Thin on purpose: it mints room codes and hands the socket to the right
   Durable Object. All the game logic lives in the room.
   ──────────────────────────────────────────────────────────────────────── */

export { Room } from './room.js';

/* No I, O, 0 or 1 — a room code gets read aloud and typed by hand, and those
   four are where that goes wrong. 32^4 is about a million codes. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function makeCode() {
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(4));
  for (let i = 0; i < 4; i++) s += ALPHABET[r[i] % ALPHABET.length];
  return s;
}

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
      for (let tries = 0; tries < 8; tries++) {
        const code = makeCode();
        const res = await room(env, code).fetch(
          new Request('https://room/claim?code=' + code, { method: 'POST' })
        );
        if (res.ok) return json({ code });
      }
      return json({ error: 'could not mint a code' }, 503);
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
