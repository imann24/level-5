import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Room } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  const fp = path.join(PUBLIC, path.normalize(file));
  if (!fp.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});

const room = new Room();
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => room.addSocket(ws));

const TICK = 1 / 30;
setInterval(() => {
  room.tick(TICK);
  room.broadcast();
}, TICK * 1000);

server.listen(PORT, () => console.log(`LEVEL 5 running on http://localhost:${PORT}`));
