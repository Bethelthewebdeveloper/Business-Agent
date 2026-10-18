const crypto = require('crypto');
const { HttpError, iso, str, emailRe } = require('./util');

const hashPassword = (pw) => { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
const checkPassword = (pw, stored) => {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const a = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const WEEK = 7 * 24 * 3600 * 1000;

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha(token), userId, new Date(Date.now() + WEEK).toISOString());
  return token;
}
const cookieHeader = (token, secure, maxAge = WEEK / 1000) =>
  `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

function userFromRequest(db, req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const row = db.prepare('SELECT u.id,u.email,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(sha(m[1]));
  if (!row) return null;
  if (row.expires_at < iso()) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(m[1])); return null; }
  return { id: row.id, email: row.email, token: m[1] };
}

function register(db, body) {
  const email = str(body.email, { min: 3, max: 200, name: 'Email' }).toLowerCase();
  if (!emailRe.test(email)) throw new HttpError(400, 'Enter a valid email address');
  const pw = typeof body.password === 'string' ? body.password : '';
  if (pw.length < 10 || pw.length > 200) throw new HttpError(400, 'Password must be at least 10 characters');
  const name = str(body.business_name, { min: 2, max: 100, name: 'Business name' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'An account with this email already exists');
  const now = iso();
  const u = db.prepare('INSERT INTO users(email,password_hash,created_at) VALUES(?,?,?)').run(email, hashPassword(pw), now);
  db.prepare('INSERT INTO businesses(owner_id,name,greeting,created_at) VALUES(?,?,?,?)')
    .run(u.lastInsertRowid, name, `Hello! Welcome to ${name}. How can I help you today?`, now);
  return Number(u.lastInsertRowid);
}
function login(db, body) {
  const email = String(body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  // Always run a hash comparison so unknown emails take similar time.
  const ok = checkPassword(String(body.password || ''), u ? u.password_hash : 'scrypt$00$00');
  if (!u || !ok) throw new HttpError(401, 'Incorrect email or password');
  return u.id;
}
module.exports = { register, login, createSession, cookieHeader, userFromRequest, sha };
