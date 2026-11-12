# ふせならべ

GitHub Pages で公開しているオンラインパーティーゲーム。直下の `index.html` が公開版（1ファイルで完結）。
ソースは `dev/`：`src/`（game.js=ルール、net.js=MQTT通信、main.js=画面、themes.js=お題、style.css）。
- ビルド：`cd dev && npm install && node scripts/build.mjs` → `dev/dist/index.html` を直下の `index.html` にコピーして公開。
- テスト：`node tests/game.test.mjs`、`node tests/e2e.mjs`（ローカルのMQTT中継でスマホ3台を再現）。
