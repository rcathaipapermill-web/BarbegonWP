const express = require('express');
const crypto = require('crypto');
const { all, get, run } = require('../db/helpers');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const usersCount = await get('SELECT COUNT(*) c FROM users');
    const ordersCount = await get('SELECT COUNT(*) c FROM orders');
    const revenueRow = await get("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status='completed'");
    const lowStock = await all(`
      SELECT p.name, COUNT(s.id) cnt FROM products p
      LEFT JOIN stock_codes s ON s.product_id = p.id AND s.status='available'
      WHERE p.delivery_type='code' AND p.active=1
      GROUP BY p.id HAVING cnt < 3
    `);
    const stats = {
      users: usersCount.c,
      orders: ordersCount.c,
      revenue: revenueRow.s,
      lowStock,
    };
    res.render('admin/dashboard', { title: 'แผงควบคุมผู้ดูแลระบบ', stats });
  } catch (e) { next(e); }
});

// Products
router.get('/products', async (req, res, next) => {
  try {
    const products = await all(`
      SELECT p.*, c.name AS category_name,
        (SELECT COUNT(*) FROM stock_codes s WHERE s.product_id=p.id AND s.status='available') AS stock_count
      FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.created_at DESC
    `);
    const categories = await all('SELECT * FROM categories ORDER BY name');
    res.render('admin/products', { title: 'จัดการสินค้า', products, categories, error: null });
  } catch (e) { next(e); }
});

router.post('/products', async (req, res, next) => {
  try {
    const { name, category_id, price, description, delivery_type } = req.body;
    if (!name || !price) return res.redirect('/admin/products');
    const slug = slugify(name) + '-' + crypto.randomBytes(3).toString('hex');
    const priceInt = Math.round(parseFloat(price) * 100);
    await run(
      `INSERT INTO products (category_id, name, slug, description, price, delivery_type) VALUES (?,?,?,?,?,?)`,
      [category_id || null, name, slug, description || '', priceInt, delivery_type === 'manual' ? 'manual' : 'code']
    );
    res.redirect('/admin/products');
  } catch (e) { next(e); }
});

router.post('/products/:id/toggle', async (req, res, next) => {
  try {
    await run('UPDATE products SET active = 1 - active WHERE id = ?', [req.params.id]);
    res.redirect('/admin/products');
  } catch (e) { next(e); }
});

router.post('/products/:id/stock', async (req, res, next) => {
  try {
    const codes = (req.body.codes || '').split('\n').map((s) => s.trim()).filter(Boolean);
    for (const c of codes) {
      await run('INSERT INTO stock_codes (product_id, code) VALUES (?, ?)', [req.params.id, c]);
    }
    res.redirect('/admin/products');
  } catch (e) { next(e); }
});

router.get('/categories', async (req, res, next) => {
  try {
    const categories = await all('SELECT * FROM categories ORDER BY name');
    res.render('admin/categories', { title: 'จัดการหมวดหมู่', categories });
  } catch (e) { next(e); }
});

router.post('/categories', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (name && name.trim()) {
      try {
        await run('INSERT INTO categories (name, slug) VALUES (?, ?)', [name.trim(), slugify(name)]);
      } catch (e) { /* ignore duplicate */ }
    }
    res.redirect('/admin/categories');
  } catch (e) { next(e); }
});

// Orders
router.get('/orders', async (req, res, next) => {
  try {
    const orders = await all(`
      SELECT o.*, u.username FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 200
    `);
    res.render('admin/orders', { title: 'คำสั่งซื้อทั้งหมด', orders });
  } catch (e) { next(e); }
});

// Users
router.get('/users', async (req, res, next) => {
  try {
    const users = await all('SELECT id, username, email, role, balance, created_at FROM users ORDER BY created_at DESC');
    res.render('admin/users', { title: 'จัดการผู้ใช้', users });
  } catch (e) { next(e); }
});

// Top-up codes
router.get('/topup-codes', async (req, res, next) => {
  try {
    const codes = await all('SELECT * FROM topup_codes ORDER BY created_at DESC LIMIT 200');
    res.render('admin/topup-codes', { title: 'โค้ดเติมเงิน', codes });
  } catch (e) { next(e); }
});

router.post('/topup-codes', async (req, res, next) => {
  try {
    const amount = Math.round(parseFloat(req.body.amount || '0') * 100);
    const count = Math.min(parseInt(req.body.count || '1', 10), 100);
    if (amount > 0) {
      for (let i = 0; i < count; i++) {
        const code = 'TOPUP-' + crypto.randomBytes(5).toString('hex').toUpperCase();
        await run('INSERT INTO topup_codes (code, amount) VALUES (?, ?)', [code, amount]);
      }
    }
    res.redirect('/admin/topup-codes');
  } catch (e) { next(e); }
});

function slugify(str) {
  return str.toString().trim().toLowerCase()
    .replace(/[^a-z0-9ก-๙\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'item';
}

module.exports = router;
