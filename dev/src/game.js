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
    phase: 'lobby', // lobby | play | result
    round: 0,
    settings: { cards: 1, theme: null },
    players: [{ id: host.id, name: host.name }],
    hands: {}, // playerId -> [{cid, n, slot|null}]
    board: [], // slot -> {owner, cid, hint} | null
    result: null,
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
  room.board = room.board.map((b) => (b && b.owner === id ? null : b));
}

/** カードを配る。全員の数字はすべて違う */
export function deal(room, rnd = Math.random) {
  const per = Math.max(1, Math.min(3, room.settings.cards | 0));
  const players = room.players.slice();
  const total = players.length * per;
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
    for (let c = 0; c < per; c++) room.hands[p.id].push({ cid: `${room.round}-${p.id}-${c}`, n: pool[k++], slot: null });
    room.hands[p.id].sort((a, b) => a.n - b.n);
  }
  room.board = new Array(total).fill(null);
  room.result = null;
  room.phase = 'play';
}

/** 裏向きに置く。置いたカードは変更できない */
export function place(room, pid, cid, slot, hint = '') {
  if (room.phase !== 'play') return { ok: false, err: 'phase' };
  const hand = room.hands[pid];
  const card = hand && hand.find((c) => c.cid === cid);
  if (!card) return { ok: false, err: 'card' };
  if (card.slot != null) return { ok: false, err: 'placed' };
  if (!Number.isInteger(slot) || slot < 0 || slot >= room.board.length) return { ok: false, err: 'slot' };
  if (room.board[slot]) return { ok: false, err: 'taken' };
  card.slot = slot;
  room.board[slot] = { owner: pid, cid, hint: cleanName(hint, HINT_MAX) };
  if (allPlaced(room)) reveal(room);
  return { ok: true };
}

export function allPlaced(room) {
  return room.board.length > 0 && room.board.every(Boolean);
}

/** 結果発表（全員置き終わったとき、またはホストが打ち切ったとき） */
export function reveal(room) {
  const cards = [];
  for (const [pid, hand] of Object.entries(room.hands)) for (const c of hand) if (c.slot != null) cards.push({ pid, n: c.n, slot: c.slot });
  cards.sort((a, b) => a.slot - b.slot);
  const nums = cards.map((c) => c.n);
  const sorted = nums.slice().sort((a, b) => a - b);
  // となり合う2枚が「小→大」になっている組の数
  let goodPairs = 0;
  const pairs = [];
  for (let i = 0; i + 1 < nums.length; i++) {
    const ok = nums[i] < nums[i + 1];
    pairs.push(ok);
    if (ok) goodPairs++;
  }
  // ぴったり正しい位置にあるカードの数
  const exact = nums.filter((n, i) => n === sorted[i]).length;
  const totalPairs = Math.max(1, nums.length - 1);
  const ratio = nums.length <= 1 ? 1 : goodPairs / totalPairs;
  const unplaced = Object.values(room.hands).flat().filter((c) => c.slot == null).length;
  const perfect = nums.length > 0 && exact === nums.length && unplaced === 0;
  const score = nums.length === 0 ? 0 : Math.round(((goodPairs / totalPairs) * 70 + (exact / nums.length) * 30));
  const stars = perfect ? 3 : unplaced === 0 && exact === nums.length ? 2 : ratio >= 0.8 ? 2 : ratio >= 0.5 ? 1 : 0;
  room.result = {
    slots: cards.map((c) => ({ slot: c.slot, n: c.n, owner: c.pid, hint: room.board[c.slot]?.hint || '' })),
    pairs,
    exact,
    goodPairs,
    totalPairs: nums.length - 1,
    score: perfect ? 100 : Math.min(99, score),
    stars,
    perfect,
    unplaced,
  };
  room.phase = 'result';
}

export function backToLobby(room) {
  room.phase = 'lobby';
  room.hands = {};
  room.board = [];
  room.result = null;
}

/** 全員に配る公開用の状態（他人の数字は入れない） */
export function publicState(room, now = Date.now()) {
  return {
    v: 1,
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
        placed: hand.filter((c) => c.slot != null).length,
        online: p.id === room.hostId || now - (room.seen[p.id] || 0) < 25000,
      };
    }),
    board: room.board.map((b) => (b ? { owner: b.owner, hint: b.hint } : null)),
    result: room.result,
  };
}

/** 本人にだけ送る手札 */
export function handOf(room, pid) {
  return { round: room.round, cards: (room.hands[pid] || []).map((c) => ({ cid: c.cid, n: c.n, slot: c.slot })) };
}
