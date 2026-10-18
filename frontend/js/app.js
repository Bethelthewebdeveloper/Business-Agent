// Login / registration form handling.
const form = document.getElementById('authForm');
if (form) form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err'), btn = form.querySelector('button'); err.textContent = ''; btn.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(form));
    await api(form.dataset.endpoint, { method: 'POST', body });
    location.href = '/dashboard.html';
  } catch (x) { err.textContent = x.message; btn.disabled = false; }
});
