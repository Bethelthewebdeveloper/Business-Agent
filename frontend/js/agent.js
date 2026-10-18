// Customer-facing website chat. Talks to the same agent pipeline as WhatsApp.
(async () => {
  const q = new URLSearchParams(location.search), pick = document.getElementById('pick'), chat = document.getElementById('chat'), msgs = document.getElementById('msgs');
  let bid = Number(q.get('b'));
  const add = (cls, text) => { const d = document.createElement('div'); d.className = 'bub ' + cls; d.textContent = text; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; };
  if (!bid) {
    const list = await api('/api/public/businesses').catch(() => []);
    pick.innerHTML = list.length ? '<h2>Choose a business to chat with</h2>' + list.map(b => `<p><a class="btn ghost" href="?b=${b.id}">${esc(b.name)}</a></p>`).join('')
      : '<div class="card"><h3>No businesses yet</h3><p>Nobody has created a business agent on this server yet. <a href="/register.html">Create one</a>, add a few products, then chat with it here.</p></div>';
    return;
  }
  let biz; try { biz = await api('/api/public/business/' + bid); } catch { pick.innerHTML = '<div class="card">This chat is not available.</div>'; return; }
  document.getElementById('bn').textContent = biz.name; chat.hidden = false;
  let sid = sessionStorage.getItem('sid'); if (!sid) { sid = crypto.randomUUID().replace(/-/g, ''); sessionStorage.setItem('sid', sid); }
  add('bot', biz.greeting || `Hello! Welcome to ${biz.name}.`);
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault(); const t = document.getElementById('t'), text = t.value.trim(); if (!text) return; t.value = ''; add('me', text);
    try { add('bot', (await api('/api/public/chat', { method: 'POST', body: { business_id: bid, session_id: sid, message: text } })).reply); }
    catch (x) { add('bot', 'Sorry, something went wrong: ' + x.message); }
  });
})();
