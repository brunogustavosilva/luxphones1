import test from 'node:test';
import assert from 'node:assert/strict';

test('Vercel imports Express without listening or initializing the database', async () => {
  process.env.VERCEL = '1';
  process.env.DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:1/fixture';
  process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
  const { pool } = await import('./database.js');
  const queries = [];
  pool.query = async (sql) => {
    queries.push(sql);
    if (sql === 'SELECT 1') return { rows: [{ value: 1 }] };
    if (sql.includes('FROM products')) return { rows: [{ id: '1', name: 'Fixture', price: '10.00' }] };
    throw new Error('Unexpected database query');
  };
  const { default: app } = await import('./index.js');
  assert.equal(typeof app, 'function');
  assert.equal(queries.length, 0, 'Import must not migrate or seed database');
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(`${base}/api/health`);
    assert.deepEqual(await health.json(), { status: 'ok', database: 'connected' });
    const products = await fetch(`${base}/api/products`);
    assert.equal((await products.json())[0].name, 'Fixture');
    const me = await fetch(`${base}/api/auth/me`);
    assert.equal(me.status, 401);
    assert.match(me.headers.get('content-type'), /application\/json/);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(login.status, 400);
    assert.match((await login.json()).error, /usuário e senha/);
    const missing = await fetch(`${base}/api/not-found`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type'), /application\/json/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
