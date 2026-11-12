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
const stars = (n) => h('span', { class: 'stars' }, [0, 1, 2].map((i) => h('i', { class: i < n ? 'on' : '' }, '★')));

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
    h('li', null, '自分の数字に合う「ことば」をヒントにして、カードを裏向きのまま列に置きます。上ほど小さく、下ほど大きい。'),
    h('li', null, '置く順番もタイミングも自由。ただし一度置いたら動かせません。'),
    h('li', null, '全員置いたらオープン！ 正しい順に近いほど高得点。全部ぴったりならパーフェクトです。')
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
    for (const c of hd.cards) if (c.slot != null) delete S.pending[c.cid];
    if (S.sel && hd.cards.find((c) => c.cid === S.sel && c.slot != null)) S.sel = null;
    render();
  });
  if (!room.isHost) {
    room.onError = (err, cid) => {
      if (cid) delete S.pending[cid];
      S.key = '';
      toast(err === 'taken' ? 'そこはちょうど埋まりました。別の場所に置いてください' : err === 'phase' ? 'もう結果発表になっています' : '置けませんでした', 'warn');
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
  const key = JSON.stringify([S.st, S.hand, S.sel, S.pending, S.genre]);
  if (key === S.key) return;
  S.key = key;
  const y = window.scrollY;
  app.textContent = '';
  app.className = `scr-${S.st.phase}`;
  app.append(topBar());
  if (S.st.phase === 'lobby') renderLobby();
  else if (S.st.phase === 'play') renderPlay();
  else renderResult();
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

// ---------- ゲーム中 ----------
function renderPlay() {
  const st = S.st;
  const theme = st.settings.theme;
  const myCards = S.hand.round === st.round ? S.hand.cards : [];
  const unplaced = myCards.filter((c) => c.slot == null && S.pending[c.cid] == null);
  if (S.sel && !unplaced.find((c) => c.cid === S.sel)) S.sel = null;
  if (!S.sel && unplaced.length === 1) S.sel = unplaced[0].cid;
  const pendingSlots = new Map(Object.entries(S.pending).map(([cid, slot]) => [slot, cid]));
  const mineBySlot = new Map(myCards.filter((c) => c.slot != null).map((c) => [c.slot, c]));

  const placedTotal = st.board.filter(Boolean).length;
  const rows = st.board.map((b, i) => {
    const idx = h('span', { class: 'idx' }, i + 1);
    if (b) {
      const mine = mineBySlot.get(i);
      return h(
        'li',
        { class: `slot filled ${mine ? 'mine' : ''}` },
        idx,
        h('div', { class: 'face back', style: `--c:${colorOf(b.owner)}` }, mine ? h('span', { class: 'num' }, mine.n) : null),
        h('div', { class: 'who' }, h('div', { class: 'hint' }, b.hint ? `「${b.hint}」` : h('span', { class: 'nohint' }, 'ヒントなし')), h('div', { class: 'owner' }, nameOf(b.owner), mine ? '（あなた）' : ''))
      );
    }
    if (pendingSlots.has(i)) {
      const c = myCards.find((x) => x.cid === pendingSlots.get(i));
      return h('li', { class: 'slot pending' }, idx, h('div', { class: 'face back', style: `--c:${colorOf(me().id)}` }, h('span', { class: 'num' }, c ? c.n : '')), h('div', { class: 'who' }, h('div', { class: 'owner' }, '置いています…')));
    }
    const canPlace = !!S.sel;
    return h(
      'li',
      { class: `slot empty ${canPlace ? 'target' : ''}`, onclick: canPlace ? () => placeSheet(i) : null },
      idx,
      h('div', { class: 'face hole' }),
      h('div', { class: 'who' }, canPlace ? h('span', { class: 'put' }, 'ここに置く') : h('span', { class: 'free' }, 'あいてる'))
    );
  });

  app.append(
    h(
      'main',
      { class: 'play' },
      themeCard(theme),
      h('section', { class: 'status' }, h('div', { class: 'status-head' }, `置いたカード ${placedTotal}/${st.board.length}`, h('span', { class: 'progress' }, h('i', { style: `width:${(placedTotal / Math.max(1, st.board.length)) * 100}%` }))), playerList('play')),
      h(
        'section',
        { class: 'board' },
        h('div', { class: 'end top-end' }, h('b', null, '小'), theme ? theme.lo : '小さい', h('span', null, '1に近い')),
        h('ol', { class: 'slots' }, rows),
        h('div', { class: 'end bottom-end' }, h('b', null, '大'), theme ? theme.hi : '大きい', h('span', null, '100に近い'))
      ),
      isHost()
        ? h(
            'button',
            {
              class: 'linkbtn reveal-now',
              onclick: () => confirmSheet('まだ置いていない人がいます', '待たずに結果を見ますか？ 置かれていないカードは採点に入りません。', '結果を見る', () => S.room.revealNow()),
            },
            '待たずに結果を見る（ホスト）'
          )
        : null
    )
  );

  // 手札
  let dock;
  if (!myCards.length) dock = h('div', { class: 'waiting' }, '途中参加なので、次のラウンドから遊べます');
  else {
    const left = unplaced.length;
    dock = [
      h('div', { class: 'dock-head' }, left ? (S.sel ? '列の「ここに置く」をタップ' : '置くカードを選んでね') : 'ぜんぶ置きました！ みんなを待っています'),
      h(
        'div',
        { class: 'hand' },
        myCards.map((c) => {
          const placed = c.slot != null || S.pending[c.cid] != null;
          const slot = c.slot != null ? c.slot : S.pending[c.cid];
          return h(
            'button',
            {
              class: `hcard ${placed ? 'placed' : ''} ${S.sel === c.cid ? 'sel' : ''}`,
              style: `--c:${colorOf(me().id)}`,
              disabled: placed,
              onclick: () => {
                S.sel = S.sel === c.cid ? null : c.cid;
                render();
              },
            },
            h('span', { class: 'n' }, c.n),
            h('span', { class: 'sub' }, placed ? `${slot + 1}番目` : S.sel === c.cid ? '選択中' : 'タップ')
          );
        })
      ),
    ];
  }
  app.append(h('div', { class: 'dock' }, dock));
}

function placeSheet(slot) {
  const card = S.hand.cards.find((c) => c.cid === S.sel);
  if (!card) return;
  const theme = S.st.settings.theme;
  const hint = h('input', { class: 'in', maxlength: HINT_MAX, placeholder: theme ? `「${theme.title}」なら？` : 'ひとこと', enterkeyhint: 'done' });
  const go = () => {
    if (S.st.phase !== 'play') return closeSheet();
    if (S.st.board[slot]) {
      closeSheet();
      toast('そこはもう埋まっています', 'warn');
      return;
    }
    const res = S.room.place(card.cid, slot, hint.value);
    closeSheet();
    if (res && res.pending) {
      S.pending[card.cid] = slot;
      setTimeout(() => {
        if (S.pending[card.cid] === slot) {
          delete S.pending[card.cid];
          S.key = '';
          render();
        }
      }, 8000);
    } else if (res && !res.ok) toast('置けませんでした', 'warn');
    S.sel = null;
    render();
  };
  hint.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  const n = S.st.board.length;
  openSheet([
    h('div', { class: 'place-head' }, h('div', { class: 'face back big', style: `--c:${colorOf(me().id)}` }, h('span', { class: 'num' }, card.n)), h('div', null, h('div', { class: 'sheet-title' }, `${slot + 1}番目に置く`), h('div', { class: 'note' }, `全${n}枠のうち 上から${slot + 1}番目`))),
    h('label', { class: 'lbl' }, 'ヒント（みんなに見えます・なくてもOK）'),
    hint,
    h('p', { class: 'note warn' }, '置いたカードはあとから動かせません'),
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: closeSheet }, 'やめる'), h('button', { class: 'btn primary', onclick: go }, '裏向きで置く')),
  ]);
  setTimeout(() => hint.focus(), 50);
}

// ---------- 結果 ----------
const VERDICT = ['バラバラ！ でも楽しかったよね', 'まあまあ通じ合ってる', 'おしい！ かなり通じ合ってる', 'パーフェクト！ 以心伝心！'];

function renderResult() {
  const st = S.st;
  const r = st.result;
  const theme = st.settings.theme;
  const animate = S.animRound !== st.round;
  S.animRound = st.round;
  const step = r.slots.length > 12 ? 0.18 : 0.32;
  const list = h('ol', { class: 'slots result' });
  r.slots.forEach((s, i) => {
    if (i > 0) {
      const ok = r.pairs[i - 1];
      list.append(h('li', { class: `sep ${ok ? 'ok' : 'ng'} ${animate ? 'anim' : ''}`, style: animate ? `animation-delay:${(i + 0.5) * step}s` : '' }, ok ? '' : h('span', null, '▲ 逆になってる')));
    }
    const isMine = s.owner === me().id;
    list.append(
      h(
        'li',
        { class: `slot filled revealed ${isMine ? 'mine' : ''}` },
        h('span', { class: 'idx' }, i + 1),
        h('div', { class: `flip ${animate ? 'anim' : ''}`, style: animate ? `animation-delay:${i * step}s;--c:${colorOf(s.owner)}` : `--c:${colorOf(s.owner)}` }, h('div', { class: 'face front' }, h('span', { class: 'num' }, s.n))),
        h('div', { class: 'who' }, h('div', { class: 'hint' }, s.hint ? `「${s.hint}」` : h('span', { class: 'nohint' }, 'ヒントなし')), h('div', { class: 'owner' }, nameOf(s.owner), isMine ? '（あなた）' : ''))
      )
    );
  });
  const delay = animate ? r.slots.length * step + 0.3 : 0;
  const sorted = r.slots.slice().sort((a, b) => a.n - b.n);
  const head = h(
    'section',
    { class: `score ${animate ? 'anim' : ''} ${r.perfect ? 'perfect' : ''}`, style: `animation-delay:${delay}s` },
    stars(r.stars),
    h('div', { class: 'pts' }, h('b', null, r.score), '点'),
    h('div', { class: 'verdict' }, VERDICT[r.stars]),
    h('div', { class: 'detail' }, `となり同士の順番 ${r.goodPairs}/${Math.max(0, r.totalPairs)} ・ ぴったりの位置 ${r.exact}/${r.slots.length}`),
    r.unplaced ? h('div', { class: 'detail warn' }, `置かれなかったカード ${r.unplaced}枚`) : null
  );
  app.append(
    h(
      'main',
      { class: 'result' },
      themeCard(theme),
      head,
      h('section', { class: 'board' }, h('div', { class: 'end top-end' }, h('b', null, '小'), theme ? theme.lo : ''), list, h('div', { class: 'end bottom-end' }, h('b', null, '大'), theme ? theme.hi : '')),
      h('section', { class: 'card-sec answer' }, h('h2', null, '正しい順番'), h('div', { class: 'answer-row' }, sorted.map((s) => h('span', { class: 'ans', style: `--c:${colorOf(s.owner)}` }, h('b', null, s.n), nameOf(s.owner)))))
    )
  );
  app.append(
    h(
      'div',
      { class: 'dock' },
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
    )
  );
}

renderTitle();
