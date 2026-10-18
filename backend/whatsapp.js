// Official WhatsApp Business Cloud API client + webhook handling. No unofficial libraries.
const crypto = require('crypto');
const { HttpError, iso } = require('./util');
const { processMessage } = require('./pipeline');

const secretsFor = (db, bid) => db.prepare('SELECT * FROM whatsapp_secrets WHERE business_id=?').get(bid);
const redact = (s, token) => String(s).split(token || '\u0000').join('[redacted]').slice(0, 400);

async function graph(app, bid, method, path, body) {
  const sec = secretsFor(app.db, bid);
  if (!sec) throw new HttpError(400, 'WhatsApp credentials are not configured');
  let r;
  try {
    r = await fetch(`${app.cfg.graphBase}/${app.cfg.graphVersion}/${path}`, { method, headers: { authorization: `Bearer ${sec.access_token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  } catch (e) { return { ok: false, status: 0, error: 'Network error contacting the WhatsApp API' }; }
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) return { ok: false, status: r.status, error: redact((j.error && j.error.message) || `HTTP ${r.status}`, sec.access_token) + (r.status === 429 ? ' (rate limited; retry later)' : '') };
  return { ok: true, data: j };
}
const setErr = (db, bid, msg) => db.prepare("UPDATE whatsapp_integrations SET last_error=?, updated_at=? WHERE business_id=?").run(msg, iso(), bid);

async function checkConnection(app, bid) {
  const ig = app.db.prepare('SELECT * FROM whatsapp_integrations WHERE business_id=?').get(bid);
  if (!ig) throw new HttpError(400, 'WhatsApp is not configured');
  const r = await graph(app, bid, 'GET', `${ig.phone_number_id}?fields=display_phone_number,verified_name`);
  if (!r.ok) { app.db.prepare("UPDATE whatsapp_integrations SET status='error', last_error=?, updated_at=? WHERE business_id=?").run(r.error, iso(), bid); return { ok: false, error: r.error }; }
  app.db.prepare("UPDATE whatsapp_integrations SET status='connected', verified_at=?, last_error=NULL, display_phone=?, updated_at=? WHERE business_id=?").run(iso(), r.data.display_phone_number || null, iso(), bid);
  return { ok: true };
}

// Returns { ok, wamid } only when the Cloud API accepted the request. "Accepted" is NOT "delivered".
async function sendText(app, bid, to, text) {
  const ig = app.db.prepare('SELECT * FROM whatsapp_integrations WHERE business_id=?').get(bid);
  if (!ig || ig.status !== 'connected') return { ok: false, error: 'WhatsApp is not connected and verified for this business' };
  if (!/^\d{7,15}$/.test(to)) return { ok: false, error: 'Invalid destination number' };
  if (!text || text.length > 4000) return { ok: false, error: 'Message must be 1-4000 characters' };
  const r = await graph(app, bid, 'POST', `${ig.phone_number_id}/messages`, { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } });
  if (!r.ok) { setErr(app.db, bid, r.error); return { ok: false, error: r.error }; }
  return { ok: true, wamid: r.data.messages && r.data.messages[0] && r.data.messages[0].id };
}

function verifyChallenge(app, q) {
  if (q['hub.mode'] !== 'subscribe' || !q['hub.verify_token']) throw new HttpError(403, 'Verification failed');
  const row = app.db.prepare('SELECT business_id FROM whatsapp_secrets WHERE verify_token=?').get(q['hub.verify_token']);
  if (!row) throw new HttpError(403, 'Verification failed');
  app.db.prepare('UPDATE whatsapp_integrations SET webhook_verified_at=? WHERE business_id=?').run(iso(), row.business_id);
  return String(q['hub.challenge'] || '');
}

function validSignature(secret, raw, header) {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const want = crypto.createHmac('sha256', secret).update(raw).digest();
  const got = Buffer.from(header.slice(7), 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

async function handleWebhook(app, raw, sigHeader) {
  if (!app.cfg.appSecret) throw new HttpError(503, 'META_APP_SECRET is not configured; real webhooks are disabled');
  if (!validSignature(app.cfg.appSecret, raw, sigHeader)) throw new HttpError(401, 'Invalid signature');
  let body; try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
  if (body.object !== 'whatsapp_business_account') return { ignored: true };
  const { db } = app; let processed = 0, dup = 0;
  for (const entry of body.entry || []) for (const ch of entry.changes || []) {
    const v = ch.value || {}; const pnid = v.metadata && v.metadata.phone_number_id;
    const ig = pnid && db.prepare('SELECT * FROM whatsapp_integrations WHERE phone_number_id=?').get(String(pnid));
    if (!ig) continue; // not one of our authorised businesses
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(ig.business_id);
    db.prepare('UPDATE whatsapp_integrations SET last_webhook_at=? WHERE id=?').run(iso(), ig.id);
    for (const s of v.statuses || []) { // delivery updates: never trigger a reply
      const key = `st:${s.id}:${s.status}`;
      if (db.prepare('INSERT OR IGNORE INTO whatsapp_events(event_id,business_id,kind,created_at) VALUES(?,?,?,?)').run(key, b.id, 'status', iso()).changes === 0) continue;
      db.prepare('UPDATE messages SET delivery_status=? WHERE wa_message_id=? AND business_id=?').run(s.status, s.id, b.id);
      if (s.status === 'failed') setErr(db, b.id, `Message ${s.id} failed: ${(s.errors && s.errors[0] && s.errors[0].title) || 'unknown'}`);
    }
    for (const m of v.messages || []) {
      if (db.prepare('INSERT OR IGNORE INTO whatsapp_events(event_id,business_id,kind,created_at) VALUES(?,?,?,?)').run(`msg:${m.id}`, b.id, 'message', iso()).changes === 0) { dup++; continue; }
      try {
        const name = (v.contacts || []).find(c => c.wa_id === m.from)?.profile?.name;
        const isText = m.type === 'text' && m.text && m.text.body;
        const auto = ig.auto_reply && ig.status === 'connected';
        const res = await processMessage(app, { business: b, channel: 'whatsapp', ref: m.from, name, phone: m.from, text: isText ? m.text.body : '', waMessageId: m.id, skipAgent: !auto });
        processed++;
        if (res.reply && res.outbound_message_id) {
          const sent = await sendText(app, b.id, m.from, res.reply);
          db.prepare('UPDATE messages SET delivery_status=?, wa_message_id=? WHERE id=?').run(sent.ok ? 'accepted_by_api' : 'send_failed', sent.wamid || null, res.outbound_message_id);
        }
      } catch (e) { setErr(db, b.id, `Processing failed: ${e.message}`); }
    }
  }
  return { processed, duplicates: dup };
}
module.exports = { checkConnection, sendText, verifyChallenge, handleWebhook, validSignature };
