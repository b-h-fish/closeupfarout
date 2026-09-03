/* Room codes. Shared by the entry Worker, which mints them when somebody
   hosts, and by the queue, which mints them when it matches people.

   No I, O, 0 or 1: a code gets read aloud and typed by hand, and those four
   are where that goes wrong. 32^4 is about a million. */
export const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function makeCode() {
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(4));
  for (let i = 0; i < 4; i++) s += ALPHABET[r[i] % ALPHABET.length];
  return s;
}

/* Mint a code nobody is using and claim the room behind it. `auto`, when
   given, is the number of *people* the room should start itself at — a
   matched game has no host to press START. `bots` is how many seats the
   house fills once they have all arrived. */
export async function claimRoom(env, auto, bots) {
  for (let tries = 0; tries < 8; tries++) {
    const code = makeCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const url = 'https://room/claim?code=' + code +
                (auto ? '&auto=' + auto : '') + (bots ? '&bots=' + bots : '');
    const res = await stub.fetch(new Request(url, { method: 'POST' }));
    if (res.ok) return code;
  }
  return null;
}
