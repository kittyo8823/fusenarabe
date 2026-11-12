// テスト用：ローカルの MQTT 中継（WebSocket）＋ dist 配信
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer, createWebSocketStream } from 'ws';
import AedesMod from 'aedes';
const Aedes = AedesMod.Aedes || AedesMod;
export async function start(port = 18900) {
  const aedes = typeof Aedes.createBroker === 'function' ? await Aedes.createBroker() : new Aedes();
  const server = http.createServer(async (req, res) => {
    const html = await readFile(new URL('../dist/index.html', import.meta.url));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  const wss = new WebSocketServer({ server, path: '/mqtt' });
  wss.on('connection', (ws) => aedes.handle(createWebSocketStream(ws)));
  await new Promise((r) => server.listen(port, r));
  return { url: `http://localhost:${port}/`, broker: `ws://localhost:${port}/mqtt`, close: () => { wss.close(); server.close(); aedes.close(); } };
}
