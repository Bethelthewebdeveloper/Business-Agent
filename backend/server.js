const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { open } = require('./db');
const auth = require('./auth');
const { HttpError } = require('./util');
const { build } = require('./routes');

const ROOT = path.join(__dirname, '..');
try { // minimal .env loader (no dependency)
  for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
} catch {}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const LIMITS = { auth: [10, 60000], chat: [40, 60000], api: [600, 60000] };

function createApp(opts = {}) {
  const e = process.env;
  const cfg = { dbFile: opts.dbFile || e.DB_FILE || path.join(ROOT, 'data', 'app.db'), agentUrl: opts.agentUrl || e.AGENT_URL || 'http://127.0.0.1:5001',
    appSecret: opts.appSecret ?? e.META_APP_SECRET ?? '', publicUrl: (e.PUBLIC_BASE_URL || '').replace(/\/$/, ''), graphVersion: e.WHATSAPP_GRAPH_VERSION || 'v21.0',
    graphBase: opts.graphBase || 'https://graph.facebook.com', secureCookies: e.NODE_ENV === 'production' };
  const app = { cfg, db: open(cfg.dbFile) };
  const routes = build(app), hits = new Map();
  const limited = (ip, kind) => { const [max, win] = LIMITS[kind] || LIMITS.api, k = kind + ip, now = Date.now(); let h = hits.get(k); if (!h || now > h.reset) { h = { n: 0, reset: now + win }; hits.set(k, h); } return ++h.n > max; };
  if (!opts.noSweep) setInterval(() => { const n = Date.now(); for (const [k, h] of hits) if (n > h.reset) hits.delete(k); }, 60000).unref();

  const headers = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" };
  const send = (res, status, body, type, extra = {}) => { res.writeHead(status, { ...headers, 'content-type': type, ...extra }); res.end(body); };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x'), p = url.pathname, ip = req.socket.remoteAddress;
      if (p.startsWith('/api/') || p.startsWith('/webhook/')) {
        if (limited(ip, 'api')) throw new HttpError(429, 'Too many requests');
        const route = routes.map(r => ({ r, m: r.re.exec(p) })).find(x => x.m && x.r.method === req.method);
        if (!route) throw new HttpError(404, 'Not found');
        if (route.r.opts.limit && limited(ip, route.r.opts.limit)) throw new HttpError(429, 'Too many requests, slow down');
        const chunks = []; let size = 0;
        for await (const ch of req) { size += ch.length; if (size > 1e6) throw new HttpError(413, 'Payload too large'); chunks.push(ch); }
        const raw = Buffer.concat(chunks); let body = {};
        if (!route.r.opts.raw && raw.length) {
          if (!/application\/json/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Content-Type must be application/json');
          try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
          if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'Body must be a JSON object');
        } else if (!route.r.opts.raw && req.method !== 'GET' && req.method !== 'DELETE' && !/application\/json/.test(req.headers['content-type'] || '') ) throw new HttpError(415, 'Content-Type must be application/json');
        const user = auth.userFromRequest(app.db, req);
        let business = null;
        if (route.r.opts.auth) {
          if (!user) throw new HttpError(401, 'Please log in');
          business = app.db.prepare('SELECT * FROM businesses WHERE owner_id=?').get(user.id); // business is ALWAYS derived from the session, never from the request
        }
        const out = await route.r.fn({ req, raw, body, params: { ...route.m.groups }, query: Object.fromEntries(url.searchParams), user, business });
        const extra = out.cookie ? { 'set-cookie': out.cookie, 'cache-control': 'no-store' } : { 'cache-control': 'no-store' };
        return out.text !== undefined ? send(res, out.status || 200, out.text, 'text/plain', extra) : send(res, out.status || 200, JSON.stringify(out.json), 'application/json', extra);
      }
      // static frontend; dashboard requires a valid session
      let rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
      if (!path.extname(rel)) rel += '.html';
      const file = path.join(ROOT, 'frontend', rel);
      if (!file.startsWith(path.join(ROOT, 'frontend') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'Not found');
      if (rel === 'dashboard.html' && !auth.userFromRequest(app.db, req)) return send(res, 302, '', 'text/plain', { location: '/login.html' });
      send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error('Unhandled error:', err.message);
      send(res, status, JSON.stringify({ error: status === 500 ? 'Internal server error' : err.message }), 'application/json');
    }
  });
  return { app, server, close: () => new Promise(r => server.close(() => { app.db.close(); r(); })) };
}

function startAgent() {
  const py = spawn(process.env.PYTHON_BIN || 'python', ['app.py'], { cwd: path.join(ROOT, 'python-agent'), stdio: 'inherit', env: { ...process.env, AGENT_PORT: new URL(process.env.AGENT_URL || 'http://127.0.0.1:5001').port || '5001' } });
  py.on('error', () => console.error(`Could not start Python ("${process.env.PYTHON_BIN || 'python'}"). Set PYTHON_BIN in .env (try python3 or py) or start python-agent/app.py yourself.`));
  process.on('exit', () => py.kill());
  return py;
}

if (require.main === module) {
  if (process.env.AGENT_AUTOSTART !== '0') startAgent();
  const { server } = createApp(); const port = Number(process.env.PORT || 3000);
  server.listen(port, () => console.log(`Business AI Agent running at http://localhost:${port}`));
}
module.exports = { createApp };
