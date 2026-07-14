const jwt = require('jsonwebtoken');
const { get } = require('../db/helpers');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

async function attachUser(req, res, next) {
  const token = req.cookies && req.cookies.token;
  req.user = null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await get('SELECT id, username, email, role, balance FROM users WHERE id = ?', [payload.id]);
      if (user) req.user = user;
    } catch (e) {
      // invalid/expired token, or lookup failure -> treat as logged out
    }
  }
  res.locals.user = req.user;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).render('error', { title: 'ไม่มีสิทธิ์เข้าถึง', message: 'หน้านี้สำหรับผู้ดูแลระบบเท่านั้น' });
  next();
}

function signToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { attachUser, requireAuth, requireAdmin, signToken, JWT_SECRET };
