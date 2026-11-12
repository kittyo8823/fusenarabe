import assert from 'node:assert/strict';
import * as G from '../src/game.js';
const r = G.newRoom('ABCDEF', { id: 'h', name: 'ホスト' });
G.addPlayer(r, 'a', 'A'); G.addPlayer(r, 'b', 'B');
r.settings.cards = 2;
G.deal(r);
assert.equal(r.board.length, 6);
const all = Object.values(r.hands).flat();
assert.equal(new Set(all.map((c) => c.n)).size, 6);
// place in correct order
const sorted = all.slice().sort((x, y) => x.n - y.n);
const owner = (c) => Object.keys(r.hands).find((k) => r.hands[k].includes(c));
assert.equal(G.place(r, 'a', 'nope', 0).err, 'card');
sorted.forEach((c, i) => { if (i < 5) assert.ok(G.place(r, owner(c), c.cid, i, 'ひんと').ok); });
assert.equal(G.place(r, owner(sorted[0]), sorted[0].cid, 5).err, 'placed');
assert.equal(G.place(r, owner(sorted[5]), sorted[5].cid, 0).err, 'taken');
assert.equal(r.phase, 'play');
const ps = G.publicState(r);
assert.ok(!JSON.stringify(ps).includes('"n"'), 'no numbers leak');
G.place(r, owner(sorted[5]), sorted[5].cid, 5);
assert.equal(r.phase, 'result');
assert.equal(r.result.score, 100); assert.equal(r.result.stars, 3); assert.ok(r.result.perfect);
// reversed
G.backToLobby(r); G.deal(r);
const s2 = Object.values(r.hands).flat().sort((x, y) => y.n - x.n);
s2.forEach((c, i) => G.place(r, owner(c), c.cid, i));
assert.equal(r.result.stars, 0); assert.equal(r.result.goodPairs, 0);
// early reveal with unplaced
G.backToLobby(r); G.deal(r);
const s3 = Object.values(r.hands).flat().sort((x, y) => x.n - y.n);
G.place(r, owner(s3[0]), s3[0].cid, 2); G.place(r, owner(s3[1]), s3[1].cid, 4);
G.reveal(r);
assert.equal(r.result.unplaced, 4); assert.equal(r.result.slots.length, 2); assert.ok(!r.result.perfect); assert.equal(r.result.score, 99);
// full room
const f = G.newRoom('X', { id: 'h', name: 'h' });
for (let i = 0; i < 9; i++) assert.ok(G.addPlayer(f, 'p' + i, 'p').ok);
assert.equal(G.addPlayer(f, 'z', 'z').err, 'full');
assert.equal(G.normalizeCode(' a7k-92b x'), 'A7K92B');
console.log('game tests ok');
