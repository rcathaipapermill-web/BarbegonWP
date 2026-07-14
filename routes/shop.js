const express = require('express');
const { all, get, client } = require('../db/helpers');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const categories = await all('SELECT * FROM categories ORDER BY id');
    const products = await all(`
      SELECT p.*, c.name AS category_name,
        (SELECT COUNT(*) FROM stock_codes s WHERE s.product_id = p.id AND s.status='available') AS stock_count
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1
      ORDER BY p.created_at DESC
    `);
    res.render('home', { title: 'ร้านค้าดิจิทัล', categories, products });
  } catch (e) { next(e); }
});

router.get('/product/:slug', async (req, res, next) => {
  try {
    const product = await get(`
      SELECT p.*, c.name AS category_name,
        (SELECT COUNT(*) FROM stock_codes s WHERE s.product_id = p.id AND s.status='available') AS stock_count
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.slug = ? AND p.active = 1
    `, [req.params.slug]);
    if (!product) return res.status(404).render('error', { title: 'ไม่พบสินค้า', message: 'ไม่พบสินค้าที่คุณต้องการ' });
    res.render('product', { title: product.name, product, error: null });
  } catch (e) { next(e); }
});

// Purchase (balance-based, instant delivery for 'code' products)
router.post('/product/:slug/buy', requireAuth, async (req, res, next) => {
  let tx;
  try {
    const product = await get('SELECT * FROM products WHERE slug = ? AND active = 1', [req.params.slug]);
    if (!product) return res.status(404).render('error', { title: 'ไม่พบสินค้า', message: 'ไม่พบสินค้าที่คุณต้องการ' });

    const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);

    if (user.balance < product.price) {
      const stockRow = await get("SELECT COUNT(*) c FROM stock_codes WHERE product_id=? AND status='available'", [product.id]);
      return res.status(400).render('product', {
        title: product.name,
        product: { ...product, stock_count: stockRow.c },
        error: 'ยอดเงินคงเหลือไม่พอ กรุณาเติมเงินก่อนทำรายการ',
      });
    }

    tx = await client.transaction('write');

    let deliveredCode = null;
    let deliveryStatus = 'pending';

    if (product.delivery_type === 'code') {
      const codeRes = await tx.execute({ sql: "SELECT * FROM stock_codes WHERE product_id = ? AND status = 'available' LIMIT 1", args: [product.id] });
      if (codeRes.rows.length === 0) {
        await tx.rollback();
        return res.status(400).render('product', {
          title: product.name,
          product: { ...product, stock_count: 0 },
          error: 'สินค้าหมดสต็อกชั่วคราว กรุณาลองใหม่ภายหลัง',
        });
      }
      deliveredCode = codeRes.rows[0].code;
      deliveryStatus = 'delivered';
    }

    await tx.execute({ sql: 'UPDATE users SET balance = balance - ? WHERE id = ?', args: [product.price, user.id] });
    const orderRes = await tx.execute({ sql: 'INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)', args: [user.id, product.price, 'completed'] });
    const orderId = Number(orderRes.lastInsertRowid);
    const itemRes = await tx.execute({
      sql: `INSERT INTO order_items (order_id, product_id, product_name, price, delivered_code, delivery_status) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [orderId, product.id, product.name, product.price, deliveredCode, deliveryStatus],
    });

    if (product.delivery_type === 'code') {
      await tx.execute({
        sql: "UPDATE stock_codes SET status='sold', order_item_id=? WHERE product_id=? AND status='available' AND code=?",
        args: [Number(itemRes.lastInsertRowid), product.id, deliveredCode],
      });
    }

    await tx.commit();
    res.redirect('/orders/' + orderId);
  } catch (e) {
    if (tx) { try { await tx.rollback(); } catch (_) { /* already closed */ } }
    next(e);
  }
});

router.get('/orders', requireAuth, async (req, res, next) => {
  try {
    const orders = await all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.render('orders', { title: 'ประวัติการสั่งซื้อ', orders });
  } catch (e) { next(e); }
});

router.get('/orders/:id', requireAuth, async (req, res, next) => {
  try {
    const order = await get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!order) return res.status(404).render('error', { title: 'ไม่พบคำสั่งซื้อ', message: 'ไม่พบคำสั่งซื้อนี้' });
    const items = await all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    res.render('order-detail', { title: 'คำสั่งซื้อ #' + order.id, order, items });
  } catch (e) { next(e); }
});

router.get('/wallet', requireAuth, (req, res) => {
  res.render('wallet', { title: 'กระเป๋าเงิน', error: null, success: null });
});

router.post('/wallet/redeem', requireAuth, async (req, res, next) => {
  let tx;
  try {
    const code = (req.body.code || '').trim().toUpperCase();
    if (!code) {
      return res.status(400).render('wallet', { title: 'กระเป๋าเงิน', error: 'กรุณากรอกโค้ดเติมเงิน', success: null });
    }

    tx = await client.transaction('write');
    const codeRes = await tx.execute({ sql: 'SELECT * FROM topup_codes WHERE code = ?', args: [code] });
    if (codeRes.rows.length === 0) {
      await tx.rollback();
      return res.status(400).render('wallet', { title: 'กระเป๋าเงิน', error: 'ไม่พบโค้ดนี้ในระบบ', success: null });
    }
    const row = codeRes.rows[0];
    if (row.used_by) {
      await tx.rollback();
      return res.status(400).render('wallet', { title: 'กระเป๋าเงิน', error: 'โค้ดนี้ถูกใช้งานไปแล้ว', success: null });
    }

    await tx.execute({ sql: "UPDATE topup_codes SET used_by = ?, used_at = datetime('now') WHERE id = ?", args: [req.user.id, row.id] });
    await tx.execute({ sql: 'UPDATE users SET balance = balance + ? WHERE id = ?', args: [row.amount, req.user.id] });
    await tx.commit();

    return res.render('wallet', { title: 'กระเป๋าเงิน', error: null, success: `เติมเงินสำเร็จ +${(row.amount / 100).toFixed(2)} บาท` });
  } catch (e) {
    if (tx) { try { await tx.rollback(); } catch (_) { /* already closed */ } }
    next(e);
  }
});

module.exports = router;
