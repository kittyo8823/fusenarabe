// ゲームの中心（画面・通信と独立）
// ホストの端末だけがこの状態を持ち、変更のたびに全員へ公開用の状態を配る。

export const MAX_PLAYERS = 10;
export const NAME_MAX = 10;
export const HINT_MAX = 16;
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 見間違えやすい O/0/I/1 は使わない

export function randomCode(rnd = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rnd() * CODE_CHARS.length)];
  return s;
}

export function normalizeCode(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export function cleanName(s, max = NAME_MAX) {
  return [...String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, max).join('');
}

export function newRoom(code, host) {
  return {
    v: 1,
    code,
    hostId: host.id,
    phase: 'lobby', // lobby | play | reveal
    round: 0,
    settings: { cards: 1, theme: null },
    players: [{ id: host.id, name: host.name }],
    hands: {}, // playerId -> [{cid, n, placed}]
    board: [],
    order: [],
    revealed: 0,
    seen: {}, // playerId -> 最後に通信があった時刻
  };
}

export function addPlayer(room, id, name) {
  const p = room.players.find((x) => x.id === id);
  if (p) {
    p.name = name || p.name;
    return { ok: true };
  }
  if (room.players.length >= MAX_PLAYERS) return { ok: false, err: 'full' };
  room.players.push({ id, name });
  return { ok: true };
}

export function removePlayer(room, id) {
  if (id === room.hostId) return;
  room.players = room.players.filter((p) => p.id !== id);
  delete room.hands[id];
  room.board = room.board.filter((b) => b.owner !== id);
}

/** カードを配る。全員の数字はすべて違う */
export function deal(room, rnd = Math.random) {
  const per = Math.max(1, Math.min(3, room.settings.cards | 0));
  const players = room.players.slice();
  const pool = Array.from({ length: 100 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  room.round += 1;
  room.hands = {};
  let k = 0;
  for (const p of players) {
    room.hands[p.id] = [];
    for (let c = 0; c < per; c++) room.hands[p.id].push({ cid: `${room.round}-${p.id}-${c}`, n: pool[k++], placed: false });
    room.hands[p.id].sort((a, b) => a.n - b.n);
  }
  room.board = []; // 置いた順 {owner, cid, hint, x, y}
  room.order = []; // めくる順（左から）の cid
  room.revealed = 0;
  room.phase = 'play';
}

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);

/** カード置き場の好きな位置（x: 0=左=1寄り, 1=右=100寄り）に裏向きで置く */
export function place(room, pid, cid, x, y, hint = '') {
  if (room.phase !== 'play') return { ok: false, err: 'phase' };
  const hand = room.hands[pid];
  const card = hand && hand.find((c) => c.cid === cid);
  if (!card) return { ok: false, err: 'card' };
  if (card.placed) return { ok: false, err: 'placed' };
  card.placed = true;
  room.board.push({ owner: pid, cid, hint: cleanName(hint, HINT_MAX), x: clamp01(+x), y: clamp01(+y) });
  return { ok: true };
}

/** 置いたカードを動かす（誰のカードでも）・ヒントを書き直す（本人だけ）。めくり始めるまでは何度でも */
export function update(room, pid, cid, patch = {}) {
  if (room.phase !== 'play') return { ok: false, err: 'phase' };
  const i = room.board.findIndex((b) => b.cid === cid);
  if (i < 0 || !room.players.some((p) => p.id === pid)) return { ok: false, err: 'card' };
  const b = room.board[i];
  // 場所は誰でも動かせる。ヒントは本人だけ
  if (patch.hint != null && b.owner !== pid) return { ok: false, err: 'owner' };
  if (patch.hint != null) b.hint = cleanName(patch.hint, HINT_MAX);
  if (patch.x != null || patch.y != null) {
    b.x = clamp01(+patch.x);
    b.y = clamp01(+patch.y);
    // 動かしたカードを一番上に
    room.board.splice(i, 1);
    room.board.push(b);
  }
  return { ok: true };
}

export function allPlaced(room) {
  const cards = Object.values(room.hands).flat();
  return cards.length > 0 && cards.every((c) => c.placed);
}

/** めくり始める。左にあるカードから順番 */
export function startReveal(room) {
  if (room.phase !== 'play' || !room.board.length) return false;
  room.order = room.board
    .slice()
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((b) => b.cid);
  room.revealed = 0;
  room.phase = 'reveal';
  return true;
}

/** ホストがボタンを押すたびに1枚めくる */
export function flipNext(room) {
  if (room.phase !== 'reveal' || room.revealed >= room.order.length) return false;
  room.revealed += 1;
  return true;
}

export function backToLobby(room) {
  room.phase = 'lobby';
  room.hands = {};
  room.board = [];
  room.order = [];
  room.revealed = 0;
}

function numberOf(room, cid) {
  for (const hand of Object.values(room.hands)) for (const c of hand) if (c.cid === cid) return c.n;
  return null;
}

/** 全員に配る公開用の状態（めくられていないカードの数字は入れない） */
export function publicState(room, now = Date.now()) {
  const order = room.order || [];
  return {
    v: 2,
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    settings: room.settings,
    players: room.players.map((p) => {
      const hand = room.hands[p.id] || [];
      return {
        id: p.id,
        name: p.name,
        total: hand.length,
        placed: hand.filter((c) => c.placed).length,
        online: p.id === room.hostId || now - (room.seen[p.id] || 0) < 25000,
      };
    }),
    board: room.board.map((b) => {
      const i = order.indexOf(b.cid);
      const o = { cid: b.cid, owner: b.owner, hint: b.hint, x: b.x, y: b.y };
      if (i >= 0) o.turn = i + 1; // めくる順番
      if (i >= 0 && i < room.revealed) o.n = numberOf(room, b.cid);
      return o;
    }),
    total: Object.values(room.hands).flat().length,
    revealed: room.revealed || 0,
    toReveal: order.length,
  };
}

/** 本人にだけ送る手札 */
export function handOf(room, pid) {
  return { round: room.round, cards: (room.hands[pid] || []).map((c) => ({ cid: c.cid, n: c.n, placed: c.placed })) };
}
