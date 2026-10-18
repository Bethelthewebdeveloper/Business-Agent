// Single shared pipeline used by website chat, WhatsApp webhooks and the local simulator.
const { HttpError, iso } = require('./util');

function loadKnowledge(db, b) {
  const products = db.prepare('SELECT * FROM products WHERE business_id=? ORDER BY id').all(b.id)
    .map(p => ({ name: p.name, price: p.price, description: p.description || '', available: !!p.available,
      variations: (p.variations || '').split(',').map(s => s.trim()).filter(Boolean) }));
  const faqs = db.prepare('SELECT question,answer FROM faqs WHERE business_id=?').all(b.id);
  return { name: b.name, greeting: b.greeting, hours: b.hours, delivery_info: b.delivery_info, payment_info: b.payment_info, policies: b.policies, currency: b.currency, products, faqs };
}

async function callAgent(cfg, payload) {
  let r;
  try { r = await fetch(cfg.agentUrl + '/respond', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) }); }
  catch { throw new HttpError(503, 'The agent service is not reachable. Start the Python agent (see README).'); }
  if (!r.ok) throw new HttpError(502, 'The agent service returned an error');
  return r.json();
}

function ensureCustomer(db, b, ref, name, phone) {
  let c = db.prepare('SELECT * FROM customers WHERE business_id=? AND channel_ref=?').get(b.id, ref);
  if (!c) {
    const r = db.prepare('INSERT INTO customers(business_id,channel_ref,name,phone,created_at) VALUES(?,?,?,?,?)').run(b.id, ref, name || null, phone || null, iso());
    c = db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid);
  } else if (name && !c.name) { db.prepare('UPDATE customers SET name=? WHERE id=?').run(name, c.id); c.name = name; }
  return c;
}

const REASONS = { unknown_question: 'The agent has no configured information that answers this question.', human_requested: 'The customer asked for a human.', no_catalog: 'Customer wanted to order but no products are configured.' };
const NEXT = { unknown_question: 'Reply to the customer, then consider adding the answer to the Knowledge Base.', human_requested: 'Contact the customer directly.', no_catalog: 'Add products in the Knowledge Base, then contact the customer.' };

function createHandoff(db, b, conv, cust, state, a) {
  if (db.prepare("SELECT 1 FROM handoffs WHERE conversation_id=? AND status='pending'").get(conv.id)) return;
  const order = db.prepare('SELECT id,status FROM orders WHERE customer_id=? ORDER BY id DESC').get(cust.id);
  const summary = [
    `Customer: ${cust.name || 'Name not provided'} (${conv.channel}: ${cust.channel_ref})`,
    `Main question: ${a.question}`,
    `Products of interest: ${(state.interests || []).join(', ') || 'None recorded'}`,
    `Related order: ${order ? `#${order.id} (${order.status})` : 'None'}`,
    `Reason for escalation: ${REASONS[a.reason] || a.reason}`,
    `Suggested next action: ${NEXT[a.reason] || 'Review the conversation and reply to the customer.'}`].join('\n');
  db.prepare('INSERT INTO handoffs(business_id,conversation_id,customer_id,reason,summary,created_at) VALUES(?,?,?,?,?,?)').run(b.id, conv.id, cust.id, a.reason, summary, iso());
  db.prepare("UPDATE conversations SET handoff_status='pending' WHERE id=?").run(conv.id);
}

function createFollowup(db, b, conv, cust, product) {
  if (db.prepare("SELECT 1 FROM followups WHERE customer_id=? AND product=? AND status IN ('pending','sent')").get(cust.id, product)) return;
  const when = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const msg = `Hi ${cust.name || 'there'}, you asked about ${product} earlier. Would you like to place an order? Reply here and we'll help you.`;
  db.prepare('INSERT INTO followups(business_id,customer_id,conversation_id,product,reason,suggested_message,next_date,last_interaction,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(b.id, cust.id, conv.id, product, 'Showed interest but has not placed an order', msg, when, iso(), iso());
}

function createOrder(db, b, conv, cust, o) {
  const now = iso();
  const r = db.prepare('INSERT INTO orders(business_id,customer_id,conversation_id,status,payment_status,customer_name,phone,address,notes,channel,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.id, cust.id, conv.id, 'Awaiting Owner Review', 'Unverified', o.customer_name, o.phone || null, o.address, o.notes || '', conv.channel, now, now);
  for (const i of o.items) db.prepare('INSERT INTO order_items(order_id,product_name,quantity,variation,unit_price) VALUES(?,?,?,?,?)').run(r.lastInsertRowid, i.product, i.quantity, i.variation || null, i.unit_price);
  if (!cust.name) db.prepare('UPDATE customers SET name=? WHERE id=?').run(o.customer_name, cust.id);
  for (const i of o.items) db.prepare("UPDATE followups SET status='converted' WHERE customer_id=? AND product=? AND status IN ('pending','sent')").run(cust.id, i.product);
  return Number(r.lastInsertRowid);
}

// opts: { business, channel, ref, name, phone, text, waMessageId, skipAgent }
async function processMessage(app, opts) {
  const { db, cfg } = app, b = opts.business, now = iso();
  const cust = ensureCustomer(db, b, opts.ref, opts.name, opts.phone);
  let conv = db.prepare("SELECT * FROM conversations WHERE customer_id=? AND channel=? AND status='open' ORDER BY id DESC").get(cust.id, opts.channel);
  if (!conv) {
    const r = db.prepare('INSERT INTO conversations(business_id,customer_id,channel,created_at,updated_at) VALUES(?,?,?,?,?)').run(b.id, cust.id, opts.channel, now, now);
    conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(r.lastInsertRowid);
  }
  db.prepare("INSERT INTO messages(conversation_id,business_id,direction,sender,body,wa_message_id,delivery_status,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(conv.id, b.id, 'in', 'customer', opts.text || '[unsupported message type]', opts.waMessageId || null, 'received', now);
  db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(now, conv.id);
  if (opts.skipAgent) return { conversation_id: Number(conv.id), reply: null };

  const state = JSON.parse(conv.state || '{}');
  const orders = db.prepare('SELECT id,status,payment_status FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 3').all(cust.id);
  const res = await callAgent(cfg, { business: loadKnowledge(db, b), message: opts.text || '', state, channel: opts.channel, customer: { name: cust.name, phone: cust.phone, orders } });

  let reply = res.reply, orderId = null;
  for (const a of res.actions || []) {
    if (a.type === 'order') { orderId = createOrder(db, b, conv, cust, a.order); reply = reply.replace('{order_id}', orderId); }
    else if (a.type === 'handoff') createHandoff(db, b, conv, cust, res.state, a);
    else if (a.type === 'interest') createFollowup(db, b, conv, cust, a.product);
  }
  const ds = opts.channel === 'whatsapp' ? 'pending_send' : opts.channel === 'simulation' ? 'simulated_not_delivered' : 'shown_in_chat';
  const out = db.prepare('INSERT INTO messages(conversation_id,business_id,direction,sender,body,delivery_status,created_at) VALUES(?,?,?,?,?,?,?)').run(conv.id, b.id, 'out', 'agent', reply, ds, iso());
  db.prepare('UPDATE conversations SET state=?, updated_at=? WHERE id=?').run(JSON.stringify(res.state), iso(), conv.id);
  return { conversation_id: Number(conv.id), reply, intent: res.intent, order_id: orderId, outbound_message_id: Number(out.lastInsertRowid) };
}
module.exports = { processMessage, loadKnowledge, callAgent };
