// ふせならべ：画面
import { connect, HostRoom, GuestRoom } from './net.js';
import { normalizeCode, cleanName, NAME_MAX, HINT_MAX, MAX_PLAYERS } from './game.js';
import { GENRES, pickTheme } from './themes.js';

// ---------- 小道具 ----------
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
};
const load = (k) => {
  try {
    return JSON.parse(localStorage.getItem('fusenarabe.' + k));
  } catch {
    return null;
  }
};
const save = (k, v) => {
  try {
    if (v == null) localStorage.removeItem('fusenarabe.' + k);
    else localStorage.setItem('fusenarabe.' + k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};
function myId() {
  let id = load('id');
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
    save('id', id);
  }
  return id;
}
const COLORS = ['#ff7a59', '#4cb5ff', '#ffc53d', '#7bd88f', '#c38bff', '#ff6fae', '#38d6c9', '#a3a3ff', '#ffa94d', '#9ccc65'];
const app = document.getElementById('app');
const sheetRoot = document.getElementById('sheet');
const toastRoot = document.getElementById('toasts');

function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  toastRoot.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => t.classList.remove('in'), 2600);
  setTimeout(() => t.remove(), 3000);
}
function busy(msg) {
  let b = document.getElementById('busy');
  if (!msg) return b && b.remove();
  if (!b) {
    b = h('div', { id: 'busy' }, h('div', { class: 'spin' }), h('div', { class: 'busy-msg' }));
    document.body.append(b);
  }
  b.querySelector('.busy-msg').textContent = msg;
}
function openSheet(content) {
  sheetRoot.textContent = '';
  const panel = h('div', { class: 'sheet-panel' }, content);
  const bg = h('div', { class: 'sheet-bg', onclick: closeSheet });
  sheetRoot.append(bg, panel);
  sheetRoot.classList.add('open');
  return panel;
}
function closeSheet() {
  sheetRoot.classList.remove('open');
  sheetRoot.textContent = '';
}
function confirmSheet(title, body, okLabel, onOk, danger = false) {
  openSheet([
    h('div', { class: 'sheet-title' }, title),
    body ? h('p', { class: 'sheet-body' }, body) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: closeSheet }, 'やめる'), h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => (closeSheet(), onOk()) }, okLabel)),
  ]);
}

// ---------- 状態 ----------
const S = { room: null, st: null, hand: { round: 0, cards: [] }, sel: null, pending: {}, genre: 'すべて', animRound: null, lastStateAt: 0, key: '' };
const isHost = () => S.room && S.room.isHost;
const me = () => S.room && S.room.me;
const nameOf = (id) => (S.st.players.find((p) => p.id === id) || { name: '（退出）' }).name;
const colorOf = (id) => {
  const i = S.st.players.findIndex((p) => p.id === id);
  return COLORS[(i < 0 ? 9 : i) % COLORS.length];
};

function inviteUrl(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  const b = new URLSearchParams(location.search).get('broker');
  if (b) u.searchParams.set('broker', b);
  u.searchParams.set('room', code);
  return u.toString();
}
function setUrlRoom(code) {
  const u = new URL(location.href);
  if (code) u.searchParams.set('room', code);
  else u.searchParams.delete('room');
  history.replaceState(null, '', u);
}

// ---------- タイトル ----------
function renderTitle(msg) {
  S.key = '';
  app.className = 'scr-title';
  app.textContent = '';
  const params = new URLSearchParams(location.search);
  const nameIn = h('input', { class: 'in', maxlength: NAME_MAX, placeholder: 'ニックネーム', value: load('name') || '', autocomplete: 'nickname', enterkeyhint: 'done' });
  const codeIn = h('input', { class: 'in code', maxlength: 6, placeholder: 'A7K92B', value: normalizeCode(params.get('room') || ''), autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go' });
  codeIn.addEventListener('input', () => {
    const p = codeIn.selectionStart;
    codeIn.value = normalizeCode(codeIn.value);
    codeIn.setSelectionRange(p, p);
  });
  const err = h('div', { class: 'err' }, msg || '');
  const getName = () => {
    const n = cleanName(nameIn.value);
    if (!n) {
      err.textContent = 'ニックネームを入れてください';
      nameIn.focus();
      return null;
    }
    save('name', n);
    return n;
  };
  const doJoin = () => {
    const n = getName();
    if (!n) return;
    const c = normalizeCode(codeIn.value);
    if (c.length !== 6) {
      err.textContent = '部屋コードは6文字です';
      codeIn.focus();
      return;
    }
    joinRoom(c, n);
  };
  codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && doJoin());

  // 前の部屋に戻る
  const resume = [];
  const hostSave = load('host');
  if (hostSave && Date.now() - hostSave.at < 6 * 3600e3 && hostSave.room && hostSave.room.hostId === myId()) {
    resume.push(h('button', { class: 'btn resume', onclick: () => createRoom(hostSave.room.players[0].name, hostSave.room) }, `部屋 ${hostSave.room.code} を再開する（ホスト）`));
  }
  const last = load('last');
  if (last && Date.now() - last.at < 6 * 3600e3 && (!hostSave || last.code !== hostSave.room?.code)) {
    resume.push(h('button', { class: 'btn resume', onclick: () => joinRoom(last.code, load('name') || 'ゲスト') }, `部屋 ${last.code} に戻る`));
  }

  const invited = codeIn.value.length === 6;
  app.append(
    h(
      'div',
      { class: 'title-wrap' },
      h('div', { class: 'logo' }, logoCards(), h('h1', null, 'ふせならべ'), h('p', { class: 'tag' }, '数字はナイショ。ことばで察して、ふせて並べろ。')),
      h(
        'div',
        { class: 'panel' },
        h('label', { class: 'lbl' }, 'ニックネーム'),
        nameIn,
        invited
          ? null
          : h('button', {
              class: 'btn primary big',
              onclick: () => {
                const n = getName();
                if (n) createRoom(n);
              },
            }, '部屋を作る'),
        invited ? null : h('div', { class: 'or' }, h('span', null, 'または')),
        h('label', { class: 'lbl' }, '部屋コード'),
        h('div', { class: 'join-row' }, codeIn, h('button', { class: `btn ${invited ? 'primary' : 'sub'}`, onclick: doJoin }, '参加する')),
        invited ? h('button', { class: 'linkbtn', onclick: () => (setUrlRoom(null), renderTitle()) }, '自分で部屋を作る') : null,
        err,
        resume.length ? h('div', { class: 'resume-box' }, resume) : null
      ),
      h('details', { class: 'rules' }, h('summary', null, 'あそびかた'), rulesBody())
    )
  );
  if (!nameIn.value) nameIn.focus();
}

function logoCards() {
  return h('div', { class: 'logo-cards' }, ['?', '?', '?'].map((q, i) => h('div', { class: `mini-card c${i}` }, h('span', null, q))));
}
function rulesBody() {
  return h(
    'ol',
    { class: 'rules-list' },
    h('li', null, '1〜100の数字カードが、ひとり1〜3枚ずつ配られます（全員ちがう数字）。'),
    h('li', null, 'お題が出ます。たとえば「無人島に持っていくもの」なら、1＝いらない、100＝絶対ほしい。'),
    h('li', null, '自分の数字に合う「ことば」をヒントにして、カードを裏向きのままカード置き場にスワイプして置きます。左ほど小さく（1）、右ほど大きい（100）。'),
    h('li', null, '置く場所もタイミングも自由。置いたあとも、自分のカードはドラッグで動かせて、タップでヒントも変えられます。'),
    h('li', null, '並びが決まったらホストが「置き終わった！」。そのあと「めくる」を押すたびに左から1枚ずつめくれます。うまく並んだかはみんなで判定！')
  );
}

// ---------- 接続 ----------
async function createRoom(name, saved = null) {
  busy('部屋を作っています…');
  try {
    const client = await connect();
    const room = await HostRoom.create(client, { id: myId(), name }, saved);
    if (!room.room.settings.theme) room.setSettings({ theme: pickTheme() });
    enterRoom(room);
  } catch (e) {
    console.error(e);
    renderTitle('サーバーにつながりませんでした。通信を確認してもう一度ためしてください');
  } finally {
    busy();
  }
}

async function joinRoom(code, name) {
  busy(`部屋 ${code} をさがしています…`);
  let client;
  try {
    client = await connect();
    const room = await GuestRoom.join(client, code, { id: myId(), name });
    enterRoom(room);
  } catch (e) {
    if (client) client.end(true);
    const m = String(e && e.message);
    if (m === 'notfound') {
      if (load('last')?.code === code) save('last', null);
      renderTitle('部屋が見つかりません。コードを確かめてください');
    } else if (m === 'full') renderTitle(`満員です（最大${MAX_PLAYERS}人）`);
    else if (m === 'timeout') renderTitle('ホストから返事がありません。もう一度ためしてください');
    else renderTitle('サーバーにつながりませんでした。通信を確認してもう一度ためしてください');
  } finally {
    busy();
  }
}

function enterRoom(room) {
  S.room = room;
  S.st = null;
  S.sel = null;
  S.pending = {};
  S.drop = null;
  S.moved = {};
  S.lift = null;
  S.key = '';
  setUrlRoom(room.code);
  if (!room.isHost) save('last', { code: room.code, at: Date.now() });
  room.onState((st) => {
    if (S.room !== room) return;
    S.st = st;
    S.lastStateAt = Date.now();
    if (!room.isHost && !st.players.some((p) => p.id === room.me.id)) {
      leaveToTitle('部屋から外れました');
      return;
    }
    render();
  });
  room.onHand((hd) => {
    if (S.room !== room) return;
    if (hd.round !== S.hand.round) {
      S.sel = null;
      S.pending = {};
    }
    S.hand = hd;
    for (const c of hd.cards) if (c.placed) delete S.pending[c.cid];
    if (S.sel && hd.cards.find((c) => c.cid === S.sel && c.placed)) S.sel = null;
    render();
  });
  if (!room.isHost) {
    room.onError = (err, cid) => {
      if (cid) delete S.pending[cid];
      S.key = '';
      toast(err === 'phase' ? 'もうめくり始めています' : '置けませんでした', 'warn');
      render();
    };
    room.onClosed = () => S.room === room && leaveToTitle('ホストが部屋を解散しました', true);
  }
}

function leaveToTitle(msg, silent = false) {
  const r = S.room;
  S.room = null;
  S.st = null;
  closeSheet();
  if (r) {
    if (r.isHost) r.close();
    else {
      save('last', null);
      r.leave(silent);
    }
  }
  setUrlRoom(null);
  renderTitle(msg);
}

// ホストのページが閉じられそうなとき
window.addEventListener('beforeunload', (e) => {
  if (isHost() && S.st && S.st.players.length > 1) {
    e.preventDefault();
    e.returnValue = '';
  }
});
// ホストからの更新が途絶えたら知らせる
setInterval(() => {
  if (!S.room || isHost() || !S.st) return;
  const lost = Date.now() - S.lastStateAt > 32000;
  document.body.classList.toggle('host-lost', lost);
}, 3000);

// ---------- 部屋の画面 ----------
function render() {
  if (!S.room || !S.st) return;
  const key = JSON.stringify([S.st, S.hand, S.sel, S.pending, S.drop, S.moved, S.lift, S.genre]);
  if (key === S.key) return;
  S.key = key;
  const y = window.scrollY;
  app.textContent = '';
  app.className = `scr-${S.st.phase === 'lobby' ? 'lobby' : 'table'}`;
  app.append(topBar());
  if (S.st.phase === 'lobby') renderLobby();
  else renderTable();
  window.scrollTo(0, y);
}

function topBar() {
  return h(
    'header',
    { class: 'top' },
    h('div', { class: 'brand' }, 'ふせならべ'),
    h('button', { class: 'code-chip', onclick: share, title: '招待する' }, h('small', null, '部屋'), S.st.code),
    h(
      'button',
      {
        class: 'linkbtn top-exit',
        onclick: () =>
          isHost()
            ? confirmSheet('部屋を解散しますか？', '参加している全員がタイトルに戻ります。', '解散する', () => leaveToTitle(), true)
            : confirmSheet('部屋から出ますか？', 'あとで同じコードで戻ってこられます。', '出る', () => leaveToTitle()),
      },
      isHost() ? '解散' : '退出'
    ),
    h('div', { class: 'lost-banner' }, 'ホストとの通信が止まっています…（ホストの画面が閉じていないか確認してね）')
  );
}

async function share() {
  const url = inviteUrl(S.st.code);
  const text = `「ふせならべ」で遊ぼう！ 部屋コード：${S.st.code}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'ふせならべ', text, url });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('招待リンクをコピーしました');
  } catch {
    openSheet([h('div', { class: 'sheet-title' }, '招待リンク'), h('textarea', { class: 'in', rows: 3, readonly: true }, url), h('button', { class: 'btn ghost', onclick: closeSheet }, '閉じる')]);
  }
}

function playerList(mode) {
  const st = S.st;
  return h(
    'ul',
    { class: `players ${mode}` },
    st.players.map((p, i) => {
      const done = p.total > 0 && p.placed === p.total;
      return h(
        'li',
        { class: `${p.online ? '' : 'off'} ${done ? 'done' : ''} ${p.id === me().id ? 'me' : ''}` },
        h('span', { class: 'dot', style: `--c:${COLORS[i % COLORS.length]}` }),
        h('span', { class: 'pname' }, p.name),
        p.id === st.hostId && mode !== 'play' ? h('span', { class: 'badge' }, 'ホスト') : null,
        p.id === me().id && mode !== 'play' ? h('span', { class: 'badge you' }, 'あなた') : null,
        !p.online ? h('span', { class: 'badge off' }, '通信なし') : null,
        mode === 'play' ? h('span', { class: 'pcount' }, p.total === 0 ? '観戦' : done ? '置いた！' : `${p.placed}/${p.total}`) : null,
        mode === 'lobby' && isHost() && p.id !== st.hostId
          ? h('button', { class: 'kick', 'aria-label': `${p.name}を外す`, onclick: () => confirmSheet(`${p.name} さんを外しますか？`, null, '外す', () => S.room.kick(p.id), true) }, '×')
          : null
      );
    })
  );
}

function themeCard(theme, big = false) {
  if (!theme) return h('div', { class: 'theme-card empty' }, 'お題はまだありません');
  return h(
    'div',
    { class: `theme-card ${big ? 'big' : ''}` },
    h('div', { class: 'theme-label' }, 'お題'),
    h('div', { class: 'theme-title' }, theme.title),
    h('div', { class: 'scale' }, h('span', { class: 'lo' }, h('b', null, '1'), theme.lo), h('span', { class: 'bar' }), h('span', { class: 'hi' }, theme.hi, h('b', null, '100')))
  );
}

// ---------- ロビー ----------
function renderLobby() {
  const st = S.st;
  const host = isHost();
  const sec = [];
  sec.push(
    h(
      'section',
      { class: 'card-sec invite' },
      h('div', { class: 'inv-code' }, h('small', null, '部屋コード'), h('strong', null, st.code)),
      h('button', { class: 'btn primary', onclick: share }, '友だちを招待')
    )
  );
  sec.push(h('section', { class: 'card-sec' }, h('h2', null, `メンバー `, h('small', null, `${st.players.length}/${MAX_PLAYERS}人`)), playerList('lobby')));

  const th = h('section', { class: 'card-sec' }, h('h2', null, 'お題'), themeCard(st.settings.theme, true));
  if (host) {
    th.append(
      h('div', { class: 'genres' }, GENRES.map((g) => h('button', { class: `chip ${S.genre === g ? 'on' : ''}`, onclick: () => ((S.genre = g), render()) }, g))),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn gacha', onclick: gacha }, '🎲 お題ガチャ'),
        h('button', { class: 'btn ghost', onclick: customTheme }, '✏️ 自分で書く')
      )
    );
  }
  sec.push(th);

  const per = st.settings.cards || 1;
  sec.push(
    h(
      'section',
      { class: 'card-sec' },
      h('h2', null, 'ひとりのカード枚数'),
      host
        ? h('div', { class: 'seg' }, [1, 2, 3].map((n) => h('button', { class: per === n ? 'on' : '', onclick: () => S.room.setSettings({ cards: n }) }, `${n}枚`)))
        : h('div', { class: 'seg readonly' }, h('span', { class: 'on' }, `${per}枚`)),
      h('p', { class: 'note' }, `全部で ${st.players.length * per} 枚を並べます`)
    )
  );
  sec.push(h('details', { class: 'rules card-sec' }, h('summary', null, 'あそびかた'), rulesBody()));
  app.append(h('main', { class: 'lobby' }, sec));
  app.append(
    h(
      'div',
      { class: 'dock' },
      host
        ? h(
            'button',
            {
              class: 'btn primary big',
              onclick: () => {
                if (!S.st.settings.theme) S.room.setSettings({ theme: pickTheme(S.genre) });
                if (S.st.players.length < 2) confirmSheet('ひとりで始めますか？', 'ふつうは2人以上で遊びます。友だちを招待するなら上のボタンからどうぞ。', 'ひとりで試す', () => S.room.start());
                else S.room.start();
              },
            },
            'ゲームを始める'
          )
        : h('div', { class: 'waiting' }, h('span', { class: 'spin small' }), 'ホストが始めるのを待っています')
    )
  );
}

function gacha() {
  const cur = S.st.settings.theme;
  const t = pickTheme(S.genre, cur && cur.title);
  S.room.setSettings({ theme: t });
  requestAnimationFrame(() => {
    const c = document.querySelector('.theme-card');
    if (c) c.classList.add('pop');
  });
}

function customTheme() {
  const cur = S.st.settings.theme || {};
  const t = h('input', { class: 'in', maxlength: 30, placeholder: '例：好きな季節のイベント', value: cur.custom ? cur.title : '' });
  const lo = h('input', { class: 'in', maxlength: 12, placeholder: '例：きらい', value: cur.custom ? cur.lo : '' });
  const hi = h('input', { class: 'in', maxlength: 12, placeholder: '例：大好き', value: cur.custom ? cur.hi : '' });
  openSheet([
    h('div', { class: 'sheet-title' }, 'お題を自分で書く'),
    h('label', { class: 'lbl' }, 'お題'),
    t,
    h('div', { class: 'row two' }, h('div', null, h('label', { class: 'lbl' }, '1に近いほど'), lo), h('div', null, h('label', { class: 'lbl' }, '100に近いほど'), hi)),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn ghost', onclick: closeSheet }, 'やめる'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            const title = cleanName(t.value, 30);
            if (!title) return t.focus();
            S.room.setSettings({ theme: { genre: '自作', title, lo: cleanName(lo.value, 12) || '小さい', hi: cleanName(hi.value, 12) || '大きい', custom: true } });
            closeSheet();
          },
        },
        'これにする'
      )
    ),
  ]);
  t.focus();
}

// ---------- カード置き場（ゲーム中・めくり） ----------
const CW = 50; // カードの幅
const CH = 96; // カード＋ヒントの高さ
S.flipSeen = new Set();

function renderTable() {
  const st = S.st;
  const theme = st.settings.theme;
  const playing = st.phase === 'play';
  const myCards = S.hand.round === st.round ? S.hand.cards : [];
  const unplaced = myCards.filter((c) => !c.placed && S.pending[c.cid] == null);
  if (S.sel && !unplaced.find((c) => c.cid === S.sel)) S.sel = null;
  if (!playing) {
    S.sel = null;
    S.drop = null;
  }
  const myNum = new Map(myCards.map((c) => [c.cid, c.n]));
  const nextTurn = st.revealed + 1;
  const done = st.phase === 'reveal' && st.revealed >= st.toReveal;

  // カード置き場
  const table = h('div', { class: `table ${S.sel && playing ? 'aim' : ''}`, id: 'table' });
  table.append(h('div', { class: 'axis' }, h('span', { class: 'ax lo' }, h('b', null, '1'), theme ? theme.lo : '小さい'), h('span', { class: 'ax hi' }, theme ? theme.hi : '大きい', h('b', null, '100'))));
  if (!st.board.length && playing) table.append(h('div', { class: 'table-empty' }, '手札のカードをここにスワイプ', h('br'), h('small', null, '左ほど 1、右ほど 100')));
  const now = Date.now();
  st.board.forEach((b, i) => {
    const mine = b.owner === me().id;
    const mv = S.moved[b.cid];
    if (mv) {
      if (!playing || (Math.abs(mv.x - b.x) < 1e-6 && Math.abs(mv.y - b.y) < 1e-6) || now - mv.at > 6000) delete S.moved[b.cid];
      else b = { ...b, x: mv.x, y: mv.y };
    }
    const grab = playing && mine;
    const flipped = b.n != null;
    const fresh = flipped && !S.flipSeen.has(b.cid);
    if (flipped) S.flipSeen.add(b.cid);
    const card = h(
      'div',
      { class: `tcard ${mine ? 'mine' : ''} ${grab ? 'grab' : ''} ${S.lift === b.cid ? 'lifted' : ''} ${mv ? 'top' : ''} ${flipped ? 'up' : ''} ${fresh ? 'fresh' : ''} ${!playing && !flipped && b.turn === nextTurn ? 'next' : ''}`, style: `${pos(b.x, b.y)};--c:${colorOf(b.owner)};z-index:${flipped ? 200 + i : 10 + i}` },
      h('div', { class: 'face2' }, flipped ? h('span', { class: 'big-n' }, b.n) : mine ? h('span', { class: 'num' }, myNum.get(b.cid) ?? '') : null),
      !playing && b.turn ? h('span', { class: 'turn' }, b.turn) : null,
      h('div', { class: 'thint' }, b.hint || h('span', { class: 'nohint' }, nameOf(b.owner))),
      b.hint ? h('div', { class: 'towner' }, nameOf(b.owner)) : null
    );
    if (grab) tableDrag(card, b);
    table.append(card);
  });
  for (const [cid, p] of Object.entries(S.pending)) {
    table.append(h('div', { class: 'tcard mine pending', style: `${pos(p.x, p.y)};--c:${colorOf(me().id)}` }, h('div', { class: 'face2' }, h('span', { class: 'num' }, myNum.get(cid) ?? '')), h('div', { class: 'thint' }, '置いています…')));
  }
  if (S.drop) table.append(h('div', { class: 'tcard mine preview', style: `${pos(S.drop.x, S.drop.y)};--c:${colorOf(me().id)}` }, h('div', { class: 'face2' }, h('span', { class: 'num' }, myNum.get(S.drop.cid) ?? ''))));
  if (playing) {
    table.addEventListener('click', (e) => {
      if (!S.sel || e.target.closest('.tcard')) return;
      const p = tablePoint(e.clientX, e.clientY);
      if (p) askPlace(S.sel, p.x, p.y);
    });
  }

  const placedAll = st.players.reduce((a, p) => a + p.placed, 0);
  const status = h(
    'div',
    { class: 'pstrip' },
    st.players.map((p, i) => {
      const fin = p.total > 0 && p.placed === p.total;
      return h('span', { class: `pchip ${p.online ? '' : 'off'} ${fin ? 'done' : ''} ${p.id === me().id ? 'me' : ''}` }, h('i', { style: `--c:${COLORS[i % COLORS.length]}` }), p.name, h('small', null, p.total === 0 ? '観戦' : fin ? '✓' : `${p.placed}/${p.total}`));
    })
  );

  app.append(
    h(
      'main',
      { class: 'tablewrap' },
      h('div', { class: 'theme-mini' }, h('small', null, 'お題'), theme ? theme.title : ''),
      status,
      h('div', { class: 'progress-row' }, playing ? (placedAll >= st.total ? '全員置いた！ 話し合って並びを調整しよう' : `置いたカード ${placedAll}/${st.total}`) : done ? 'ぜんぶめくれた！ うまく並んだ？' : `めくったカード ${st.revealed}/${st.toReveal}`, h('span', { class: 'progress' }, h('i', { style: `width:${playing ? (placedAll / Math.max(1, st.total)) * 100 : (st.revealed / Math.max(1, st.toReveal)) * 100}%` }))),
      table
    )
  );

  // 下の操作バー
  const dock = h('div', { class: 'dock' });
  const left = unplaced.length;
  const finishBtn = (big) =>
    h(
      'button',
      {
        class: big ? 'btn primary big flipbtn' : 'linkbtn block',
        onclick: () =>
          placedAll < st.total
            ? confirmSheet('まだ置いていない人がいます', '置くのを終わりにしますか？ 置かれていないカードはめくりません。並びはもう動かせなくなります。', '終わりにする', () => S.room.startReveal())
            : confirmSheet('置き終わった？', '並びを確定して、めくる準備をします。もう動かせなくなります。', '確定する', () => S.room.startReveal()),
      },
      big ? ['置き終わった！', h('small', null, '押すと並びが確定して、めくれるようになります')] : '置くのを終わりにする（ホスト）'
    );
  if (playing && left) {
    dock.append(
      h('div', { class: 'dock-head' }, S.sel ? 'カード置き場をタップしても置けます' : 'カードを上にスワイプして置こう'),
      h(
        'div',
        { class: 'hand' },
        myCards.map((c) => {
          const placed = c.placed || S.pending[c.cid] != null || (S.drop && S.drop.cid === c.cid);
          const el = h('button', { class: `hcard ${placed ? 'placed' : ''} ${S.sel === c.cid ? 'sel' : ''}`, style: `--c:${colorOf(me().id)}`, disabled: placed }, h('span', { class: 'n' }, c.n), h('span', { class: 'sub' }, placed ? '置いた' : S.sel === c.cid ? '選択中' : 'スワイプ'));
          if (!placed) dragSource(el, c);
          return el;
        })
      ),
      isHost() ? finishBtn(false) : null
    );
  } else if (playing) {
    const tip = myCards.length ? h('div', { class: 'dock-head' }, '置いたカードはドラッグで移動、タップでヒント変更') : null;
    if (isHost()) dock.append(tip, finishBtn(true));
    else dock.append(tip, h('div', { class: 'waiting' }, myCards.length ? 'ホストが「置き終わった」を押すまで動かせます' : '途中参加なので、次のラウンドから遊べます'));
  } else if (!done) {
    dock.append(
      isHost()
        ? h('button', { class: 'btn primary big flipbtn', onclick: () => S.room.flipNext() }, st.revealed ? 'めくる' : 'めくる！', h('small', null, `左から ${st.revealed + 1}枚目 / ${st.toReveal}枚`))
        : h('div', { class: 'waiting' }, h('span', { class: 'spin small' }), st.revealed ? `ホストがめくっています（${st.revealed}/${st.toReveal}）` : '並びが確定！ ホストがめくります')
    );
  } else {
    dock.append(
      isHost()
        ? h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn ghost', onclick: () => S.room.rematch() }, 'ロビーへ'),
            h(
              'button',
              {
                class: 'btn primary big',
                onclick: () => {
                  S.room.rematch();
                  S.room.setSettings({ theme: pickTheme(S.genre, theme && theme.title) });
                  S.room.start();
                },
              },
              'もう一度遊ぶ'
            )
          )
        : h('div', { class: 'waiting' }, h('span', { class: 'spin small' }), 'ホストが次を始めるのを待っています')
    );
  }
  app.append(dock);
}

const pos = (x, y) => `left:calc(${x} * (100% - ${CW}px));top:calc(${y} * (100% - ${CH}px - 26px))`;

/** 画面上の点 → カード置き場の位置（0〜1）。置き場の外なら null */
function tablePoint(cx, cy) {
  const t = document.getElementById('table');
  if (!t) return null;
  const r = t.getBoundingClientRect();
  if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return { x: clamp((cx - r.left - CW / 2) / (r.width - CW)), y: clamp((cy - r.top - 34) / (r.height - CH - 26)) };
}

/** 手札のカードをつかんで置き場へスワイプ */
function dragSource(el, card) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    let ghost = null;
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
        ghost = h('div', { class: 'dragghost', style: `--c:${colorOf(me().id)}` }, h('span', null, card.n));
        document.body.append(ghost);
        document.body.classList.add('dragging');
      }
      ghost.style.transform = `translate(${ev.clientX - 30}px, ${ev.clientY - 40}px) rotate(-4deg)`;
      const t = document.getElementById('table');
      if (t) t.classList.toggle('over', !!tablePoint(ev.clientX, ev.clientY));
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
      const t = document.getElementById('table');
      if (t) t.classList.remove('over');
      if (!ghost) {
        // タップ：選ぶだけ
        S.sel = S.sel === card.cid ? null : card.cid;
        render();
        return;
      }
      ghost.remove();
      const p = ev.type === 'pointerup' ? tablePoint(ev.clientX, ev.clientY) : null;
      if (p) askPlace(card.cid, p.x, p.y);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

/** 置き場にある自分のカード：ドラッグで移動、タップでヒント変更 */
function tableDrag(el, b) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const n = (S.hand.cards.find((c) => c.cid === b.cid) || {}).n ?? '';
    let ghost = null;
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
        ghost = h('div', { class: 'dragghost', style: `--c:${colorOf(me().id)}` }, h('span', null, n));
        document.body.append(ghost);
        document.body.classList.add('dragging');
        S.lift = b.cid;
        render();
      }
      ghost.style.transform = `translate(${ev.clientX - 30}px, ${ev.clientY - 40}px) rotate(-4deg)`;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
      if (!ghost) return editHint(b.cid);
      ghost.remove();
      S.lift = null;
      const p = ev.type === 'pointerup' ? tablePoint(ev.clientX, ev.clientY) : null;
      if (p && S.st.phase === 'play') {
        S.moved[b.cid] = { x: p.x, y: p.y, at: Date.now() };
        S.room.update(b.cid, { x: p.x, y: p.y });
      }
      render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

/** ヒントを書き直す */
function editHint(cid) {
  const b = S.st.board.find((x) => x.cid === cid);
  const card = S.hand.cards.find((c) => c.cid === cid);
  if (!b || !card || S.st.phase !== 'play') return;
  const theme = S.st.settings.theme;
  const hint = h('input', { class: 'in', maxlength: HINT_MAX, value: b.hint || '', placeholder: theme ? `「${theme.title}」なら？` : 'ひとこと', enterkeyhint: 'done' });
  const go = () => {
    closeSheet();
    if (S.st.phase !== 'play') return;
    S.room.update(cid, { hint: hint.value });
  };
  hint.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  openSheet([
    h('div', { class: 'place-head' }, h('div', { class: 'face back big', style: `--c:${colorOf(me().id)}` }, h('span', { class: 'num' }, card.n)), h('div', null, h('div', { class: 'sheet-title' }, 'ヒントを変える'), h('div', { class: 'note' }, '場所はカードをドラッグして動かせます'))),
    h('label', { class: 'lbl' }, 'ヒント（みんなに見えます）'),
    hint,
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: closeSheet }, 'やめる'), h('button', { class: 'btn primary', onclick: go }, '変える')),
  ]);
  setTimeout(() => hint.focus(), 50);
}

/** 置く前の確認（ヒントを書ける） */
function askPlace(cid, x, y) {
  const card = S.hand.cards.find((c) => c.cid === cid);
  if (!card || card.placed) return;
  S.drop = { cid, x, y };
  S.sel = null;
  render();
  const theme = S.st.settings.theme;
  const hint = h('input', { class: 'in', maxlength: HINT_MAX, placeholder: theme ? `「${theme.title}」なら？` : 'ひとこと', enterkeyhint: 'done' });
  const cancel = () => {
    S.drop = null;
    closeSheet();
    render();
  };
  const go = () => {
    S.drop = null;
    closeSheet();
    if (S.st.phase !== 'play') return render();
    const res = S.room.place(card.cid, x, y, hint.value);
    if (res && res.pending) {
      S.pending[card.cid] = { x, y };
      setTimeout(() => {
        if (S.pending[card.cid]) {
          delete S.pending[card.cid];
          S.key = '';
          render();
        }
      }, 8000);
    } else if (res && !res.ok) toast('置けませんでした', 'warn');
    render();
  };
  hint.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  const pct = Math.round(1 + x * 99);
  openSheet([
    h('div', { class: 'place-head' }, h('div', { class: 'face back big', style: `--c:${colorOf(me().id)}` }, h('span', { class: 'num' }, card.n)), h('div', null, h('div', { class: 'sheet-title' }, 'ここに置く'), h('div', { class: 'note' }, `だいたい ${pct} あたりの位置`))),
    h('label', { class: 'lbl' }, 'ヒント（みんなに見えます・なくてもOK）'),
    hint,
    h('p', { class: 'note' }, '置いたあともドラッグで動かせます。ヒントもあとで変えられます'),
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: cancel }, 'やめる'), h('button', { class: 'btn primary', onclick: go }, '裏向きで置く')),
  ]);
  sheetRoot.querySelector('.sheet-bg').onclick = cancel;
  setTimeout(() => hint.focus(), 50);
}

renderTitle();
