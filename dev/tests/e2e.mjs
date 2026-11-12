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
  for (const p of [host, g1, g2]) await p.waitForSelector('.play');
  // 全員の手札を読んで、正しい位置に置く（g2 の1枚だけわざと間違える）
  const pages = { host, g1, g2 };
  const hands = {};
  for (const [k, p] of Object.entries(pages)) hands[k] = await p.$$eval('.hcard .n', (els) => els.map((e) => +e.textContent));
  const all = Object.entries(hands).flatMap(([k, ns]) => ns.map((n) => ({ k, n }))).sort((a, b) => a.n - b.n);
  console.log(all.map((x) => x.k + ':' + x.n).join(' '));
  const order = all.slice();
  // g2 の最後のカードと、その前のカードを入れ替える
  const gi = order.map((x) => x.k).lastIndexOf('g2');
  const swap = gi > 0 ? gi - 1 : 1;
  [order[gi], order[swap]] = [order[swap], order[gi]];
  let i = 0;
  for (const slot of [0, 1, 2, 3, 4, 5]) {
    const { k, n } = order[slot];
    const p = pages[k];
    await p.click(`.hcard:has(.n:text-is("${n}"))`);
    await p.click(`.slots li:nth-child(${slot + 1})`);
    await p.fill('.sheet-panel input', i++ % 2 ? '' : `ヒント${n}`);
    if (slot === 3) await shot(p, '05-place-sheet');
    await p.click('text=裏向きで置く');
    await p.waitForFunction((s) => document.querySelectorAll('.slot.filled').length > s || document.querySelector('.result'), slot, { timeout: 10000 });
    if (slot === 2) {
      await g1.waitForFunction(() => document.querySelectorAll('.slot.filled').length === 3);
      await shot(g1, '04-play');
    }
  }
  for (const p of [host, g1, g2]) await p.waitForSelector('main.result');
  await host.waitForTimeout(3500);
  await shot(host, '06-result-host');
  await g1.screenshot({ path: `${SHOT}/07-result-full.png`, fullPage: true });
  const score = await host.textContent('.pts b');
  console.log('score', score, await host.textContent('.verdict'));
  // もう一度
  await host.click('text=もう一度遊ぶ');
  for (const p of [host, g1, g2]) await p.waitForSelector('.play');
  const n2 = await g1.$$eval('.hcard', (e) => e.length);
  console.log('rematch ok, g1 cards', n2);
  // ゲスト再読み込み → 戻れる
  await g1.reload();
  await g1.waitForSelector('text=に戻る');
  await g1.click('.btn.resume');
  await g1.waitForSelector('.play');
  console.log('guest reload resume ok', await g1.$$eval('.hcard', (e) => e.length));
  // 打ち切り
  await host.click('text=待たずに結果を見る');
  await host.click('.sheet-panel .btn.primary');
  await g2.waitForSelector('main.result');
  console.log('early reveal ok');
  // ホスト再読み込み → 再開
  await host.reload();
  await host.click('text=を再開する');
  await host.waitForSelector('main.result');
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
