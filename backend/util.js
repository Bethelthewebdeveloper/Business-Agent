class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const iso = () => new Date().toISOString();
const str = (v, { min = 0, max = 2000, name = 'Field' } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw new HttpError(400, `${name} is required`);
  if (s.length > max) throw new HttpError(400, `${name} is too long (max ${max})`);
  return s;
};
const price = (v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new HttpError(400, 'Price must be a number between 0 and 1,000,000,000');
  return Math.round(n * 100) / 100;
};
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
module.exports = { HttpError, iso, str, price, emailRe };
