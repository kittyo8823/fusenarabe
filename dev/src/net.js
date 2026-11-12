// 通信：公開の MQTT 中継サーバー経由で、部屋の全員と状態をやり取りする
// ホストが部屋の状態を持ち、変更のたびに全員へ配る（retain で途中参加・再読み込みにも対応）。
/* global mqtt */
import { newRoom, addPlayer, removePlayer, deal, place, reveal, backToLobby, publicState, handOf, randomCode } from './game.js';

const DEFAULT_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const PREFIX = 'fusenarabe/v1/';

export function brokers() {
  const q = new URLSearchParams(location.search).get('broker');
  return q ? [q] : DEFAULT_BROKERS;
}

/** つながる中継サーバーを順に試す */
export async function connect(urls = brokers()) {
  let lastErr;
  for (const url of urls) {
    try {
      const client = await new Promise((resolve, reject) => {
        const c = mqtt.connect(url, { reconnectPeriod: 2000, connectTimeout: 7000, clean: true, keepalive: 30 });
        const t = setTimeout(() => {
          c.end(true);
          reject(new Error('timeout'));
        }, 8000);
        c.once('connect', () => {
          clearTimeout(t);
          resolve(c);
        });
        c.once('error', (e) => {
          clearTimeout(t);
          c.end(true);
          reject(e);
        });
      });
      return client;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('connect failed');
}

const topics = (code) => ({
  state: `${PREFIX}${code}/state`,
  act: `${PREFIX}${code}/act`,
  hand: (pid) => `${PREFIX}${code}/hand/${pid}`,
});

function waitRetained(client, topic, ms) {
  return new Promise((resolve) => {
    const onMsg = (t, payload) => {
      if (t !== topic) return;
      done(payload.length ? safeParse(payload.toString()) : null);
    };
    const done = (v) => {
      clearTimeout(timer);
      client.removeListener('message', onMsg);
      client.unsubscribe(topic);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), ms);
    client.on('message', onMsg);
    client.subscribe(topic, { qos: 1 });
  });
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * 部屋（ホスト・参加者共通の窓口）
 *  onState(cb) / onHand(cb) で画面に反映し、place() などで操作する。
 */
class Room {
  constructor(client, code, me) {
    this.client = client;
    this.code = code;
    this.me = me;
    this.t = topics(code);
    this.stateCbs = [];
    this.handCbs = [];
    this.state = null;
    this.hand = { round: 0, cards: [] };
  }
  onState(cb) {
    this.stateCbs.push(cb);
    if (this.state) cb(this.state);
  }
  onHand(cb) {
    this.handCbs.push(cb);
    cb(this.hand);
  }
  emitState(s) {
    this.state = s;
    for (const cb of this.stateCbs) cb(s);
  }
  emitHand(h) {
    this.hand = h;
    for (const cb of this.handCbs) cb(h);
  }
}

export class HostRoom extends Room {
  constructor(client, room, me) {
    super(client, room.code, me);
    this.room = room;
    this.isHost = true;
    this.lastHands = {};
    this.client.on('message', (topic, payload) => {
      if (topic !== this.t.act) return;
      const a = safeParse(payload.toString());
      if (a && typeof a.id === 'string') this.handleAct(a);
    });
    this.client.subscribe(this.t.act, { qos: 1 });
    this.client.on('connect', () => this.publish());
    // 接続状況の表示を更新し、念のため定期的に配り直す
    this.timer = setInterval(() => this.publish(), 10000);
    this.publish();
  }

  static async create(client, me, saved = null) {
    let code = saved && saved.code;
    if (!code) {
      for (let i = 0; i < 5; i++) {
        code = randomCode();
        const exists = await waitRetained(client, topics(code).state, 1200);
        if (!exists) break;
      }
    }
    const room = saved || newRoom(code, me);
    return new HostRoom(client, room, me);
  }

  handleAct(a) {
    if (this.closed) return;
    const r = this.room;
    r.seen[a.id] = Date.now();
    let changed = false;
    if (a.type === 'join') {
      const res = addPlayer(r, a.id, String(a.name || '').slice(0, 20));
      changed = true;
      if (!res.ok) this.client.publish(this.t.hand(a.id), JSON.stringify({ error: res.err }), { qos: 1 });
    } else if (a.type === 'place') {
      const res = place(r, a.id, a.cid, a.slot, a.hint);
      if (res.ok) changed = true;
      else this.client.publish(this.t.hand(a.id), JSON.stringify({ error: res.err, cid: a.cid }), { qos: 1 });
    } else if (a.type === 'leave') {
      if (r.phase === 'lobby') removePlayer(r, a.id);
      changed = true;
    } else if (a.type === 'ping') {
      changed = false;
    }
    if (changed) this.publish();
  }

  publish() {
    if (this.closed) return;
    const r = this.room;
    const s = publicState(r);
    this.client.publish(this.t.state, JSON.stringify(s), { qos: 1, retain: true });
    for (const p of r.players) {
      const h = handOf(r, p.id);
      const key = JSON.stringify(h);
      if (this.lastHands[p.id] !== key) {
        this.lastHands[p.id] = key;
        if (p.id !== this.me.id) this.client.publish(this.t.hand(p.id), key, { qos: 1, retain: true });
      }
    }
    this.emitState(s);
    this.emitHand(handOf(r, this.me.id));
    try {
      localStorage.setItem('fusenarabe.host', JSON.stringify({ at: Date.now(), room: r }));
    } catch {
      /* ignore */
    }
  }

  // --- ホストの操作 ---
  setSettings(patch) {
    if (this.room.phase !== 'lobby') return;
    Object.assign(this.room.settings, patch);
    this.publish();
  }
  start() {
    deal(this.room);
    this.lastHands = {};
    this.publish();
  }
  revealNow() {
    if (this.room.phase === 'play') {
      reveal(this.room);
      this.publish();
    }
  }
  rematch() {
    backToLobby(this.room);
    this.publish();
  }
  kick(pid) {
    removePlayer(this.room, pid);
    this.publish();
  }
  place(cid, slot, hint) {
    const res = place(this.room, this.me.id, cid, slot, hint);
    this.publish();
    return res;
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    // 部屋を消す（残っている状態を空にする）
    this.client.publish(this.t.state, '', { qos: 1, retain: true });
    for (const p of this.room.players) this.client.publish(this.t.hand(p.id), '', { qos: 1, retain: true });
    try {
      localStorage.removeItem('fusenarabe.host');
    } catch {
      /* ignore */
    }
    setTimeout(() => this.client.end(), 300);
  }
}

export class GuestRoom extends Room {
  constructor(client, code, me) {
    super(client, code, me);
    this.isHost = false;
    this.client.on('message', (topic, payload) => {
      if (this.closed) return;
      const s = payload.length ? safeParse(payload.toString()) : null;
      if (topic === this.t.state) {
        if (!s) return this.onClosed && this.onClosed();
        this.emitState(s);
      } else if (topic === this.t.hand(me.id) && s) {
        if (s.error && this.onError) this.onError(s.error, s.cid);
        if (s.cards) this.emitHand({ round: s.round, cards: s.cards });
      }
    });
  }

  /** 部屋に参加する。存在しない部屋なら 'notfound' */
  static async join(client, code, me) {
    const st = await waitRetained(client, topics(code).state, 6000);
    if (!st) throw new Error('notfound');
    const room = new GuestRoom(client, code, me);
    client.subscribe([room.t.state, room.t.hand(me.id)], { qos: 1 });
    room.send({ type: 'join', name: me.name });
    // 参加者一覧に自分が入るのを待つ
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 8000);
      room.onError = (err) => {
        if (err === 'full') {
          clearTimeout(t);
          reject(new Error('full'));
        }
      };
      room.onState((s) => {
        if (s.players.some((p) => p.id === me.id)) {
          clearTimeout(t);
          resolve();
        }
      });
    });
    room.ping = setInterval(() => room.send({ type: 'ping' }), 8000);
    return room;
  }

  send(a) {
    this.client.publish(this.t.act, JSON.stringify({ ...a, id: this.me.id }), { qos: 1 });
  }
  place(cid, slot, hint) {
    this.send({ type: 'place', cid, slot, hint });
    return { ok: true, pending: true };
  }
  leave(silent = false) {
    this.closed = true;
    clearInterval(this.ping);
    if (!silent) this.send({ type: 'leave' });
    setTimeout(() => this.client.end(), 300);
  }
}
