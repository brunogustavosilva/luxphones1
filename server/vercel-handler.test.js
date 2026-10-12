import test from 'node:test';
import assert from 'node:assert/strict';
import { createVercelHandler } from './vercel-handler.js';
const validEnv = { DATABASE_URL: 'postgresql://placeholder', JWT_SECRET: 'test-only-secret-with-at-least-32-characters' };
function response() { return { headers: {}, statusCode: 200, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } }; }

test('missing Vercel secrets produce a clear JSON response without importing the API', async () => {
  let imports = 0;
  const handler = createVercelHandler(async () => { imports++; }, {});
  const res = response();
  await handler({ url: '/api/products' }, res);
  assert.equal(imports, 0);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /DATABASE_URL e JWT_SECRET/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});
test('a short production JWT secret blocks the function', async () => {
  const res = response();
  await createVercelHandler(async () => { throw new Error('must not import'); }, { ...validEnv, JWT_SECRET: 'short' })({}, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /32 caracteres/);
});
test('concurrent invocations reuse one Express instance and preserve API request URLs', async () => {
  let imports = 0; const paths = [];
  const handler = createVercelHandler(async () => { imports++; return (req, res) => { paths.push(req.url); res.json({ ok: true }); }; }, validEnv);
  await Promise.all(['/api/products', '/api/auth/login', '/api/health'].map((url) => handler({ url }, response())));
  assert.equal(imports, 1);
  assert.deepEqual(paths, ['/api/products', '/api/auth/login', '/api/health']);
});
