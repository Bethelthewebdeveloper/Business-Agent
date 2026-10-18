const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Idempotent initialisation script (CREATE IF NOT EXISTS). For future migrations bump SCHEMA_VERSION and add ALTERs.
const SCHEMA_VERSION = 1;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS businesses(id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, greeting TEXT, hours TEXT, delivery_info TEXT, payment_info TEXT, policies TEXT, currency TEXT NOT NULL DEFAULT 'NGN',
  chat_public INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL, price REAL NOT NULL CHECK(price>=0), variations TEXT, description TEXT, available INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_products_b ON products(business_id);
CREATE TABLE IF NOT EXISTS faqs(id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, question TEXT NOT NULL, answer TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_faqs_b ON faqs(business_id);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel_ref TEXT NOT NULL, name TEXT, phone TEXT, created_at TEXT NOT NULL, UNIQUE(business_id, channel_ref));
CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel IN ('website','whatsapp','simulation')),
  state TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  handoff_status TEXT NOT NULL DEFAULT 'none' CHECK(handoff_status IN ('none','pending','resolved')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_conv_b ON conversations(business_id, updated_at);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('in','out')), sender TEXT NOT NULL,
  body TEXT NOT NULL, wa_message_id TEXT, delivery_status TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_msg_c ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS ix_msg_wa ON messages(wa_message_id);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id), conversation_id INTEGER REFERENCES conversations(id),
  status TEXT NOT NULL DEFAULT 'Awaiting Owner Review' CHECK(status IN ('New','Awaiting Owner Review','Confirmed','Awaiting Payment','Completed','Cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'Unverified' CHECK(payment_status IN ('Unverified','Verified by owner')),
  customer_name TEXT NOT NULL, phone TEXT, address TEXT NOT NULL, notes TEXT, channel TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_orders_b ON orders(business_id, status);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), variation TEXT, unit_price REAL NOT NULL);
CREATE TABLE IF NOT EXISTS handoffs(id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, customer_id INTEGER NOT NULL,
  reason TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),
  created_at TEXT NOT NULL, resolved_at TEXT);
CREATE INDEX IF NOT EXISTS ix_handoffs_b ON handoffs(business_id, status);
CREATE TABLE IF NOT EXISTS followups(id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id), conversation_id INTEGER NOT NULL, product TEXT NOT NULL, reason TEXT NOT NULL,
  suggested_message TEXT NOT NULL, next_date TEXT NOT NULL, last_interaction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','converted','stopped')), sent_at TEXT, delivery_status TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_fu_b ON followups(business_id, status);
CREATE TABLE IF NOT EXISTS whatsapp_integrations(id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL UNIQUE, waba_id TEXT, display_phone TEXT, auto_reply INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'configured', verified_at TEXT, webhook_verified_at TEXT, last_webhook_at TEXT, last_error TEXT, updated_at TEXT NOT NULL);
-- Secrets live in their own table and are never returned by any API except the owner-only webhook verify token.
CREATE TABLE IF NOT EXISTS whatsapp_secrets(business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE, access_token TEXT NOT NULL, verify_token TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS whatsapp_events(id INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, business_id INTEGER, kind TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schema_info(version INTEGER NOT NULL);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec(SCHEMA);
  if (!db.prepare('SELECT 1 FROM schema_info').get()) db.prepare('INSERT INTO schema_info(version) VALUES(?)').run(SCHEMA_VERSION);
  return db;
}
module.exports = { open };
