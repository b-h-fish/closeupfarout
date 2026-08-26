/* ── SPLIT · the rules ─────────────────────────────────────────────────────
   Run with:  node split/rules.test.js        (exits non-zero on a failure)

   These cover decisions that were settled by conversation and are not
   guessable from the game's name — an ace plays high, a tie kills a Hi or a
   Lo, a revived pile comes back with the card that killed it still on top, a
   Split with nothing dead simply continues. A rules bug does not look like a
   bug: the cards still flip and the game still ends. It just quietly becomes
   a different game.

   That matters more than usual here, because multiplayer is designed around
   players exchanging actions rather than board snapshots — every client
   rebuilds the same game from the same seed and log. Any drift in these and
   two people would be looking at different boards from one deal.
   ──────────────────────────────────────────────────────────────────────── */

const H = require('./game.js');
let pass=0, fail=0;
function ok(name, cond, extra){ if(cond){pass++;} else {fail++; console.log('  ✗ '+name+(extra?'  '+extra:''));} }

// ── deal ──
let s = H.create(1234, 3, 3, 1);
ok('9 piles for 3x3', s.piles.length===9);
ok('stock is 52-9', H.stockLeft(s)===43);
ok('every pile starts with one card', s.piles.every(p=>p.cards.length===1));
ok('all piles start alive', H.aliveCount(s)===9);
ok('deck is a permutation of 52', new Set(s.deck).size===52);
ok('same seed deals the same deck', JSON.stringify(H.create(1234,3,3,1).deck)===JSON.stringify(s.deck));
ok('different seed deals differently', JSON.stringify(H.create(9999,3,3,1).deck)!==JSON.stringify(s.deck));
ok('grid clamped to 4x4', H.create(1,9,9,1).size===16);
ok('grid clamped up from 0', H.create(1,0,0,1).size===1);

// ── comparison ──
ok('HI beats lower',      H.succeeds('HI', 5, 9)===true);
ok('HI loses to higher',  H.succeeds('HI', 9, 5)===false);
ok('HI loses on a tie',   H.succeeds('HI', 7, 7)===false);
ok('LO beats higher',     H.succeeds('LO', 9, 5)===true);
ok('LO loses on a tie',   H.succeeds('LO', 7, 7)===false);
ok('SPLIT needs exact',   H.succeeds('SPLIT', 7, 7)===true);
ok('SPLIT fails when off',H.succeeds('SPLIT', 7, 8)===false);
ok('ace is high',         H.value(0)===14 && H.value(12)===13 && H.value(1)===2);

// ── a losing card is still placed ──
function rigged(seed, cols, rows){ return H.create(seed, cols, rows, 1); }
s = rigged(7, 2, 2);
let before = H.stockLeft(s);
H.apply(s, {t:'SELECT', pile:0});
let topBefore = H.top(s,0);
let incoming  = s.deck[s.next];
// deliberately call the wrong way
let call = H.value(incoming) > H.value(topBefore) ? 'LO' : 'HI';
if (H.value(incoming)===H.value(topBefore)) call='HI';
H.apply(s, {t:'CALL', call:call});
ok('a wrong call kills the pile', s.piles[0].alive===false);
ok('the killing card is still placed', s.piles[0].cards.length===2 && s.piles[0].cards[1]===incoming);
ok('stock decreased by exactly one', H.stockLeft(s)===before-1);
ok('killer card sits on top', H.top(s,0)===incoming);

// ── split: resurrection gating ──
// find a seed/position where a split is available with a dead pile present
function findSplit(maxSeed){
  for (let seed=1; seed<maxSeed; seed++){
    let g = H.create(seed, 2, 2, 1);
    // kill pile 0 first
    for (let guard=0; guard<40 && g.phase==='PLAY'; guard++){
      if (!g.piles[0].alive) break;
      H.apply(g,{t:'SELECT',pile:0});
      let inc=g.deck[g.next], tp=H.top(g,0);
      let c = H.value(inc) > H.value(tp) ? 'LO' : 'HI';
      if (H.value(inc)===H.value(tp)) c='HI';
      H.apply(g,{t:'CALL',call:c});
    }
    if (g.phase!=='PLAY' || g.piles[0].alive) continue;
    // now look for a pile whose top matches the incoming card
    for (let p=1;p<4;p++){
      if(!g.piles[p].alive) continue;
      if (H.value(H.top(g,p))===H.value(g.deck[g.next])) return {g,p};
    }
  }
  return null;
}
let found = findSplit(4000);
ok('found a split scenario to test', !!found);
if (found){
  let {g,p} = found;
  let deadBefore = H.deadCount(g);
  H.apply(g,{t:'SELECT',pile:p});
  H.apply(g,{t:'CALL',call:'SPLIT'});
  ok('made split keeps the pile alive', g.piles[p].alive===true);
  ok('made split with a dead pile halts for a choice', g.phase==='RESURRECT', 'phase='+g.phase);
  // illegal moves during RESURRECT
  let snapshot = JSON.stringify(g);
  H.apply(g,{t:'CALL',call:'HI'});
  ok('cannot call while resurrecting', JSON.stringify(g)===snapshot);
  H.apply(g,{t:'REVIVE',pile:p});
  ok('cannot revive a living pile', JSON.stringify(g)===snapshot);
  let deadPile = g.piles.findIndex(x=>!x.alive);
  let corpseTop = H.top(g, deadPile);
  let corpseLen = g.piles[deadPile].cards.length;
  H.apply(g,{t:'REVIVE',pile:deadPile});
  ok('revive brings the pile back', g.piles[deadPile].alive===true);
  ok('revived pile is unchanged, killer card on top',
     H.top(g,deadPile)===corpseTop && g.piles[deadPile].cards.length===corpseLen);
  ok('play resumes after reviving', g.phase==='PLAY');
  ok('dead count dropped by one', H.deadCount(g)===deadBefore-1);
}

// ── split with no dead piles simply continues ──
function findCleanSplit(maxSeed){
  for (let seed=1; seed<maxSeed; seed++){
    let g=H.create(seed,3,3,1);
    for(let p=0;p<9;p++)
      if (H.value(H.top(g,p))===H.value(g.deck[g.next])) return {g,p};
  }
  return null;
}
let cs = findCleanSplit(3000);
ok('found a clean split scenario', !!cs);
if (cs){
  H.apply(cs.g,{t:'SELECT',pile:cs.p});
  H.apply(cs.g,{t:'CALL',call:'SPLIT'});
  ok('split with no dead piles keeps playing', cs.g.phase==='PLAY', 'phase='+cs.g.phase);
  ok('and the pile survived', cs.g.piles[cs.p].alive===true);
}

// ── full games: invariants over many random playthroughs ──
let wins=0, losses=0, stuck=0, bad=0;
for (let seed=1; seed<=600; seed++){
  let g = H.create(seed, 3, 3, 1);
  let guard=0;
  while (g.phase!=='WON' && g.phase!=='LOST' && guard++ < 500){
    if (g.phase==='RESURRECT'){
      let d = g.piles.findIndex(x=>!x.alive);
      H.apply(g,{t:'REVIVE',pile:d});
      continue;
    }
    let live = []; g.piles.forEach((p,i)=>{ if(p.alive) live.push(i); });
    if (!live.length) break;
    let pick = live[seed % live.length];
    H.apply(g,{t:'SELECT',pile:pick});
    // play sensibly: call toward the middle of the remaining range
    let v = H.value(H.top(g,pick));
    H.apply(g,{t:'CALL',call: v<=7 ? 'HI' : 'LO'});
  }
  if (guard>=500) stuck++;
  // invariants
  let placed = g.piles.reduce((n,p)=>n+p.cards.length,0);
  if (placed + H.stockLeft(g) !== 52) bad++;
  let all = []; g.piles.forEach(p=>p.cards.forEach(c=>all.push(c)));
  if (new Set(all).size !== all.length) bad++;
  if (g.phase==='WON') wins++; else if (g.phase==='LOST') losses++;
}
ok('no game ran away', stuck===0, 'stuck='+stuck);
ok('cards are conserved and never duplicated', bad===0, 'bad='+bad);
ok('games resolve to a result', wins+losses===600, 'w='+wins+' l='+losses);

// ── replay determinism ──
let g1 = H.create(4242, 3, 3, 1);
let guard=0;
while (g1.phase==='PLAY' && guard++ < 60){
  let live=[]; g1.piles.forEach((p,i)=>{if(p.alive)live.push(i);});
  if(!live.length) break;
  H.apply(g1,{t:'SELECT',pile:live[0]});
  H.apply(g1,{t:'CALL',call:'HI'});
  if (g1.phase==='RESURRECT'){
    H.apply(g1,{t:'REVIVE',pile:g1.piles.findIndex(x=>!x.alive)});
  }
}
let g2 = H.replay(4242, 3, 3, 1, g1.log);
ok('replaying the log reproduces the game',
   JSON.stringify({p:g1.piles,n:g1.next,ph:g1.phase})===JSON.stringify({p:g2.piles,n:g2.next,ph:g2.phase}));

// ── the last pile selects itself ──
// With one pile alive there is nothing to choose, so a call is legal without
// naming it first. A 1x1 board is that same case, true from the deal.
let a1 = H.create(7, 1, 1, 1);
ok('a 1x1 board is selected from the deal', a1.selected === 0);
ok('a 1x1 board can call straight away', H.legal(a1, {t:'CALL', call:'HI'}));

let a2 = H.create(7, 3, 3, 1);
ok('a bigger board starts unselected', a2.selected === -1);
ok('a bigger board must pick a pile first', !H.legal(a2, {t:'CALL', call:'HI'}));

// kill 2x2 down to a single living pile, deliberately calling wrong each time
let a3 = H.create(99, 2, 2, 1), aguard = 0;
while (H.aliveCount(a3) > 1 && a3.phase === 'PLAY' && aguard++ < 200) {
  const i = a3.piles.findIndex(p => p.alive);
  H.apply(a3, {t:'SELECT', pile:i});
  const oldV = H.value(H.top(a3, i)), newV = H.value(a3.deck[a3.next]);
  H.apply(a3, {t:'CALL', call:['HI','LO','SPLIT'].find(c => !H.succeeds(c, oldV, newV))});
}
if (a3.phase === 'PLAY' && H.aliveCount(a3) === 1) {
  ok('the last living pile selects itself', a3.selected >= 0 && a3.piles[a3.selected].alive);
  ok('and can be called on without a pick', H.legal(a3, {t:'CALL', call:'HI'}));
}

// a Split still halts for a choice — that hold must not be auto-picked away
let a4 = null;
for (let seed = 1; seed < 400 && !a4; seed++) {
  let t = H.create(seed, 2, 2, 1), g = 0;
  while (t.phase === 'PLAY' && g++ < 60) {
    const i = t.piles.findIndex(p => p.alive);
    H.apply(t, {t:'SELECT', pile:i});
    const oldV = H.value(H.top(t, i)), newV = H.value(t.deck[t.next]);
    H.apply(t, {t:'CALL', call:['HI','LO','SPLIT'].find(c => H.succeeds(c, oldV, newV))});
    if (t.phase === 'RESURRECT') { a4 = t; break; }
  }
}
ok('a Split hold still waits for a pile to revive', !a4 || a4.selected === -1);

console.log('\n  '+pass+' passed, '+fail+' failed');
console.log('  (3x3, naive strategy: '+wins+' wins / '+losses+' losses of 600)');
process.exit(fail?1:0);
