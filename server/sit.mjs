/* Sit a second player in a room and print every action the server fans out.
   Used to test the browser client's half of the exchange: the browser hosts
   and plays, this watches from the other seat.
     node server/sit.mjs CODE [name]                                          */
import { WebSocket } from 'ws';

const BASE = 'https://split-stack-server.bryanhfisher.workers.dev';
const code = (process.argv[2] || '').toUpperCase();
const name = (process.argv[3] || 'NODEBOT').toUpperCase();
if (!code) { console.log('usage: node sit.mjs CODE [name]'); process.exit(1); }

const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/room/' + code);
ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'HELLO', id: 'p-' + name.toLowerCase(), name }));
  console.log('sat down in ' + code + ' as ' + name);
});
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'SYNC')  console.log('  SYNC   seat ' + m.you + ', ' + m.seats.length + ' seated, log ' + m.log.length);
  else if (m.t === 'ROSTER') console.log('  ROSTER ' + m.seats.map(s => s.name).join(', '));
  else if (m.t === 'BEGIN')  console.log('  BEGIN  seed ' + m.seed + ', ' + m.players + ' players');
  else if (m.t === 'ACT')    console.log('  ACT    ' + JSON.stringify(m.action));
  else if (m.t === 'TURN')   console.log('  TURN   seat ' + m.turn + ', ' + m.msLeft + 'ms');
  else if (m.t === 'OVER')   console.log('  OVER   ' + m.phase);
  else console.log('  ' + m.t + ' ' + JSON.stringify(m).slice(0, 90));
});
ws.on('close', () => { console.log('closed'); process.exit(0); });
setTimeout(() => { ws.close(); }, Number(process.env.SECONDS || 90) * 1000);
