const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { RoomStore, HttpError } = require('./src/rooms');
const PRESET_QUESTIONS = require('./src/questions');

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      req.resume();
      reject(new HttpError(415, '请使用 application/json。'));
      return;
    }
    const chunks = [];
    let length = 0;
    let failed = false;
    req.on('data', (chunk) => {
      length += chunk.length;
      if (length > 32768) {
        if (!failed) reject(new HttpError(413, '请求内容过大。'));
        failed = true;
        chunks.length = 0;
      } else if (!failed) chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('shape');
        resolve(body);
      } catch {
        reject(new HttpError(400, '请求体必须是 JSON 对象。'));
      }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new HttpError(400, '请求已中断。')));
  });
}
const staticFiles = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/styles.css': ['styles.css', 'text/css'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};

function createApp(options = {}) {
  const store = options.store || new RoomStore(options);
  const rates = new Map();
  const now = options.now || Date.now;
  function limit(req, creation) {
    const key = (req.socket.remoteAddress || 'unknown') + (creation ? ':create' : ':write');
    const windowMs = creation ? 3600000 : 60000;
    const max = creation ? 20 : 120;
    for (const [id, value] of rates) if (value.until <= now()) rates.delete(id);
    let rate = rates.get(key);
    if (!rate) {
      if (rates.size >= 10000) throw new HttpError(503, '服务繁忙，请稍后重试。');
      rate = { count: 0, until: now() + windowMs };
      rates.set(key, rate);
    }
    if (++rate.count > max) throw new HttpError(429, '操作过于频繁，请稍后重试。');
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      if (req.method === 'POST') {
        if (req.headers['sec-fetch-site'] === 'cross-site')
          throw new HttpError(403, '不允许跨站请求。');
        limit(req, route === '/api/rooms');
      }
      if (req.method === 'GET' && route === '/api/health') return sendJson(res, 200, { ok: true });
      if (req.method === 'GET' && route === '/api/preset-questions')
        return sendJson(res, 200, { questions: PRESET_QUESTIONS });
      if (req.method === 'POST' && route === '/api/rooms')
        return sendJson(res, 201, store.create(await parseBody(req)));
      const match = route.match(
        /^\/api\/rooms\/([A-Za-z0-9]{12})(?:\/(join|submit|next|result))?$/,
      );
      if (match) {
        // Read before looking up/authenticating so the room cannot expire or advance during body upload.
        const payload = req.method === 'POST' ? await parseBody(req) : null;
        const room = store.get(match[1].toUpperCase());
        const action = match[2];
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        if (req.method === 'GET' && !action && !token)
          return sendJson(res, 200, store.preview(room));
        if (req.method === 'POST' && action === 'join')
          return sendJson(res, 200, store.join(room, payload, token));
        const member = store.member(room, token);
        if (req.method === 'GET' && (!action || action === 'result'))
          return sendJson(res, 200, store.view(room, member));
        if (req.method === 'POST' && action === 'submit')
          return sendJson(res, 200, store.submit(room, member, payload));
        if (req.method === 'POST' && action === 'next')
          return sendJson(res, 200, store.next(room, member, payload));
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && Object.hasOwn(staticFiles, route)) {
        const [file, type] = staticFiles[route];
        const data = await fs.readFile(path.join(__dirname, 'public', file));
        res.writeHead(200, {
          'Content-Type': type + '; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(req.method === 'HEAD' ? undefined : data);
        return;
      }
      throw new HttpError(404, '页面或接口不存在。');
    } catch (error) {
      if (!res.headersSent)
        sendJson(res, error.status || 500, {
          error: error.status ? error.message : '服务器暂时不可用，请稍后重试。',
        });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  const cleanup = setInterval(() => store.cleanup(), 60000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  return { server, store };
}
if (require.main === module) {
  const { server } = createApp();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || '0.0.0.0', () =>
    console.log('Server running at http://localhost:' + port),
  );
}
module.exports = { createApp };
