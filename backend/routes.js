const crypto = require('crypto');
const { HttpError, iso, str, price } = require('./util');
const auth = require('./auth');
const { processMessage } = require('./pipeline');
const wa = require('./whatsapp');

const ORDER_STATUSES = ['New', 'Awaiting Owner Review', 'Confirmed', 'Awaiting Payment', 'Completed', 'Cancelled'];
const CHANNELS = ['website', 'whatsapp', 'simulation'];
const idParam = (p) => { const n = Number(p); if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Not found'); return n; };

function build(app) {
  const { db, cfg } = app;
  const R = [];
  const add = (method, pattern, opts, fn) => R.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), opts: typeof opts === 'function' ? {} : opts, fn: typeof opts === 'function' ? opts : fn });
  const own = (table, id, b) => { const row = db.prepare(`SELECT * FROM ${table} WHERE id=? AND business_id=?`).get(idParam(id), b.id); if (!row) throw new HttpError(404, 'Not found'); return row; };

  // ---------- auth ----------
  add('POST', '/api/auth/register', { limit: 'auth' }, (c) => {
    const uid = auth.register(db, c.body);
    return { json: { ok: true }, status: 201, cookie: auth.cookieHeader(auth.createSession(db, uid), cfg.secureCookies) };
  });
  add('POST', '/api/auth/login', { limit: 'auth' }, (c) => ({ json: { ok: true }, cookie: auth.cookieHeader(auth.createSession(db, auth.login(db, c.body)), cfg.secureCookies) }));
  add('POST', '/api/auth/logout', (c) => {
    if (c.user) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(auth.sha(c.user.token));
    return { json: { ok: true }, cookie: auth.cookieHeader('', cfg.secureCookies, 0) };
  });
  add('GET', '/api/auth/me', { auth: true }, (c) => ({ json: { email: c.user.email, business: { id: c.business.id, name: c.business.name } } }));

  // ---------- business + knowledge base ----------
  add('GET', '/api/business', { auth: true }, (c) => ({ json: c.business }));
  add('PUT', '/api/business', { auth: true }, (c) => {
    const b = c.body, cur = c.business;
    const v = { name: str(b.name ?? cur.name, { min: 2, max: 100, name: 'Business name' }), greeting: str(b.greeting ?? cur.greeting ?? '', { max: 500 }), hours: str(b.hours ?? cur.hours ?? '', { max: 1000 }),
      delivery_info: str(b.delivery_info ?? cur.delivery_info ?? '', { max: 1500 }), payment_info: str(b.payment_info ?? cur.payment_info ?? '', { max: 1500 }), policies: str(b.policies ?? cur.policies ?? '', { max: 3000 }) };
    const currency = str(b.currency ?? cur.currency, { min: 3, max: 3, name: 'Currency' }).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Currency must be a 3-letter code such as NGN or USD');
    db.prepare('UPDATE businesses SET name=?,greeting=?,hours=?,delivery_info=?,payment_info=?,policies=?,currency=?,chat_public=? WHERE id=?')
      .run(v.name, v.greeting, v.hours, v.delivery_info, v.payment_info, v.policies, currency, b.chat_public === undefined ? cur.chat_public : (b.chat_public ? 1 : 0), cur.id);
    return { json: { ok: true } };
  });
  const productVals = (b) => ({ name: str(b.name, { min: 1, max: 100, name: 'Product name' }), price: price(b.price), variations: str(b.variations || '', { max: 300 }), description: str(b.description || '', { max: 500 }), available: b.available === false || b.available === 0 ? 0 : 1 });
  add('GET', '/api/products', { auth: true }, (c) => ({ json: db.prepare('SELECT * FROM products WHERE business_id=? ORDER BY id').all(c.business.id) }));
  add('POST', '/api/products', { auth: true }, (c) => { const v = productVals(c.body);
    const r = db.prepare('INSERT INTO products(business_id,name,price,variations,description,available,created_at) VALUES(?,?,?,?,?,?,?)').run(c.business.id, v.name, v.price, v.variations, v.description, v.available, iso());
    return { status: 201, json: { id: Number(r.lastInsertRowid) } }; });
  add('PUT', '/api/products/:id', { auth: true }, (c) => { own('products', c.params.id, c.business); const v = productVals(c.body);
    db.prepare('UPDATE products SET name=?,price=?,variations=?,description=?,available=? WHERE id=?').run(v.name, v.price, v.variations, v.description, v.available, Number(c.params.id)); return { json: { ok: true } }; });
  add('DELETE', '/api/products/:id', { auth: true }, (c) => { own('products', c.params.id, c.business); db.prepare('DELETE FROM products WHERE id=?').run(Number(c.params.id)); return { json: { ok: true } }; });
  add('GET', '/api/faqs', { auth: true }, (c) => ({ json: db.prepare('SELECT * FROM faqs WHERE business_id=? ORDER BY id').all(c.business.id) }));
  add('POST', '/api/faqs', { auth: true }, (c) => { const r = db.prepare('INSERT INTO faqs(business_id,question,answer) VALUES(?,?,?)').run(c.business.id, str(c.body.question, { min: 3, max: 300, name: 'Question' }), str(c.body.answer, { min: 1, max: 1500, name: 'Answer' })); return { status: 201, json: { id: Number(r.lastInsertRowid) } }; });
  add('PUT', '/api/faqs/:id', { auth: true }, (c) => { own('faqs', c.params.id, c.business); db.prepare('UPDATE faqs SET question=?,answer=? WHERE id=?').run(str(c.body.question, { min: 3, max: 300, name: 'Question' }), str(c.body.answer, { min: 1, max: 1500, name: 'Answer' }), Number(c.params.id)); return { json: { ok: true } }; });
  add('DELETE', '/api/faqs/:id', { auth: true }, (c) => { own('faqs', c.params.id, c.business); db.prepare('DELETE FROM faqs WHERE id=?').run(Number(c.params.id)); return { json: { ok: true } }; });
  // Sample catalogue = configuration examples the owner can edit/delete. Not customer data.
  add('POST', '/api/sample-catalog', { auth: true }, (c) => {
    const items = [['Classic T-Shirt', 8500, 'S, M, L, XL', 'Cotton crew-neck tee'], ['Canvas Tote Bag', 5000, '', 'Reusable everyday bag'], ['Sneakers', 25000, '40, 41, 42, 43', 'Lightweight running sneakers']];
    for (const [n, p, v, d] of items) if (!db.prepare('SELECT 1 FROM products WHERE business_id=? AND name=?').get(c.business.id, n)) db.prepare('INSERT INTO products(business_id,name,price,variations,description,available,created_at) VALUES(?,?,?,?,?,1,?)').run(c.business.id, n, p, v, d, iso());
    if (!db.prepare('SELECT 1 FROM faqs WHERE business_id=?').get(c.business.id)) db.prepare('INSERT INTO faqs(business_id,question,answer) VALUES(?,?,?)').run(c.business.id, 'Do you offer gift wrapping?', 'Sample FAQ: edit this answer to match your business.');
    return { json: { ok: true } };
  });

  // ---------- conversations / customers / orders ----------
  add('GET', '/api/conversations', { auth: true }, (c) => {
    const ch = c.query.channel, q = `%${(c.query.q || '').slice(0, 50)}%`;
    if (ch && !CHANNELS.includes(ch)) throw new HttpError(400, 'Unknown channel');
    const sql = `SELECT v.id,v.channel,v.status,v.handoff_status,v.updated_at,cu.name customer_name,cu.channel_ref,
      (SELECT body FROM messages WHERE conversation_id=v.id ORDER BY id DESC LIMIT 1) last_message
      FROM conversations v JOIN customers cu ON cu.id=v.customer_id
      WHERE v.business_id=? ${ch ? 'AND v.channel=?' : ''} AND (COALESCE(cu.name,'') LIKE ? OR cu.channel_ref LIKE ?) ORDER BY v.updated_at DESC LIMIT 200`;
    return { json: db.prepare(sql).all(...[c.business.id, ...(ch ? [ch] : []), q, q]) };
  });
  add('GET', '/api/conversations/:id', { auth: true }, (c) => {
    const v = own('conversations', c.params.id, c.business);
    return { json: { conversation: { id: v.id, channel: v.channel, status: v.status, handoff_status: v.handoff_status },
      customer: db.prepare('SELECT id,name,phone,channel_ref FROM customers WHERE id=?').get(v.customer_id),
      messages: db.prepare('SELECT id,direction,sender,body,delivery_status,created_at FROM messages WHERE conversation_id=? ORDER BY id').all(v.id),
      orders: db.prepare('SELECT id,status FROM orders WHERE conversation_id=?').all(v.id) } };
  });
  add('POST', '/api/conversations/:id/resolve', { auth: true }, (c) => { own('conversations', c.params.id, c.business); db.prepare('UPDATE conversations SET status=? WHERE id=?').run('resolved', Number(c.params.id)); return { json: { ok: true } }; });
  add('GET', '/api/customers', { auth: true }, (c) => ({ json: db.prepare(`SELECT cu.id,cu.name,cu.phone,cu.channel_ref,cu.created_at,
      (SELECT COUNT(*) FROM conversations WHERE customer_id=cu.id) conversations,
      (SELECT COUNT(*) FROM orders WHERE customer_id=cu.id) orders,
      (SELECT MAX(updated_at) FROM conversations WHERE customer_id=cu.id) last_interaction,
      (SELECT GROUP_CONCAT(DISTINCT product) FROM followups WHERE customer_id=cu.id) products_of_interest,
      (SELECT status FROM followups WHERE customer_id=cu.id ORDER BY id DESC LIMIT 1) followup_status
      FROM customers cu WHERE cu.business_id=? ORDER BY last_interaction DESC`).all(c.business.id) }));
  add('GET', '/api/orders', { auth: true }, (c) => {
    const rows = db.prepare('SELECT * FROM orders WHERE business_id=? ORDER BY id DESC LIMIT 300').all(c.business.id);
    for (const o of rows) o.items = db.prepare('SELECT product_name,quantity,variation,unit_price FROM order_items WHERE order_id=?').all(o.id);
    return { json: rows };
  });
  add('PUT', '/api/orders/:id', { auth: true }, (c) => {
    const o = own('orders', c.params.id, c.business), s = c.body.status ?? o.status, p = c.body.payment_status ?? o.payment_status;
    if (!ORDER_STATUSES.includes(s)) throw new HttpError(400, 'Invalid order status');
    if (!['Unverified', 'Verified by owner'].includes(p)) throw new HttpError(400, 'Invalid payment status');
    db.prepare('UPDATE orders SET status=?,payment_status=?,updated_at=? WHERE id=?').run(s, p, iso(), o.id); return { json: { ok: true } };
  });

  // ---------- handoffs ----------
  add('GET', '/api/handoffs', { auth: true }, (c) => ({ json: db.prepare('SELECT h.*,cu.name customer_name FROM handoffs h JOIN customers cu ON cu.id=h.customer_id WHERE h.business_id=? ORDER BY h.status ASC, h.id DESC LIMIT 100').all(c.business.id) }));
  add('PUT', '/api/handoffs/:id/resolve', { auth: true }, (c) => {
    const h = own('handoffs', c.params.id, c.business);
    db.prepare("UPDATE handoffs SET status='resolved',resolved_at=? WHERE id=?").run(iso(), h.id);
    db.prepare("UPDATE conversations SET handoff_status='resolved' WHERE id=? AND NOT EXISTS (SELECT 1 FROM handoffs WHERE conversation_id=? AND status='pending')").run(h.conversation_id, h.conversation_id);
    return { json: { ok: true } };
  });

  // ---------- follow-ups ----------
  add('GET', '/api/followups', { auth: true }, (c) => ({ json: db.prepare(`SELECT f.*,cu.name customer_name,cu.channel_ref,v.channel FROM followups f JOIN customers cu ON cu.id=f.customer_id JOIN conversations v ON v.id=f.conversation_id WHERE f.business_id=? ORDER BY f.status='pending' DESC, f.next_date`).all(c.business.id) }));
  add('PUT', '/api/followups/:id', { auth: true }, (c) => {
    const f = own('followups', c.params.id, c.business);
    const status = c.body.status ?? f.status; if (!['pending', 'sent', 'converted', 'stopped'].includes(status)) throw new HttpError(400, 'Invalid status');
    const msg = str(c.body.suggested_message ?? f.suggested_message, { min: 1, max: 1000, name: 'Message' });
    const next = c.body.next_date ? new Date(c.body.next_date) : new Date(f.next_date); if (isNaN(next)) throw new HttpError(400, 'Invalid date');
    db.prepare('UPDATE followups SET status=?,suggested_message=?,next_date=?,sent_at=CASE WHEN ?=\'sent\' AND sent_at IS NULL THEN ? ELSE sent_at END WHERE id=?').run(status, msg, next.toISOString(), status, iso(), f.id);
    return { json: { ok: true } };
  });
  add('POST', '/api/followups/:id/send-whatsapp', { auth: true }, async (c) => {
    const f = own('followups', c.params.id, c.business);
    const cu = db.prepare('SELECT * FROM customers WHERE id=?').get(f.customer_id), v = db.prepare('SELECT * FROM conversations WHERE id=?').get(f.conversation_id);
    if (f.status === 'stopped' || f.status === 'converted') throw new HttpError(409, 'This follow-up is closed');
    if (v.channel !== 'whatsapp') throw new HttpError(400, 'Only real WhatsApp customers can be messaged this way. Copy the message instead.');
    const last = db.prepare("SELECT created_at FROM messages WHERE conversation_id=? AND direction='in' ORDER BY id DESC LIMIT 1").get(v.id);
    if (!last || Date.now() - Date.parse(last.created_at) > 24 * 3600 * 1000)
      throw new HttpError(422, 'The 24-hour customer-service window is closed. WhatsApp only allows an approved message template now, which this app does not send. Copy the message and use an approved template in Meta Business tools.');
    const r = await wa.sendText(app, c.business.id, cu.channel_ref, f.suggested_message);
    if (!r.ok) throw new HttpError(502, `Not sent: ${r.error}`);
    db.prepare("INSERT INTO messages(conversation_id,business_id,direction,sender,body,wa_message_id,delivery_status,created_at) VALUES(?,?,?,?,?,?,?,?)").run(v.id, c.business.id, 'out', 'owner-followup', f.suggested_message, r.wamid || null, 'accepted_by_api', iso());
    db.prepare("UPDATE followups SET status='sent',sent_at=?,delivery_status='accepted_by_api' WHERE id=?").run(iso(), f.id);
    return { json: { ok: true, note: 'Accepted by the WhatsApp API. Delivery is not confirmed until WhatsApp reports it.' } };
  });

  // ---------- WhatsApp integration (owner) ----------
  add('GET', '/api/whatsapp', { auth: true }, (c) => {
    const ig = db.prepare('SELECT * FROM whatsapp_integrations WHERE business_id=?').get(c.business.id), sec = db.prepare('SELECT verify_token FROM whatsapp_secrets WHERE business_id=?').get(c.business.id);
    return { json: { configured: !!ig, integration: ig || null, verify_token: sec ? sec.verify_token : null, webhook_url: (cfg.publicUrl || '<your-public-https-url>') + '/webhook/whatsapp', app_secret_configured: !!cfg.appSecret } };
  });
  add('PUT', '/api/whatsapp', { auth: true }, (c) => {
    const b = c.body, pn = str(b.phone_number_id, { min: 5, max: 40, name: 'Phone Number ID' });
    if (!/^\d+$/.test(pn)) throw new HttpError(400, 'Phone Number ID must be digits only');
    const waba = str(b.waba_id || '', { max: 40 }); const existing = db.prepare('SELECT * FROM whatsapp_secrets WHERE business_id=?').get(c.business.id);
    const token = typeof b.access_token === 'string' ? b.access_token.trim() : '';
    if (!existing && token.length < 20) throw new HttpError(400, 'Access token is required');
    if (db.prepare('SELECT 1 FROM whatsapp_integrations WHERE phone_number_id=? AND business_id<>?').get(pn, c.business.id)) throw new HttpError(409, 'That phone number is already linked to another business');
    const now = iso();
    if (existing) { if (token) db.prepare('UPDATE whatsapp_secrets SET access_token=? WHERE business_id=?').run(token, c.business.id); }
    else db.prepare('INSERT INTO whatsapp_secrets(business_id,access_token,verify_token) VALUES(?,?,?)').run(c.business.id, token, crypto.randomBytes(24).toString('hex'));
    const cur = db.prepare('SELECT * FROM whatsapp_integrations WHERE business_id=?').get(c.business.id);
    if (cur) db.prepare("UPDATE whatsapp_integrations SET phone_number_id=?,waba_id=?,auto_reply=?,status='configured',verified_at=NULL,updated_at=? WHERE business_id=?").run(pn, waba, b.auto_reply ? 1 : 0, now, c.business.id);
    else db.prepare('INSERT INTO whatsapp_integrations(business_id,phone_number_id,waba_id,auto_reply,updated_at) VALUES(?,?,?,?,?)').run(c.business.id, pn, waba, b.auto_reply ? 1 : 0, now);
    return { json: { ok: true, note: 'Saved. Not connected until you run the connection check.' } };
  });
  add('POST', '/api/whatsapp/check', { auth: true }, async (c) => ({ json: await wa.checkConnection(app, c.business.id) }));
  add('DELETE', '/api/whatsapp', { auth: true }, (c) => { db.prepare('DELETE FROM whatsapp_integrations WHERE business_id=?').run(c.business.id); db.prepare('DELETE FROM whatsapp_secrets WHERE business_id=?').run(c.business.id); return { json: { ok: true } }; });

  // ---------- local simulation (never calls WhatsApp) ----------
  add('POST', '/api/simulate', { auth: true }, async (c) => {
    const phone = str(c.body.phone || '2348000000001', { min: 5, max: 20, name: 'Phone' }).replace(/\D/g, '');
    const text = str(c.body.message, { min: 1, max: 1000, name: 'Message' });
    const r = await processMessage(app, { business: c.business, channel: 'simulation', ref: 'sim:' + phone, phone, name: c.body.name ? str(c.body.name, { max: 60 }) : null, text });
    return { json: { ...r, simulated: true } };
  });
  add('POST', '/api/simulate/reset', { auth: true }, (c) => { // closes the simulated conversation so a fresh one starts
    db.prepare("UPDATE conversations SET status='resolved', state='{}' WHERE business_id=? AND channel='simulation' AND status='open'").run(c.business.id); return { json: { ok: true } }; });

  // ---------- analytics ----------
  add('GET', '/api/analytics', { auth: true }, (c) => {
    const bid = c.business.id, from = /^\d{4}-\d{2}-\d{2}$/.test(c.query.from || '') ? c.query.from : '0000-01-01', to = /^\d{4}-\d{2}-\d{2}$/.test(c.query.to || '') ? c.query.to + 'T23:59:59.999Z' : '9999-12-31';
    const n = (sql, ...p) => db.prepare(sql).get(bid, from, to, ...p).n;
    const D = 'business_id=? AND created_at>=? AND created_at<=?';
    const conversations = n(`SELECT COUNT(*) n FROM conversations WHERE ${D}`), customers = n(`SELECT COUNT(*) n FROM customers WHERE ${D}`);
    const withOrder = n(`SELECT COUNT(DISTINCT customer_id) n FROM orders WHERE ${D}`);
    return { json: { conversations, customers,
      order_requests: n(`SELECT COUNT(*) n FROM orders WHERE ${D}`),
      awaiting_review: n(`SELECT COUNT(*) n FROM orders WHERE ${D} AND status IN ('New','Awaiting Owner Review')`),
      confirmed_orders: n(`SELECT COUNT(*) n FROM orders WHERE ${D} AND status IN ('Confirmed','Awaiting Payment','Completed')`),
      awaiting_payment: n(`SELECT COUNT(*) n FROM orders WHERE ${D} AND status='Awaiting Payment'`),
      completed_orders: n(`SELECT COUNT(*) n FROM orders WHERE ${D} AND status='Completed'`),
      verified_paid_orders: n(`SELECT COUNT(*) n FROM orders WHERE ${D} AND payment_status='Verified by owner'`),
      pending_handoffs: n(`SELECT COUNT(*) n FROM handoffs WHERE ${D} AND status='pending'`),
      awaiting_followup: n(`SELECT COUNT(DISTINCT customer_id) n FROM followups WHERE ${D} AND status='pending'`),
      conversion_rate: customers ? Math.round((withOrder / customers) * 1000) / 10 : null,
      top_ordered: db.prepare(`SELECT oi.product_name name, SUM(oi.quantity) total FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.business_id=? AND o.created_at>=? AND o.created_at<=? GROUP BY oi.product_name ORDER BY total DESC LIMIT 5`).all(bid, from, to),
      top_inquired: db.prepare(`SELECT product name, COUNT(*) total FROM followups WHERE ${D} GROUP BY product ORDER BY total DESC LIMIT 5`).all(bid, from, to),
      by_channel: db.prepare(`SELECT channel, COUNT(*) total FROM conversations WHERE ${D} GROUP BY channel`).all(bid, from, to),
      activity: db.prepare(`SELECT substr(created_at,1,10) day, COUNT(*) total FROM conversations WHERE ${D} GROUP BY day ORDER BY day`).all(bid, from, to) } };
  });

  // ---------- public: website chat ----------
  add('GET', '/api/public/businesses', (c) => ({ json: db.prepare('SELECT id,name FROM businesses WHERE chat_public=1 ORDER BY name').all() }));
  add('GET', '/api/public/business/:id', (c) => { const b = db.prepare('SELECT id,name,greeting FROM businesses WHERE id=? AND chat_public=1').get(idParam(c.params.id)); if (!b) throw new HttpError(404, 'Not found'); return { json: b }; });
  add('POST', '/api/public/chat', { limit: 'chat' }, async (c) => {
    const b = db.prepare('SELECT * FROM businesses WHERE id=? AND chat_public=1').get(idParam(c.body.business_id)); if (!b) throw new HttpError(404, 'Business not found');
    const sid = String(c.body.session_id || ''); if (!/^[A-Za-z0-9_-]{8,64}$/.test(sid)) throw new HttpError(400, 'Invalid session');
    const r = await processMessage(app, { business: b, channel: 'website', ref: 'web:' + sid, text: str(c.body.message, { min: 1, max: 1000, name: 'Message' }) });
    return { json: { reply: r.reply } };
  });
  add('GET', '/api/agent/health', { auth: true }, async () => {
    try { const r = await fetch(cfg.agentUrl + '/health', { signal: AbortSignal.timeout(2000) }); return { json: { ...(await r.json()), reachable: true } }; }
    catch { return { json: { reachable: false } }; }
  });

  // ---------- WhatsApp webhook ----------
  add('GET', '/webhook/whatsapp', { limit: 'chat' }, (c) => ({ text: wa.verifyChallenge(app, c.query) }));
  add('POST', '/webhook/whatsapp', { raw: true }, async (c) => ({ json: await wa.handleWebhook(app, c.raw, c.req.headers['x-hub-signature-256']) }));
  return R;
}
module.exports = { build };
