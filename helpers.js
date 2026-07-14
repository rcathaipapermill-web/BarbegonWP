const { client } = require('./db');

async function all(sql, args = []) {
  const r = await client.execute({ sql, args });
  return r.rows;
}

async function get(sql, args = []) {
  const r = await client.execute({ sql, args });
  return r.rows[0] || null;
}

async function run(sql, args = []) {
  const r = await client.execute({ sql, args });
  return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.rowsAffected) };
}

module.exports = { all, get, run, client };
