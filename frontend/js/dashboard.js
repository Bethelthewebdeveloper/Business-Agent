const $ = (s) => document.querySelector(s), view = $('#view');
let biz = null;
const ICON = { overview: 'M3 12l9-9 9 9M5 10v10h14V10', agent: 'M12 3v3M5 8h14v10H5zM9 13h.01M15 13h.01', conversations: 'M4 5h16v11H9l-5 4z', customers: 'M16 20v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M10 10a3 3 0 100-6 3 3 0 000 6', orders: 'M6 6h15l-2 9H8zM6 6L5 3H2M9 20h.01M17 20h.01', followups: 'M12 8v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0', knowledge: 'M4 4h12a4 4 0 014 4v12H8a4 4 0 01-4-4zM8 8h8', channels: 'M4 12h16M12 4a14 14 0 010 16M12 4a14 14 0 000 16M12 21a9 9 0 100-18 9 9 0 000 18', analytics: 'M4 20V10M10 20V4M16 20v-8M22 20H2', settings: 'M12 15a3 3 0 100-6 3 3 0 000 6M19 12l2-1-2-4-2 1-2-1-1-2H9L8 7 6 8 4 7 2 11l2 1v1l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1z' };
const NAV = [['overview', 'Overview'], ['agent', 'AI Agent'], ['conversations', 'Conversations'], ['customers', 'Customers'], ['orders', 'Orders'], ['followups', 'Follow-ups'], ['knowledge', 'Knowledge Base'], ['channels', 'Channels & Integrations'], ['analytics', 'Analytics'], ['settings', 'Settings']];
$('#nav').innerHTML = NAV.map(([k, t]) => `<a data-k="${k}"><svg viewBox="0 0 24 24"><path d="${ICON[k]}"/></svg>${t}</a>`).join('');

const toast = (m, bad) => { const d = document.createElement('div'); d.className = 'toast' + (bad ? ' bad' : ''); d.textContent = m; $('#toasts').appendChild(d); setTimeout(() => d.remove(), bad ? 6000 : 3000); };
const fail = (e) => toast(e.message || String(e), true);
const when = (s) => s ? new Date(s).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-';
const CH = { website: ['Website chat', 'blue'], whatsapp: ['Real WhatsApp', 'ok'], simulation: ['SIMULATION', 'sim'] };
const chBadge = (c) => `<span class="badge ${CH[c][1]}">${CH[c][0]}</span>`;
const tone = (s) => ({ Completed: 'ok', Confirmed: 'ok', converted: 'ok', resolved: 'ok', 'Awaiting Payment': 'warn', 'Awaiting Owner Review': 'warn', pending: 'warn', New: 'blue', Cancelled: 'bad', stopped: 'bad', 'Verified by owner': 'ok' }[s] || '');
const badge = (s) => `<span class="badge ${tone(s)}">${esc(s)}</span>`;
const empty = (t, d) => `<div class="empty"><b>${t}</b>${d || ''}</div>`;
const loading = () => { view.innerHTML = '<div class="empty">Loading...</div>'; };
const money = (n) => `${biz.currency} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Copy failed - select the text manually', true); } };

function confirmDlg(msg) { return formDlg('Please confirm', [{ type: 'note', text: msg }], {}, 'Confirm').then(r => !!r); }
function formDlg(title, fields, vals = {}, okText = 'Save') {
  return new Promise((res) => {
    const dlg = $('#dlg'); $('#dlgTitle').textContent = title; $('#dlgOk').textContent = okText;
    $('#dlgBody').innerHTML = fields.map(f => f.type === 'note' ? `<p>${esc(f.text)}</p>` : `<label for="f_${f.name}">${esc(f.label)}</label>` + (f.type === 'textarea' ? `<textarea id="f_${f.name}" name="${f.name}" rows="4" ${f.required ? 'required' : ''}>${esc(vals[f.name] ?? '')}</textarea>`
      : f.type === 'checkbox' ? `<input id="f_${f.name}" name="${f.name}" type="checkbox" style="width:auto" ${vals[f.name] ? 'checked' : ''}>` : `<input id="f_${f.name}" name="${f.name}" type="${f.type || 'text'}" ${f.step ? `step="${f.step}"` : ''} ${f.required ? 'required' : ''} value="${esc(vals[f.name] ?? '')}" ${f.password ? 'autocomplete="new-password"' : ''}>`)).join('');
    dlg.onclose = () => { if (dlg.returnValue !== 'ok') return res(null); const o = {}; for (const f of fields) if (f.name) { const el = $('#f_' + f.name); o[f.name] = f.type === 'checkbox' ? el.checked : el.value; } res(o); };
    dlg.returnValue = ''; dlg.showModal();
  });
}
const act = (fn, ok) => async (...a) => { try { await fn(...a); if (ok) toast(ok); } catch (e) { fail(e); } };

// ---------- sections ----------
const S = {};
S.overview = async () => {
  const [a, prods] = await Promise.all([api('/api/analytics'), api('/api/products')]);
  const link = `${location.origin}/agent-demo.html?b=${biz.id}`;
  const card = (k, v, h) => `<div class="panel stat"><div class="k">${k}</div><div class="v">${v}</div><div class="h">${h || ''}</div></div>`;
  view.innerHTML = `<div class="cards">${card('Conversations', a.conversations)}${card('Customers', a.customers)}${card('Order requests', a.order_requests)}${card('Awaiting review', a.awaiting_review)}${card('Pending handoffs', a.pending_handoffs)}${card('Awaiting follow-up', a.awaiting_followup, 'customers')}</div>
  ${prods.length === 0 ? `<div class="panel"><h2>Get started</h2><ol class="steps"><li>Open <b>Knowledge Base</b> and add your products, prices, delivery details and hours (or load the editable sample catalogue).</li><li>Open <b>AI Agent</b> and test a conversation with the local simulator.</li><li>Share your website chat link with customers.</li></ol></div>` : ''}
  <div class="panel"><h2>Your website chat link</h2><p class="muted sm">Customers can chat with your agent here. Answers come from your Knowledge Base using local rules.</p><div class="row"><code>${esc(link)}</code><button class="btn sm ghost" id="cp">Copy</button><a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Open</a></div></div>
  ${a.conversations === 0 ? `<div class="panel">${empty('No conversations yet', 'Real activity will appear here. Use the simulator under AI Agent to test.')}</div>` : ''}`;
  $('#cp').onclick = () => copy(link);
};

S.agent = async () => {
  const h = await api('/api/agent/health');
  view.innerHTML = `<div class="panel"><h2>Agent status</h2><p>${h.reachable ? '<span class="badge ok">Python agent service running</span>' : '<span class="badge bad">Python agent service not reachable</span> Start it with <code>python python-agent/app.py</code>'}</p>
  <p class="muted sm">This agent uses <b>local rules</b> (intent matching, saved conversation state and your configured information). It is not a large language model, needs no API key, and will not invent answers: unknown questions become handoffs.</p></div>
  <div class="panel"><h2>Greeting</h2><textarea id="gr" rows="2" maxlength="500">${esc(biz.greeting || '')}</textarea><p><button class="btn sm" id="sg">Save greeting</button></p></div>
  <div class="panel"><h2>Local WhatsApp simulator <span class="badge sim">SIMULATION</span></h2><div class="banner">Development tool. Messages go through the real agent logic but are <b>not</b> sent via WhatsApp and are never reported as delivered. Records are labelled "SIMULATION".</div>
  <div class="grid2"><div><label for="sp">Simulated customer phone</label><input id="sp" value="2348000000001"></div><div><label for="sn">Customer name (optional)</label><input id="sn" maxlength="60"></div></div>
  <div class="thread" id="st" style="margin:12px 0"></div><form class="row" id="sf"><input id="sm" placeholder="Type a customer message" style="flex:1" maxlength="1000" required><button class="btn">Send</button><button type="button" class="btn ghost" id="sr">Reset simulated chats</button></form></div>`;
  $('#sg').onclick = act(async () => { await api('/api/business', { method: 'PUT', body: { greeting: $('#gr').value } }); biz.greeting = $('#gr').value; }, 'Greeting saved');
  const st = $('#st'); const line = (cls, t) => { const d = document.createElement('div'); d.className = 'bub ' + cls; d.textContent = t; st.appendChild(d); st.scrollTop = st.scrollHeight; };
  $('#sf').onsubmit = async (e) => { e.preventDefault(); const m = $('#sm').value.trim(); $('#sm').value = ''; line('me', m);
    try { const r = await api('/api/simulate', { method: 'POST', body: { message: m, phone: $('#sp').value, name: $('#sn').value || undefined } }); line('bot', r.reply + (r.order_id ? `\n[Simulated order #${r.order_id} saved]` : '')); } catch (x) { fail(x); } };
  $('#sr').onclick = act(async () => { await api('/api/simulate/reset', { method: 'POST', body: {} }); st.innerHTML = ''; }, 'Simulated conversations reset');
};

S.conversations = async () => {
  const hs = await api('/api/handoffs'), pend = hs.filter(h => h.status === 'pending');
  view.innerHTML = `<div class="panel"><h2>Handoff requests ${pend.length ? `<span class="badge warn">${pend.length} pending</span>` : ''}</h2>
  <p class="muted sm">The app records these in the dashboard only. It does not send external notifications.</p>
  ${hs.length ? hs.slice(0, 20).map(h => `<div style="border-top:1px solid var(--line);padding:10px 0"><div class="row">${badge(h.status)}<b>${esc(h.customer_name || 'Customer')}</b><span class="muted sm">${when(h.created_at)}</span></div><pre class="sum">${esc(h.summary)}</pre>
  <div class="row"><button class="btn sm ghost" data-copy="${h.id}">Copy summary</button><button class="btn sm ghost" data-open="${h.conversation_id}">View conversation</button>${h.status === 'pending' ? `<button class="btn sm" data-res="${h.id}">Mark resolved</button>` : ''}</div></div>`).join('') : empty('No handoffs', 'When the agent cannot answer, a request appears here.')}</div>
  <div class="tools"><select id="cf"><option value="">All channels</option><option value="website">Website chat</option><option value="whatsapp">Real WhatsApp</option><option value="simulation">Simulation</option></select><input id="cq" placeholder="Search name or contact"></div>
  <div class="two"><div class="panel list" id="cl"></div><div class="panel" id="cd">${empty('Select a conversation')}</div></div>`;
  view.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copy(hs.find(h => h.id == b.dataset.copy).summary));
  view.querySelectorAll('[data-res]').forEach(b => b.onclick = act(async () => { await api(`/api/handoffs/${b.dataset.res}/resolve`, { method: 'PUT', body: {} }); S.conversations(); }, 'Handoff resolved'));
  view.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openConv(b.dataset.open));
  const load = async () => { const l = await api(`/api/conversations?channel=${$('#cf').value}&q=${encodeURIComponent($('#cq').value)}`);
    $('#cl').innerHTML = l.length ? l.map(c => `<div class="it" data-id="${c.id}"><div class="row">${chBadge(c.channel)}${c.handoff_status === 'pending' ? '<span class="badge warn">handoff</span>' : ''}${c.status === 'resolved' ? '<span class="badge ok">resolved</span>' : ''}</div><b>${esc(c.customer_name || c.channel_ref)}</b><small>${esc(c.last_message || '')}</small><small>${when(c.updated_at)}</small></div>`).join('') : empty('No conversations');
    $('#cl').querySelectorAll('.it').forEach(i => i.onclick = () => openConv(i.dataset.id)); };
  $('#cf').onchange = load; $('#cq').oninput = load; load();
};
async function openConv(id) {
  const d = await api('/api/conversations/' + id).catch(fail); if (!d) return; const box = $('#cd'); if (!box) return;
  box.innerHTML = `<div class="row" style="justify-content:space-between"><div><b>${esc(d.customer.name || d.customer.channel_ref)}</b> ${chBadge(d.conversation.channel)} ${badge(d.conversation.status)}<div class="muted sm">${esc(d.customer.channel_ref)}${d.orders.length ? ' - Orders: ' + d.orders.map(o => '#' + o.id + ' ' + esc(o.status)).join(', ') : ''}</div></div>${d.conversation.status === 'open' ? '<button class="btn sm" id="rv">Mark resolved</button>' : ''}</div>
  <div class="thread" style="margin-top:12px">${d.messages.map(m => `<div class="bub ${m.direction === 'in' ? 'me' : 'bot'}">${esc(m.body)}<small>${m.direction === 'in' ? 'Customer' : 'Agent'} - ${when(m.created_at)}${m.direction === 'out' ? ' - ' + esc(String(m.delivery_status).replace(/_/g, ' ')) : ''}</small></div>`).join('')}</div>`;
  const rv = $('#rv'); if (rv) rv.onclick = act(async () => { await api(`/api/conversations/${id}/resolve`, { method: 'POST', body: {} }); S.conversations(); }, 'Conversation resolved');
}

S.customers = async () => {
  const l = await api('/api/customers');
  view.innerHTML = `<div class="panel tblw">${l.length ? `<table class="tbl"><tr><th>Customer</th><th>Contact</th><th>Conversations</th><th>Products of interest</th><th>Orders</th><th>Last interaction</th><th>Follow-up</th></tr>${l.map(c => `<tr><td>${esc(c.name || 'Unnamed')}</td><td>${esc(c.phone || c.channel_ref)}</td><td>${c.conversations}</td><td>${esc((c.products_of_interest || '').split(',').join(', ') || '-')}</td><td>${c.orders}</td><td>${when(c.last_interaction)}</td><td>${c.followup_status ? badge(c.followup_status) : '-'}</td></tr>`).join('')}</table>` : empty('No customers yet', 'Customers appear when they message your agent.')}</div>`;
};

const OS = ['New', 'Awaiting Owner Review', 'Confirmed', 'Awaiting Payment', 'Completed', 'Cancelled'];
S.orders = async () => {
  const l = await api('/api/orders');
  view.innerHTML = `<div class="panel tblw">${l.length ? `<table class="tbl"><tr><th>#</th><th>Customer</th><th>Items</th><th>Delivery</th><th>Source</th><th>Order status</th><th>Payment</th></tr>${l.map(o => `<tr><td>${o.id}<div class="muted sm">${when(o.created_at)}</div></td><td>${esc(o.customer_name)}<div class="muted sm">${esc(o.phone || '')}</div></td>
  <td>${o.items.map(i => `${i.quantity} x ${esc(i.product_name)}${i.variation ? ' (' + esc(i.variation) + ')' : ''}<div class="muted sm">${money(i.unit_price)} each</div>`).join('')}${o.notes ? `<div class="muted sm">Notes: ${esc(o.notes)}</div>` : ''}</td><td>${esc(o.address)}</td><td>${chBadge(o.channel)}</td>
  <td><select data-st="${o.id}">${OS.map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
  <td>${badge(o.payment_status)}<div><button class="btn sm ghost" data-pay="${o.id}" data-v="${o.payment_status}" style="margin-top:6px">${o.payment_status === 'Unverified' ? 'Mark verified' : 'Mark unverified'}</button></div></td></tr>`).join('')}</table><p class="muted sm">Payment is separate from order status. This app processes no payments; only mark payment verified after you have confirmed it yourself.</p>` : empty('No orders yet', 'Order requests collected by the agent appear here for your review.')}</div>`;
  view.querySelectorAll('[data-st]').forEach(s => s.onchange = act(async () => { await api('/api/orders/' + s.dataset.st, { method: 'PUT', body: { status: s.value } }); }, 'Order updated'));
  view.querySelectorAll('[data-pay]').forEach(b => b.onclick = act(async () => { if (b.dataset.v === 'Unverified' && !await confirmDlg('Only mark this verified if you have confirmed the payment yourself. Continue?')) return;
    await api('/api/orders/' + b.dataset.pay, { method: 'PUT', body: { payment_status: b.dataset.v === 'Unverified' ? 'Verified by owner' : 'Unverified' } }); S.orders(); }));
};

S.followups = async () => {
  const l = await api('/api/followups');
  view.innerHTML = `<p class="muted sm">Reminders for customers who showed interest but have not ordered. Nothing is sent automatically. WhatsApp sending works only for real WhatsApp customers inside the 24-hour customer-service window.</p>` +
    (l.length ? l.map(f => `<div class="panel"><div class="row">${badge(f.status)}${chBadge(f.channel)}<b>${esc(f.customer_name || f.channel_ref)}</b><span class="muted sm">Interested in ${esc(f.product)} - last interaction ${when(f.last_interaction)} - next follow-up ${when(f.next_date)}</span></div>
    <p class="muted sm" style="margin:6px 0">Reason: ${esc(f.reason)}${f.delivery_status ? ' - WhatsApp status: ' + esc(f.delivery_status.replace(/_/g, ' ')) : ''}</p><pre class="sum">${esc(f.suggested_message)}</pre>
    <div class="row"><button class="btn sm ghost" data-e="${f.id}">Edit</button><button class="btn sm ghost" data-c="${f.id}">Copy</button>${f.status === 'pending' || f.status === 'sent' ? `<button class="btn sm ghost" data-s="${f.id}" data-v="sent">Mark as sent</button><button class="btn sm ghost" data-s="${f.id}" data-v="converted">Mark converted</button><button class="btn sm danger" data-s="${f.id}" data-v="stopped">Stop follow-ups</button>${f.channel === 'whatsapp' ? `<button class="btn sm" data-w="${f.id}">Send via WhatsApp</button>` : ''}` : ''}</div></div>`).join('') : `<div class="panel">${empty('No follow-ups', 'When a customer asks about a product but does not order, a reminder is created.')}</div>`);
  view.querySelectorAll('[data-c]').forEach(b => b.onclick = () => copy(l.find(f => f.id == b.dataset.c).suggested_message));
  view.querySelectorAll('[data-e]').forEach(b => b.onclick = act(async () => { const f = l.find(x => x.id == b.dataset.e);
    const r = await formDlg('Edit follow-up', [{ name: 'suggested_message', label: 'Message', type: 'textarea', required: true }, { name: 'next_date', label: 'Next follow-up date', type: 'date', required: true }], { suggested_message: f.suggested_message, next_date: f.next_date.slice(0, 10) });
    if (r) { await api('/api/followups/' + f.id, { method: 'PUT', body: r }); S.followups(); } }));
  view.querySelectorAll('[data-s]').forEach(b => b.onclick = act(async () => { if (b.dataset.v === 'stopped' && !await confirmDlg('Stop all future follow-ups for this item?')) return; await api('/api/followups/' + b.dataset.s, { method: 'PUT', body: { status: b.dataset.v } }); S.followups(); }, 'Updated'));
  view.querySelectorAll('[data-w]').forEach(b => b.onclick = act(async () => { if (!await confirmDlg('Send this message to the customer on WhatsApp now?')) return; const r = await api(`/api/followups/${b.dataset.w}/send-whatsapp`, { method: 'POST', body: {} }); toast(r.note); S.followups(); }));
};

S.knowledge = async () => {
  const [b, ps, fs] = await Promise.all([api('/api/business'), api('/api/products'), api('/api/faqs')]); biz = { ...biz, ...b };
  view.innerHTML = `<div class="panel"><h2>Business information</h2><p class="muted sm">Changes apply immediately to website chat, WhatsApp and the simulator.</p><div class="grid2">
  <div><label>Currency (3-letter code)</label><input id="k_currency" value="${esc(b.currency)}" maxlength="3"></div><div><label>Opening hours</label><textarea id="k_hours" rows="2">${esc(b.hours || '')}</textarea></div>
  <div><label>Delivery information</label><textarea id="k_delivery_info" rows="3">${esc(b.delivery_info || '')}</textarea></div><div><label>Payment instructions</label><textarea id="k_payment_info" rows="3">${esc(b.payment_info || '')}</textarea></div>
  <div><label>Business policies (returns, refunds...)</label><textarea id="k_policies" rows="3">${esc(b.policies || '')}</textarea></div></div><p><button class="btn sm" id="ks">Save information</button></p></div>
  <div class="panel"><div class="row" style="justify-content:space-between"><h2>Products and services</h2><div class="row"><button class="btn sm ghost" id="sample">Load sample catalogue</button><button class="btn sm" id="addp">Add product</button></div></div>
  <div class="tblw">${ps.length ? `<table class="tbl"><tr><th>Name</th><th>Price</th><th>Variations</th><th>Available</th><th></th></tr>${ps.map(p => `<tr><td>${esc(p.name)}<div class="muted sm">${esc(p.description || '')}</div></td><td>${money(p.price)}</td><td>${esc(p.variations || '-')}</td><td>${p.available ? 'Yes' : 'No'}</td><td class="row"><button class="btn sm ghost" data-ep="${p.id}">Edit</button><button class="btn sm danger" data-dp="${p.id}">Delete</button></td></tr>`).join('')}</table>` : empty('No products yet', 'Add what you sell so the agent can answer price and order questions.')}</div></div>
  <div class="panel"><div class="row" style="justify-content:space-between"><h2>FAQs</h2><button class="btn sm" id="addf">Add FAQ</button></div>${fs.length ? `<div class="tblw"><table class="tbl"><tr><th>Question</th><th>Answer</th><th></th></tr>${fs.map(f => `<tr><td>${esc(f.question)}</td><td>${esc(f.answer)}</td><td class="row"><button class="btn sm ghost" data-ef="${f.id}">Edit</button><button class="btn sm danger" data-df="${f.id}">Delete</button></td></tr>`).join('')}</table></div>` : empty('No FAQs yet')}</div>`;
  $('#ks').onclick = act(async () => { await api('/api/business', { method: 'PUT', body: { currency: $('#k_currency').value, hours: $('#k_hours').value, delivery_info: $('#k_delivery_info').value, payment_info: $('#k_payment_info').value, policies: $('#k_policies').value } }); S.knowledge(); }, 'Saved');
  $('#sample').onclick = act(async () => { await api('/api/sample-catalog', { method: 'POST', body: {} }); S.knowledge(); }, 'Sample items added - edit or delete them as needed');
  const PF = [{ name: 'name', label: 'Name', required: true }, { name: 'price', label: 'Price', type: 'number', step: '0.01', required: true }, { name: 'variations', label: 'Variations / sizes (comma separated)' }, { name: 'description', label: 'Description' }, { name: 'available', label: 'Available', type: 'checkbox' }];
  $('#addp').onclick = act(async () => { const r = await formDlg('Add product', PF, { available: true }); if (r) { await api('/api/products', { method: 'POST', body: r }); S.knowledge(); } });
  view.querySelectorAll('[data-ep]').forEach(x => x.onclick = act(async () => { const p = ps.find(q => q.id == x.dataset.ep); const r = await formDlg('Edit product', PF, p); if (r) { await api('/api/products/' + p.id, { method: 'PUT', body: r }); S.knowledge(); } }));
  view.querySelectorAll('[data-dp]').forEach(x => x.onclick = act(async () => { if (await confirmDlg('Delete this product?')) { await api('/api/products/' + x.dataset.dp, { method: 'DELETE' }); S.knowledge(); } }));
  const FF = [{ name: 'question', label: 'Question', required: true }, { name: 'answer', label: 'Answer', type: 'textarea', required: true }];
  $('#addf').onclick = act(async () => { const r = await formDlg('Add FAQ', FF); if (r) { await api('/api/faqs', { method: 'POST', body: r }); S.knowledge(); } });
  view.querySelectorAll('[data-ef]').forEach(x => x.onclick = act(async () => { const f = fs.find(q => q.id == x.dataset.ef); const r = await formDlg('Edit FAQ', FF, f); if (r) { await api('/api/faqs/' + f.id, { method: 'PUT', body: r }); S.knowledge(); } }));
  view.querySelectorAll('[data-df]').forEach(x => x.onclick = act(async () => { if (await confirmDlg('Delete this FAQ?')) { await api('/api/faqs/' + x.dataset.df, { method: 'DELETE' }); S.knowledge(); } }));
};

S.channels = async () => {
  const w = await api('/api/whatsapp'), ig = w.integration || {};
  const st = !w.configured ? ['Not connected', 'bad'] : ig.status === 'connected' ? ['Connected (verified with Meta)', 'ok'] : ig.status === 'error' ? ['Connection error', 'bad'] : ['Credentials saved, not verified', 'warn'];
  const row = (k, v) => `<tr><td class="muted">${k}</td><td>${v || '-'}</td></tr>`;
  view.innerHTML = `<div class="panel"><h2>WhatsApp (Meta Cloud API)</h2><span class="badge ${st[1]}">${st[0]}</span>
  <table class="tbl" style="margin-top:12px">${row('Connected phone number', esc(ig.display_phone))}${row('Phone Number ID', esc(ig.phone_number_id))}${row('Business Account ID', esc(ig.waba_id))}${row('Automated replies', w.configured ? (ig.auto_reply ? 'On (only when connected)' : 'Off') : '-')}
  ${row('Webhook verified by Meta', ig.webhook_verified_at ? when(ig.webhook_verified_at) : 'Not yet')}${row('Last webhook received', ig.last_webhook_at ? when(ig.last_webhook_at) : 'Never')}${row('Last successful connection check', ig.verified_at ? when(ig.verified_at) : 'Never')}${row('Recent integration error', ig.last_error ? `<span style="color:var(--bad)">${esc(ig.last_error)}</span>` : 'None')}</table>
  <div class="row" style="margin-top:14px"><button class="btn" id="cw">${w.configured ? 'Update WhatsApp connection' : 'Connect WhatsApp'}</button>${w.configured ? '<button class="btn ghost" id="chk">Run connection check</button><button class="btn danger" id="rm">Disconnect</button>' : ''}</div></div>
  <div class="panel"><h2>Setup instructions</h2>${w.app_secret_configured ? '' : '<div class="banner">META_APP_SECRET is not set on the server, so real webhooks are rejected. Add it to .env and restart.</div>'}
  <ol class="steps"><li>In <b>developers.facebook.com</b> create (or pick) a Meta app of type Business and add the <b>WhatsApp</b> product.</li><li>Copy the <b>Phone Number ID</b> and <b>WhatsApp Business Account ID</b>, and create a (system-user) access token with <code>whatsapp_business_messaging</code> permission.</li><li>Click <b>Connect WhatsApp</b> above and enter those values. The token is stored on the server only.</li><li>Put the app's <b>App Secret</b> in <code>.env</code> as META_APP_SECRET and restart the server.</li><li>Expose this server over public HTTPS (for development use a tunnel such as ngrok or Cloudflare Tunnel), and set <code>PUBLIC_BASE_URL</code>.</li><li>In Meta's WhatsApp configuration set Callback URL to <code>${esc(w.webhook_url)}</code> and Verify token to <code>${esc(w.verify_token || '(save credentials first)')}</code>, then subscribe to the <b>messages</b> field.</li><li>Click <b>Run connection check</b>, then send a message to your WhatsApp number to test. Follow Meta's current docs; requirements vary by account.</li></ol></div>`;
  $('#cw').onclick = act(async () => { const r = await formDlg('WhatsApp credentials', [{ name: 'phone_number_id', label: 'Phone Number ID', required: true }, { name: 'waba_id', label: 'WhatsApp Business Account ID' }, { name: 'access_token', label: w.configured ? 'Access token (leave blank to keep current)' : 'Access token', type: 'password', required: !w.configured, password: true }, { name: 'auto_reply', label: 'Reply automatically to customer messages', type: 'checkbox' }], { phone_number_id: ig.phone_number_id, waba_id: ig.waba_id, auto_reply: !!ig.auto_reply });
    if (r) { await api('/api/whatsapp', { method: 'PUT', body: r }); toast('Saved. Now run the connection check.'); S.channels(); } });
  const chk = $('#chk'); if (chk) chk.onclick = act(async () => { const r = await api('/api/whatsapp/check', { method: 'POST', body: {} }); toast(r.ok ? 'Connection verified with Meta' : 'Check failed: ' + r.error, !r.ok); S.channels(); });
  const rm = $('#rm'); if (rm) rm.onclick = act(async () => { if (await confirmDlg('Disconnect WhatsApp and delete the stored credentials?')) { await api('/api/whatsapp', { method: 'DELETE' }); S.channels(); } });
};

S.analytics = async () => {
  const f = view.dataset.from || '', t = view.dataset.to || '';
  const a = await api(`/api/analytics?from=${f}&to=${t}`);
  const card = (k, v, h) => `<div class="panel stat"><div class="k">${k}</div><div class="v">${v}</div><div class="h">${h || ''}</div></div>`;
  const max = Math.max(1, ...a.activity.map(x => x.total)), hb = (l) => l.length ? l.map(x => `<div class="hbar"><span style="min-width:120px">${esc(x.name)}</span><i style="width:${Math.max(4, x.total / Math.max(...l.map(y => y.total)) * 160)}px"></i>${x.total}</div>`).join('') : empty('No data yet');
  view.innerHTML = `<div class="tools"><label style="margin:0">From</label><input type="date" id="af" value="${f}"><label style="margin:0">To</label><input type="date" id="at" value="${t}"><button class="btn sm" id="ap">Apply</button><button class="btn sm ghost" id="ac">Clear</button></div>
  <div class="cards">${card('Conversations', a.conversations)}${card('Unique customers', a.customers)}${card('Order requests', a.order_requests, 'submitted by customers')}${card('Confirmed orders', a.confirmed_orders, 'Confirmed, awaiting payment or completed')}${card('Awaiting review', a.awaiting_review)}${card('Awaiting payment', a.awaiting_payment)}${card('Completed', a.completed_orders)}${card('Verified paid', a.verified_paid_orders, 'marked verified by owner')}${card('Pending handoffs', a.pending_handoffs)}${card('Awaiting follow-up', a.awaiting_followup)}${card('Conversion rate', a.conversion_rate === null ? '-' : a.conversion_rate + '%', 'customers who placed an order request')}</div>
  <div class="panel"><h2>Conversations per day</h2>${a.activity.length ? `<div class="bars">${a.activity.map(x => `<div style="height:${x.total / max * 100}%"><span>${x.total}</span></div>`).join('')}</div><div class="bl">${a.activity.map(x => `<span>${x.day.slice(5)}</span>`).join('')}</div>` : empty('No conversations in this period')}</div>
  <div class="grid2"><div class="panel"><h2>Most ordered products</h2>${hb(a.top_ordered)}</div><div class="panel"><h2>Most asked-about products</h2>${hb(a.top_inquired)}</div><div class="panel"><h2>By channel</h2>${a.by_channel.length ? a.by_channel.map(c => `<p>${chBadge(c.channel)} ${c.total}</p>`).join('') : empty('No data yet')}</div></div>`;
  $('#ap').onclick = () => { view.dataset.from = $('#af').value; view.dataset.to = $('#at').value; S.analytics(); };
  $('#ac').onclick = () => { view.dataset.from = view.dataset.to = ''; S.analytics(); };
};

S.settings = async () => {
  const me = await api('/api/auth/me');
  view.innerHTML = `<div class="panel"><h2>Business</h2><label>Business name</label><input id="s_name" value="${esc(biz.name)}" maxlength="100"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="s_pub" style="width:auto" ${biz.chat_public ? 'checked' : ''}> Show my business in the public chat list and allow website chat</label><p><button class="btn sm" id="sv">Save</button></p></div>
  <div class="panel"><h2>Account</h2><p>Signed in as <b>${esc(me.email)}</b></p><p class="muted sm">Passwords are hashed on the server. Sessions use an HttpOnly cookie.</p></div>`;
  $('#sv').onclick = act(async () => { await api('/api/business', { method: 'PUT', body: { name: $('#s_name').value, chat_public: $('#s_pub').checked } }); biz.name = $('#s_name').value; biz.chat_public = $('#s_pub').checked ? 1 : 0; $('#who').textContent = biz.name; }, 'Saved');
};

// ---------- boot ----------
async function show(k) {
  if (!S[k]) k = 'overview';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.k === k));
  $('#title').textContent = NAV.find(n => n[0] === k)[1]; $('#side').classList.remove('open'); loading();
  try { await S[k](); } catch (e) { view.innerHTML = `<div class="panel">${empty('Something went wrong', esc(e.message))}</div>`; }
}
$('#nav').onclick = (e) => { const a = e.target.closest('a'); if (a) { location.hash = a.dataset.k; } };
window.onhashchange = () => show(location.hash.slice(1));
$('#menu').onclick = () => $('#side').classList.toggle('open');
$('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); location.href = '/login.html'; };
(async () => { try { const me = await api('/api/auth/me'); biz = await api('/api/business'); $('#who').textContent = biz.name; show(location.hash.slice(1) || 'overview'); } catch { location.href = '/login.html'; } })();
