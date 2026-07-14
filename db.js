const { createClient } = require('@libsql/client');
const path = require('path');
const bcrypt = require('bcryptjs');

// Local dev default: a plain SQLite file on disk (works with zero setup).
// Production (e.g. Render): set DATABASE_URL to a Turso libsql:// URL plus
// DATABASE_AUTH_TOKEN so data survives redeploys/restarts on hosts with no
// persistent disk on the free tier. See README for step-by-step instructions.
const url = process.env.DATABASE_URL || `file:${path.join(__dirname, '..', 'data', 'shop.db')}`;
const authToken = process.env.DATABASE_AUTH_TOKEN;

const client = createClient(authToken ? { url, authToken } : { url });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  delivery_type TEXT NOT NULL DEFAULT 'code',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  order_item_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  delivered_code TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS topup_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  amount INTEGER NOT NULL,
  used_by INTEGER,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

async function init() {
  await client.executeMultiple(SCHEMA);

  const adminExists = await client.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (adminExists.rows.length === 0) {
    const hash = bcrypt.hashSync('AdminPass123!', 10);
    await client.execute({
      sql: "INSERT INTO users (username, email, password_hash, role, balance) VALUES (?, ?, ?, 'admin', 0)",
      args: ['admin', 'admin@example.com', hash],
    });
    console.log('Seeded default admin -> username: admin / password: AdminPass123!  (please change immediately)');
  }

  const catCount = await client.execute('SELECT COUNT(*) c FROM categories');
  if (catCount.rows[0].c === 0) {
    const gameCat = await client.execute({ sql: 'INSERT INTO categories (name, slug) VALUES (?, ?)', args: ['เติมเกม / โค้ดเกม', 'game-codes'] });
    const svcCat = await client.execute({ sql: 'INSERT INTO categories (name, slug) VALUES (?, ?)', args: ['บริการดิจิทัล', 'digital-services'] });

    const p1 = await client.execute({
      sql: `INSERT INTO products (category_id, name, slug, description, price, delivery_type) VALUES (?,?,?,?,?,?)`,
      args: [Number(gameCat.lastInsertRowid), 'บัตรเติมเกม 100 บาท', 'game-topup-100', 'โค้ดเติมเงินเกม มูลค่า 100 บาท ใช้งานได้ทันทีหลังชำระเงิน ระบบจะส่งโค้ดให้อัตโนมัติ', 10000, 'code'],
    });
    await client.execute({
      sql: `INSERT INTO products (category_id, name, slug, description, price, delivery_type) VALUES (?,?,?,?,?,?)`,
      args: [Number(svcCat.lastInsertRowid), 'บริการตั้งค่าบัญชีเกม', 'account-setup-service', 'ทีมงานจะติดต่อกลับภายใน 24 ชม. เพื่อดำเนินการตั้งค่าบัญชีให้', 25000, 'manual'],
    });

    const productId = Number(p1.lastInsertRowid);
    for (let i = 1; i <= 5; i++) {
      await client.execute({
        sql: 'INSERT INTO stock_codes (product_id, code) VALUES (?, ?)',
        args: [productId, `DEMO-GAME100-${String(i).padStart(4, '0')}`],
      });
    }
  }
}

const ready = init().catch((e) => {
  console.error('Database initialization failed:', e);
  process.exit(1);
});

module.exports = { client, ready };
