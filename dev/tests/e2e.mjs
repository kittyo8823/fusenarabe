import { createRequire } from 'node:module';
import { start } from './server.mjs';
const require = createRequire('/home/user/human-exe/');
const { chromium, devices } = require('playwright');
const SHOT = process.env.SHOT || '/tmp/claude-0/-home-user/f5b14529-fb02-55ca-92e4-f50a2b654f56/scratchpad/narabe';
await import('node:fs').then((fs) => fs.mkdirSync(SHOT, { recursive: true }));
const srv = await start();
const browser = await chromium.launch();
const errors = [];
async function phone(name) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => (m.type() === 'error' || m.text().startsWith('KICKED')) && errors.push(`${name} console: ${m.text()}`));
  p.on('dialog', (d) => d.accept());
  await p.goto(`${srv.url}?broker=${encodeURIComponent(srv.broker)}`);
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${SHOT}/${n}.png` });
try {
  const host = await phone('host');
  await shot(host, '01-title');
  // 存在しない部屋
  const g1 = await phone('g1');
  await g1.fill('input[placeholder="ニックネーム"]', 'たろう');
  await g1.fill('input.code', 'ZZZZZZ');
  await g1.click('text=参加する');
  await g1.waitForSelector('.err:has-text("見つかりません")', { timeout: 15000 });
  console.log('notfound ok');

  await host.fill('input[placeholder="ニックネーム"]', 'ホスト');
  await host.click('text=部屋を作る');
  await host.waitForSelector('.inv-code strong');
  const code = await host.textContent('.inv-code strong');
  console.log('code', code);
  await g1.fill('input.code', code);
  await g1.click('text=参加する');
  await g1.waitForSelector('.lobby');
  const g2 = await phone('g2');
  await g2.goto(`${srv.url}?broker=${encodeURIComponent(srv.broker)}&room=${code}`);
  await g2.fill('input[placeholder="ニックネーム"]', 'はなこ');
  await g2.click('text=参加する');
  await g2.waitForSelector('.lobby');
  await host.waitForFunction(() => document.querySelectorAll('.players li').length === 3);
  await host.click('text=🎲 お題ガチャ');
  await host.click('.seg button:has-text("2枚")');
  await g2.waitForFunction(() => document.querySelector('.seg .on')?.textContent === '2枚');
  await shot(host, '02-lobby-host');
  await shot(g2, '03-lobby-guest');
  await host.click('text=ゲームを始める');
  for (const p of [host, g1, g2]) await p.waitForSelector('.hcard');
  const pages = { host, g1, g2 };
  const hands = {};
  for (const [k, p] of Object.entries(pages)) hands[k] = await p.$$eval('.hcard .n', (els) => els.map((e) => +e.textContent));
  console.log(JSON.stringify(hands));
  async function drag(p, n, fx, fy) {
    const [b, t] = await p.evaluate((n) => {
      const r = (e) => { const q = e.getBoundingClientRect(); return { x: q.left, y: q.top, width: q.width, height: q.height }; };
      const c = [...document.querySelectorAll('.hcard')].find((e) => +e.querySelector('.n').textContent === n);
      return [r(c), r(document.getElementById('table'))];
    }, n);
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down();
    const tx = t.x + 25 + fx * (t.width - 50), ty = t.y + 40 + fy * (t.height - 130);
    for (let s = 1; s <= 6; s++) await p.mouse.move(b.x + (tx - b.x) * s / 6, b.y + (ty - b.y) * s / 6);
    return p;
  }
  const items = Object.entries(hands).flatMap(([k, ns]) => ns.map((n) => ({ k, n })));
  let i = 0;
  for (const { k, n } of items) {
    const p = pages[k];
    // 数字に合わせた位置（g1 の2枚目だけ少しずらす）
    const fx = (n - 1) / 99 + (k === 'g1' && i === 3 ? 0.25 : 0);
    await drag(p, n, Math.min(1, fx), (i * 0.37) % 1);
    if (i === 2) await shot(p, '04-dragging');
    await p.mouse.up();
    await p.waitForSelector('.sheet-panel input');
    await p.fill('.sheet-panel input', ['カップ麺', '', 'ナイフ', '家族の写真', '', 'スマホ'][i]);
    if (i === 2) await shot(p, '05-place-sheet');
    await p.click('text=裏向きで置く');
    i++;
    await host.waitForFunction((c) => document.querySelectorAll('.tcard:not(.preview)').length >= c, i, { timeout: 10000 });
  }
  // タップでも置ける：（全部置いたので省略）
  await g1.waitForFunction(() => document.querySelectorAll('.tcard').length === 6);
  await shot(g1, '06-all-placed');
  // g1 が置いたカードを動かして、ヒントを変える
  const gcard = '.tcard.grab.mine';
  const box = await g1.evaluate((sel) => { const q = document.querySelector(sel).getBoundingClientRect(); return { x: q.left + 20, y: q.top + 30 }; }, gcard);
  const tb = await g1.evaluate(() => { const q = document.getElementById('table').getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; });
  await g1.mouse.move(box.x, box.y); await g1.mouse.down();
  for (let s = 1; s <= 6; s++) await g1.mouse.move(box.x + (tb.x + tb.w * 0.5 - box.x) * s / 6, box.y + (tb.y + tb.h * 0.15 - box.y) * s / 6);
  await shot(g1, '06b-moving');
  await g1.mouse.up();
  await host.waitForFunction(() => [...document.querySelectorAll('.tcard')].some((e) => Math.abs(e.getBoundingClientRect().left + 25 - (document.getElementById('table').getBoundingClientRect().left + document.getElementById('table').getBoundingClientRect().width / 2)) < 30));
  console.log('move ok');
  await g1.click(gcard);
  await g1.waitForSelector('text=ヒントを変える');
  await g1.fill('.sheet-panel input', 'こっそり変更');
  await g1.click('.sheet-panel .btn.primary');
  await g2.waitForSelector('.thint:has-text("こっそり変更")');
  console.log('hint edit ok');
  // g2 が他人（ホスト）のカードを動かす
  const hb = await g2.evaluate(() => { const e = [...document.querySelectorAll('.tcard.grab:not(.mine)')].find((e) => e.querySelector('.towner')?.textContent === 'ホスト' || e.textContent.includes('ホスト')); e.id = 'pick'; const q = e.getBoundingClientRect(); const t = document.getElementById('table').getBoundingClientRect(); return { x: q.left + 20, y: q.top + 30, tx: t.left + t.width * 0.05 + 25, ty: t.top + t.height * 0.75 }; });
  await g2.mouse.move(hb.x, hb.y); await g2.mouse.down();
  for (let s = 1; s <= 6; s++) await g2.mouse.move(hb.x + (hb.tx - hb.x) * s / 6, hb.y + (hb.ty - hb.y) * s / 6);
  await g2.mouse.up();
  await host.waitForFunction((tx) => [...document.querySelectorAll('.tcard.mine')].some((e) => Math.abs(e.getBoundingClientRect().left + 25 - tx) < 30), hb.tx);
  console.log('move others ok');
  await shot(host, '07-host-finish');
  await host.click('.flipbtn');
  await host.click('.sheet-panel .btn.primary');
  await g2.waitForSelector('text=並びが確定');
  await host.waitForSelector('.flipbtn:has-text("めくる")');
  for (let f = 1; f <= 6; f++) {
    await host.click('.flipbtn');
    await g2.waitForFunction((f) => document.querySelectorAll('.tcard.up').length === f, f);
    if (f === 3) { await g2.waitForTimeout(700); await shot(g2, '08-flipping'); }
  }
  await host.waitForSelector('text=もう一度遊ぶ');
  await g1.waitForTimeout(700);
  await shot(g1, '09-done');
  const order = await g1.$$eval('.tcard', (els) => els.map((e) => [+e.querySelector('.turn').textContent, +e.querySelector('.big-n').textContent]).sort((a, b) => a[0] - b[0]).map((x) => x[1]));
  console.log('flip order', order.join(' '));
  await host.click('text=もう一度遊ぶ');
  for (const p of [host, g1, g2]) await p.waitForSelector('.hcard');
  const n2 = await g1.$$eval('.hcard', (e) => e.length);
  console.log('rematch ok, g1 cards', n2);
  // ゲスト再読み込み → 戻れる
  await g1.reload();
  await g1.waitForSelector('text=に戻る');
  await g1.click('.btn.resume');
  await g1.waitForSelector('.hcard');
  console.log('guest reload resume ok', await g1.$$eval('.hcard', (e) => e.length));
  // 打ち切り
  while (await host.$('.hcard:not(.placed)')) {
    const hn = await host.$eval('.hcard:not(.placed) .n', (e) => +e.textContent);
    await drag(host, hn, hn / 100, 0.5); await host.mouse.up();
    await host.click('text=裏向きで置く');
    await host.waitForFunction((n) => ![...document.querySelectorAll('.hcard:not(.placed) .n')].some((e) => +e.textContent === n), hn);
  }
  await host.click('text=置き終わった！');
  await host.waitForSelector('text=まだ置いていない人がいます');
  await host.click('.sheet-panel .btn.primary');
  await host.click('.flipbtn');
  await g2.waitForFunction(() => document.querySelectorAll('.tcard.up').length === 1);
  console.log('early reveal ok');
  // ホスト再読み込み → 再開
  await host.reload();
  await host.click('text=を再開する');
  await host.waitForSelector('.flipbtn');
  while (await host.$('.flipbtn')) await host.click('.flipbtn');
  await host.click('text=ロビーへ');
  await g2.waitForSelector('.lobby');
  console.log('host resume ok');
  // 解散
  await host.click('.top-exit');
  await host.click('.sheet-panel .btn.danger');
  await host.waitForTimeout(1500); console.log("host view", await host.evaluate(() => document.getElementById("app").className), "g2 view", await g2.evaluate(() => document.getElementById("app").className + " " + document.querySelector(".err")?.textContent));
  await g2.waitForSelector('.err:has-text("解散")');
  console.log('close ok');
} catch (e) {
  console.error('FAIL', e);
  process.exitCode = 1;
} finally {
  console.log('errors:', errors);
  await browser.close();
  srv.close();
}
