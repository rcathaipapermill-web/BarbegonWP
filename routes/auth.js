const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { get, run } = require('../db/helpers');
const { signToken } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่ภายหลัง',
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { title: 'สมัครสมาชิก', error: null, form: {} });
});

router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password, confirm } = req.body;
    const errors = [];

    if (!username || username.trim().length < 3) errors.push('ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร');
    if (!/^[a-zA-Z0-9_]+$/.test(username || '')) errors.push('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9 และ _');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('อีเมลไม่ถูกต้อง');
    if (!password || password.length < 8) errors.push('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
    if (password !== confirm) errors.push('รหัสผ่านยืนยันไม่ตรงกัน');

    if (errors.length) {
      return res.status(400).render('register', { title: 'สมัครสมาชิก', error: errors.join(' / '), form: { username, email } });
    }

    const existing = await get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existing) {
      return res.status(400).render('register', { title: 'สมัครสมาชิก', error: 'ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้งานแล้ว', form: { username, email } });
    }

    const hash = bcrypt.hashSync(password, 10);
    const info = await run('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, hash]);
    const user = await get('SELECT id, username, email, role, balance FROM users WHERE id = ?', [info.lastInsertRowid]);

    const token = signToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
    res.redirect('/');
  } catch (e) { next(e); }
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'เข้าสู่ระบบ', error: null, next: req.query.next || '/' });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const nextUrl = req.body.next || '/';
    const genericError = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

    const user = await get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      return res.status(400).render('login', { title: 'เข้าสู่ระบบ', error: genericError, next: nextUrl });
    }

    const token = signToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
    res.redirect(nextUrl.startsWith('/') ? nextUrl : '/');
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

module.exports = router;
