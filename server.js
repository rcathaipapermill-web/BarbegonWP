require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./db/db'); // initializes schema + seed data

const { attachUser } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(attachUser);

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/shop'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'ไม่พบหน้านี้', message: 'ไม่พบหน้าที่คุณต้องการ' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: 'มีบางอย่างผิดพลาด กรุณาลองใหม่อีกครั้ง' });
});

db.ready.then(() => {
  app.listen(PORT, () => {
    console.log(`Shop running at http://localhost:${PORT}`);
  });
});
