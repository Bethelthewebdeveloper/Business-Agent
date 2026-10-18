const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), os = require('os'), path = require('path'), fs = require('fs'), crypto = require('crypto');
const { spawn } = require('child_process');
const { createApp } = require('../backend/server');

const AGENT_PORT = 5099, SECRET = 'test-app-secret';
let py, tmp, dbFile, A, graph, graphReqs = [], base, srv;

const waitFor = async (fn) => { for (let i = 0; i < 50; i++) { try { if (await fn()) return; } catch {} await new Promise(r => setTimeout(r, 100)); } throw new Error('timeout'); };
function client(getBase) {
  let cookie = '';
  return async (method, p, body, headers = {}) => {
    const r = await fetch(getBase() + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, headers: r.headers };
  };
}
async function start() {
  const ctx = createApp({ dbFile, agentUrl: `http://127.0.0.1:${AGENT_PORT}`, appSecret: SECRET, graphBase: `http://127.0.0.1:${graph.address().port}`, noSweep: true });
  await new Promise(r => ctx.server.listen(0, r)); base = `http://127.0.0.1:${ctx.server.address().port}`; srv = ctx; return ctx;
}
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'baa-')); dbFile = path.join(tmp, 't.db');
  py = spawn(process.env.PYTHON_BIN || 'python3', ['app.py'], { cwd: path.join(__dirname, '..', 'python-agent'), env: { ...process.env, AGENT_PORT }, stdio: 'ignore' });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${AGENT_PORT}/health`)).ok);
  // Local stand-in for Meta's Graph API (test double only; records calls so we can assert what was/wasn't sent)
  graph = http.createServer((req, res) => { graphReqs.push(req.method + ' ' + req.url); res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify({ display_phone_number: '+234 800 000 0000' }));
    res.end(JSON.stringify({ messages: [{ id: 'wamid.OUT' + graphReqs.length }] })); });
  await new Promise(r => graph.listen(0, r));
  await start(); A = client(() => base);
});
after(async () => { await srv.close(); graph.close(); py.kill(); });

const signup = (c, email, name) => c('POST', '/api/auth/register', { email, password: 'correct-horse-battery', business_name: name });
const sim = (c, message, phone = '2348011111111') => c('POST', '/api/simulate', { message, phone });

test('1. registration, login, protected routes', async () => {
  assert.equal((await A('GET', '/api/orders')).status, 401);
  assert.equal((await A('POST', '/api/auth/register', { email: 'bad', password: 'x', business_name: 'A' })).status, 400);
  assert.equal((await signup(A, 'a@example.com', 'Shop A')).status, 201);
  assert.equal((await signup(client(() => base), 'a@example.com', 'Dup')).status, 409);
  const b = client(() => base);
  assert.equal((await b('POST', '/api/auth/login', { email: 'a@example.com', password: 'wrong-password-123' })).status, 401);
  assert.equal((await b('POST', '/api/auth/login', { email: 'a@example.com', password: 'correct-horse-battery' })).status, 200);
  assert.equal((await b('GET', '/api/auth/me')).json.business.name, 'Shop A');
  const dash = await fetch(base + '/dashboard.html', { redirect: 'manual' }); assert.equal(dash.status, 302);
});
test('2+3. products/FAQs, validation, business isolation', async () => {
  assert.equal((await A('POST', '/api/products', { name: 'Bad', price: -5 })).status, 400);
  assert.equal((await A('POST', '/api/products', { name: 'Red Sneakers', price: 15000, variations: '40,41,42' })).status, 201);
  assert.equal((await A('POST', '/api/products', { name: 'Tote Bag', price: 5000 })).status, 201);
  assert.equal((await A('POST', '/api/faqs', { question: 'Do you offer gift wrapping?', answer: 'Yes, free.' })).status, 201);
  await A('PUT', '/api/business', { hours: 'Mon-Sat 9am-5pm', delivery_info: 'We deliver within Lagos.' });
  const B = client(() => base); await signup(B, 'b@example.com', 'Shop B');
  assert.deepEqual((await B('GET', '/api/products')).json, []);
  const pid = (await A('GET', '/api/products')).json[0].id;
  assert.equal((await B('PUT', `/api/products/${pid}`, { name: 'hijack', price: 1 })).status, 404);
  assert.equal((await B('DELETE', `/api/products/${pid}`)).status, 404);
  await sim(A, 'I want 1 tote bag'); // A's data must not leak to B
  assert.equal((await B('GET', '/api/conversations')).json.length, 0);
  assert.equal((await B('GET', '/api/customers')).json.length, 0);
  const convId = (await A('GET', '/api/conversations')).json[0].id;
  assert.equal((await B('GET', `/api/conversations/${convId}`)).status, 404);
});
test('4. agent answers from business-specific data; simulation is labelled and not delivered', async () => {
  const r = await sim(A, 'how much are the red sneakers?', '2348022222222');
  assert.match(r.json.reply, /15,000\.00/); assert.equal(r.json.simulated, true);
  assert.match((await sim(A, 'when are you open', '2348022222222')).json.reply, /Mon-Sat/);
  assert.match((await sim(A, 'do you do gift wrapping', '2348022222222')).json.reply, /free/);
  const convs = (await A('GET', '/api/conversations?channel=simulation')).json; assert.ok(convs.length >= 1);
  const d = (await A('GET', `/api/conversations/${convs[0].id}`)).json;
  assert.equal(d.conversation.channel, 'simulation');
  assert.ok(d.messages.filter(m => m.direction === 'out').every(m => m.delivery_status === 'simulated_not_delivered'));
  assert.equal(graphReqs.length, 0, 'simulation must never call the WhatsApp API');
});
test('5+6. multi-step order, persistence across restart, handoff', async () => {
  const phone = '2348033333333'; let r;
  await sim(A, 'how much are the red sneakers?', phone); // shows interest first -> follow-up record
  for (const m of ['I want 2 red sneakers', '42', 'Ada Obi', '12 Allen Avenue, Ikeja']) r = await sim(A, m, phone);
  assert.match(r.json.reply, /additional instructions/i); // phone is already known for simulated/WhatsApp customers, so it is not asked
  await srv.close(); await start(); // restart server: state must be restored from SQLite
  const A2 = client(() => base); await A2('POST', '/api/auth/login', { email: 'a@example.com', password: 'correct-horse-battery' });
  r = await sim(A2, 'none', phone);
  assert.match(r.json.reply, /Reply YES/); assert.match(r.json.reply, /Quantity: 2/);
  r = await sim(A2, 'yes', phone); assert.ok(r.json.order_id); assert.match(r.json.reply, new RegExp('#' + r.json.order_id));
  const o = (await A2('GET', '/api/orders')).json.find(x => x.id === r.json.order_id);
  assert.equal(o.status, 'Awaiting Owner Review'); assert.equal(o.payment_status, 'Unverified'); assert.equal(o.items[0].quantity, 2); assert.equal(o.channel, 'simulation');
  A = A2;
  assert.equal((await A('PUT', `/api/orders/${o.id}`, { status: 'Bogus' })).status, 400);
  assert.equal((await A('PUT', `/api/orders/${o.id}`, { status: 'Confirmed' })).status, 200);
  // handoff on unknown question
  const h = await sim(A, 'do you repair broken zippers on jackets', '2348044444444'); assert.match(h.json.reply, /won't guess/);
  const hs = (await A('GET', '/api/handoffs')).json; const pend = hs.find(x => x.status === 'pending');
  assert.match(pend.summary, /Main question: do you repair/); assert.match(pend.summary, /Suggested next action/);
  assert.equal((await A('PUT', `/api/handoffs/${pend.id}/resolve`)).status, 200);
  assert.equal((await A('GET', '/api/handoffs')).json.find(x => x.id === pend.id).status, 'resolved');
});
test('7. follow-ups: created on interest, converted on order, can be stopped', async () => {
  const fu = (await A('GET', '/api/followups')).json;
  const conv = fu.find(f => f.product === 'Red Sneakers' && f.customer_name === 'Ada Obi');
  assert.ok(conv, 'follow-up for Ada created'); assert.equal(conv.status, 'converted', 'ordering converts the follow-up');
  await sim(A, 'price of tote bag?', '2348055555555');
  const f2 = (await A('GET', '/api/followups')).json.find(f => f.product === 'Tote Bag' && f.status === 'pending'); assert.ok(f2);
  assert.equal((await A('PUT', `/api/followups/${f2.id}`, { suggested_message: 'Edited message', status: 'stopped' })).status, 200);
  assert.equal((await A('GET', '/api/followups')).json.find(f => f.id === f2.id).status, 'stopped');
  const wasend = await A('POST', `/api/followups/${f2.id}/send-whatsapp`); assert.equal(wasend.status, 409);
});
test('8. analytics derive from records; none invented', async () => {
  const an = (await A('GET', '/api/analytics')).json;
  assert.ok(an.conversations >= 4); assert.equal(an.order_requests, 1); assert.equal(an.confirmed_orders, 1); assert.equal(an.verified_paid_orders, 0);
  assert.equal(an.top_ordered[0].name, 'Red Sneakers');
  const B = client(() => base); await signup(B, 'c@example.com', 'Empty Co'); const e = (await B('GET', '/api/analytics')).json;
  assert.equal(e.conversations, 0); assert.equal(e.conversion_rate, null); assert.deepEqual(e.activity, []);
});
test('9. waitlist feature is removed', async () => { assert.equal((await A('POST', '/api/waitlist', { email: 'x@y.com' })).status, 404); });
test('10. missing WhatsApp credentials are handled honestly', async () => {
  const B = client(() => base); await signup(B, 'd@example.com', 'No WA');
  assert.equal((await B('POST', '/api/whatsapp/check')).status, 400);
  assert.equal((await B('GET', '/api/whatsapp')).json.configured, false);
  assert.equal((await B('PUT', '/api/whatsapp', { phone_number_id: '12345678', access_token: 'short' })).status, 400);
});
test('11. webhook verification, signature checks, dedupe, auto-reply, delivery status', async () => {
  assert.equal((await A('PUT', '/api/whatsapp', { phone_number_id: '555000111', waba_id: '999', access_token: 'EAAFAKE_TEST_TOKEN_1234567890', auto_reply: true })).status, 200);
  let w = (await A('GET', '/api/whatsapp')).json;
  assert.equal(w.integration.status, 'configured'); assert.ok(!JSON.stringify(w).includes('EAAFAKE'), 'token never returned');
  assert.equal((await A('POST', '/api/whatsapp/check')).json.ok, true);
  w = (await A('GET', '/api/whatsapp')).json; assert.equal(w.integration.status, 'connected'); assert.equal(w.integration.display_phone, '+234 800 000 0000');
  const anon = client(() => base);
  assert.equal((await anon('GET', `/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc`)).status, 403);
  const ok = await anon('GET', `/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${w.verify_token}&hub.challenge=abc123`); assert.equal(ok.status, 200); assert.equal(ok.text, 'abc123');
  const payload = (id, text) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '555000111' }, contacts: [{ wa_id: '2348099999999', profile: { name: 'Real Customer' } }], messages: [{ id, from: '2348099999999', type: 'text', text: { body: text } }] } }] }] });
  const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const post = (raw, sig) => anon('POST', '/webhook/whatsapp', raw, sig ? { 'x-hub-signature-256': sig } : {});
  const body = payload('wamid.IN1', 'how much is the tote bag');
  assert.equal((await post(body)).status, 401); assert.equal((await post(body, 'sha256=' + '0'.repeat(64))).status, 401);
  graphReqs.length = 0;
  assert.equal((await post(body, sign(body))).status, 200); assert.equal((await post(body, sign(body))).status, 200); // duplicate delivery
  const convs = (await A('GET', '/api/conversations?channel=whatsapp')).json; assert.equal(convs.length, 1);
  const d = (await A('GET', `/api/conversations/${convs[0].id}`)).json;
  assert.equal(d.messages.filter(m => m.direction === 'in').length, 1, 'duplicate webhook stored once');
  const out = d.messages.filter(m => m.direction === 'out'); assert.equal(out.length, 1, 'exactly one reply'); assert.equal(out[0].delivery_status, 'accepted_by_api');
  assert.equal(graphReqs.filter(r => r.startsWith('POST')).length, 1);
  const st = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '555000111' }, statuses: [{ id: graphReqs.length ? 'wamid.OUT' + graphReqs.length : '', status: 'delivered' }] } }] }] });
  const before = graphReqs.length; assert.equal((await post(st, sign(st))).status, 200); assert.equal(graphReqs.length, before, 'status events never trigger replies');
  const d2 = (await A('GET', `/api/conversations/${convs[0].id}`)).json; assert.equal(d2.messages.filter(m => m.direction === 'out')[0].delivery_status, 'delivered');
  assert.equal((await post(payload('wamid.IN2', 'hello'), sign(payload('wamid.IN2', 'hello')))).status, 200);
  assert.equal(d.conversation.channel, 'whatsapp');
  // follow-up send inside the 24h window goes through the real send path, truthfully
  const f = (await A('GET', '/api/followups')).json.find(x => x.channel === 'whatsapp' && x.status === 'pending'); assert.ok(f);
  const sent = await A('POST', `/api/followups/${f.id}/send-whatsapp`); assert.equal(sent.status, 200); assert.match(sent.json.note, /not confirmed/i);
});
test('12. webhooks are rejected when META_APP_SECRET is not configured', async () => {
  const ctx2 = createApp({ dbFile: path.join(tmp, 'n.db'), appSecret: '', noSweep: true }); await new Promise(r => ctx2.server.listen(0, r));
  const c = client(() => `http://127.0.0.1:${ctx2.server.address().port}`);
  assert.equal((await c('POST', '/webhook/whatsapp', '{}', { 'x-hub-signature-256': 'sha256=00' })).status, 503); await ctx2.close();
});
test('13. rate limiting on auth endpoints', async () => {
  const c = client(() => base); let last;
  for (let i = 0; i < 12; i++) last = await c('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'whatever-whatever' });
  assert.equal(last.status, 429);
});
