/* ── SPLIT STACK · the wire ────────────────────────────────────────────────
   Everything that talks to the room server, and nothing that draws. app.js
   hands this a set of callbacks and never sees a socket; game.js never learns
   the network exists at all.

   The client is deliberately dumb: it sends intents and applies whatever the
   server sends back. It does not predict, and it does not roll back. Being
   turn-based is what buys that — when it is your turn nobody else can act, so
   waiting for your own action to echo costs one round trip and removes a
   whole category of bug.
   ──────────────────────────────────────────────────────────────────────── */

var Net = (function () {
  'use strict';

  var ORIGIN = 'https://split-stack-server.bryanhfisher.workers.dev';

  /* Anonymous identity, tier one of three. A random id in localStorage is
     what lets a dropped connection come back to the same seat — it is not a
     login and it is not sent anywhere but the room. */
  var KEY_ID = 'splitstack.id', KEY_NAME = 'splitstack.name';
  var KEY_AVATAR = 'splitstack.avatar';

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k);
          localStorage.setItem(k, v); return v; } catch (e) { return null; }
  }

  function myId() {
    var id = store(KEY_ID);
    if (!id) {
      id = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      store(KEY_ID, id);
    }
    return id;
  }
  function myName(set) {
    if (set !== undefined) return store(KEY_NAME, set);
    return store(KEY_NAME) || '';
  }
  /* Which avatar, as an index. Stored beside the name because it is the same
     kind of thing — what the other players see, chosen once and remembered. */
  function myAvatar(set) {
    if (set !== undefined) return store(KEY_AVATAR, String(set));
    var v = parseInt(store(KEY_AVATAR), 10);
    return isNaN(v) ? 0 : v;
  }

  function post(path) {
    return fetch(ORIGIN + path, { method: 'POST' }).then(function (r) {
      if (!r.ok) throw new Error('server said ' + r.status);
      return r.json();
    });
  }
  function get(path) {
    return fetch(ORIGIN + path).then(function (r) { return r.json(); });
  }

  function createRoom() { return post('/new'); }
  function probeRoom(code) { return get('/room/' + code); }

  /* A live room. `on` carries one function per server message; anything the
     caller does not care about is simply absent. */
  function join(code, name, on) {
    var ws = null, closed = false, tries = 0, timer = 0;
    var self = {};

    function open() {
      if (closed) return;
      ws = new WebSocket(ORIGIN.replace(/^http/, 'ws') + '/room/' + code);
      ws.onopen = function () {
        tries = 0;
        ws.send(JSON.stringify({ t: 'HELLO', id: myId(), name: name }));
        if (on.open) on.open();
      };
      ws.onmessage = function (ev) {
        var m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (on[m.t]) on[m.t](m);
        if (on.any) on.any(m);
      };
      ws.onclose = function () {
        if (closed) return;
        if (on.drop) on.drop();
        /* Back off, but not far: a room is a live conversation and a player
           staring at a frozen board wants it back, not a polite retry in a
           minute. The server holds the seat by id, so reconnecting lands
           exactly where it left. */
        tries++;
        var wait = Math.min(4000, 400 * tries);
        timer = setTimeout(open, wait);
      };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
    }

    self.send = function (msg) {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
      return false;
    };
    self.act = function (action) { return self.send({ t: 'ACT', action: action }); };
    self.start = function () { return self.send({ t: 'START' }); };
    self.close = function () {
      closed = true;
      clearTimeout(timer);
      if (ws) { try { ws.close(); } catch (e) {} }
    };
    self.live = function () { return !!ws && ws.readyState === 1; };

    open();
    return self;
  }

  /* A room in the address bar, so a code can be shared as a link rather than
     read out loud. Kept to the same shape the seeded solo links use. */
  function linkFor(code) {
    return location.origin + location.pathname + '?room=' + code;
  }
  function codeFromUrl() {
    try {
      var q = new URLSearchParams(location.search).get('room') || '';
      return /^[2-9A-HJ-NP-Za-hj-np-z]{4}$/.test(q) ? q.toUpperCase() : '';
    } catch (e) { return ''; }
  }

  return {
    origin: ORIGIN,
    id: myId, name: myName, avatar: myAvatar,
    createRoom: createRoom, probeRoom: probeRoom, join: join,
    linkFor: linkFor, codeFromUrl: codeFromUrl
  };
})();
