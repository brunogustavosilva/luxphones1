import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { initializeDatabase, pool } from './database.js';
import { registerCommerce } from './commerce.js';
import { productTypes, whatsapp, problem } from './commerce-policy.js';
import { createRetentionCleanup, retentionCutoff } from './retention.js';
import { LOCKOUT_SECONDS, nextFailureState } from './auth-policy.js';

const app = express();
const cleanupHistory = createRetentionCleanup(pool);
const port = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
const jwtSecret = process.env.JWT_SECRET || (isProduction ? '' : 'local-development-only-change-this-secret');
const cookieName = 'luxphones_session';
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const validStatuses = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
const validRepairStatuses = ['pending', 'repaired'];
const statusLabel = { pending: 'Pendente', paid: 'Pago', shipped: 'Enviado', delivered: 'Entregue', cancelled: 'Cancelado' };
const dummyPasswordHash = bcrypt.hashSync('unknown-user-password', 12);

if (isProduction && jwtSecret.length < 32) throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres em produção.');
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '32kb', verify: (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); } }));
app.use(cookieParser());

function requireAdmin(req, res, next) {
  const token = req.cookies[cookieName];
  if (!token) return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
  try { req.admin = jwt.verify(token, jwtSecret); return next(); }
  catch { return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' }); }
}

function remoteIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password || username.length > 120 || password.length > 200) {
    return res.status(400).json({ error: 'Informe usuário e senha.' });
  }

  const ip = remoteIp(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO login_attempts (username, remote_ip) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [username, ip],
    );
    const { rows } = await client.query(
      'SELECT failed_attempts, locked_until FROM login_attempts WHERE username = $1 AND remote_ip = $2 FOR UPDATE',
      [username, ip],
    );
    const attempt = rows[0];
    const remaining = attempt.locked_until ? Math.ceil((new Date(attempt.locked_until).getTime() - Date.now()) / 1000) : 0;
    if (remaining > 0) {
      await client.query('COMMIT');
      res.set('Retry-After', String(remaining));
      return res.status(429).json({ error: `Muitas tentativas. Tente novamente em ${remaining} segundos.`, retryAfter: remaining });
    }

    const justUnlocked = Boolean(attempt.locked_until);
    if (justUnlocked) {
      await client.query(
        'UPDATE login_attempts SET failed_attempts = 0, locked_until = NULL WHERE username = $1 AND remote_ip = $2',
        [username, ip],
      );
    }
    const { rows: admins } = await client.query('SELECT id, username, password_hash FROM admin_users WHERE username = $1', [username]);
    const admin = admins[0];
    const passwordHash = admin?.password_hash || dummyPasswordHash;
    const validPassword = await bcrypt.compare(password, passwordHash);

    if (!admin || !validPassword) {
      const failure = nextFailureState(justUnlocked ? 0 : attempt.failed_attempts);
      await client.query(
        `UPDATE login_attempts
         SET failed_attempts = $3,
             locked_until = CASE WHEN $3 >= 5 THEN NOW() + INTERVAL '60 seconds' ELSE NULL END,
             updated_at = NOW()
         WHERE username = $1 AND remote_ip = $2`,
        [username, ip, failure.failedAttempts],
      );
      await client.query('COMMIT');
      if (failure.locked) res.set('Retry-After', String(LOCKOUT_SECONDS));
      return res.status(failure.locked ? 429 : 401).json({
        error: failure.locked ? `Muitas tentativas. Acesso bloqueado por ${LOCKOUT_SECONDS} segundos.` : 'Usuário ou senha incorretos.',
        ...(failure.locked ? { retryAfter: LOCKOUT_SECONDS } : {}),
      });
    }

    await client.query(
      'UPDATE login_attempts SET failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE username = $1 AND remote_ip = $2',
      [username, ip],
    );
    await client.query('COMMIT');
    const token = jwt.sign({ sub: String(admin.id), username: admin.username }, jwtSecret, { expiresIn: '8h' });
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });
    return res.json({ username: admin.username });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/auth/me', requireAdmin, (req, res) => res.json({ username: req.admin.username }));
app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(cookieName, { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/' });
  res.status(204).end();
});

app.get('/api/products', asyncRoute(async (req, res) => {
  const includeAll = req.query.all === 'true';
  if (includeAll) {
    try { jwt.verify(req.cookies[cookieName] || '', jwtSecret); }
    catch { return res.status(401).json({ error: 'Acesso não autorizado.' }); }
  }
  const { rows } = await pool.query(
    `SELECT id, name, description, sku, category, price, stock, image_url, product_type, created_at, updated_at
     FROM products WHERE active = TRUE ORDER BY created_at DESC`,
  );
  res.json(rows);
}));

app.post('/api/products', requireAdmin, asyncRoute(async (req, res) => {
  const { name, description, sku, category, price, stock = 0, image_url = '', product_type = 'smartphones' } = req.body || {};
  if (!productTypes.includes(product_type) || !name?.trim() || typeof description !== 'string' || !description.trim() || description.length > 3000 || !sku?.trim() || !category?.trim() || !Number.isFinite(Number(price)) || Number(price) < 0 || !Number.isInteger(Number(stock)) || Number(stock) < 0) {
    return res.status(400).json({ error: 'Revise os campos do produto.' });
  }
  const { rows } = await pool.query(
    'INSERT INTO products (name, description, sku, category, price, stock, image_url, product_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
    [name.trim(), description.trim(), sku.trim(), category.trim(), price, stock, String(image_url), product_type],
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/products/:id', requireAdmin, asyncRoute(async (req, res) => {
  const { name, description, sku, category, price, stock = 0, image_url = '', product_type = 'smartphones' } = req.body || {};
  if (!productTypes.includes(product_type) || !name?.trim() || typeof description !== 'string' || !description.trim() || description.length > 3000 || !sku?.trim() || !category?.trim() || !Number.isFinite(Number(price)) || Number(price) < 0 || !Number.isInteger(Number(stock)) || Number(stock) < 0) {
    return res.status(400).json({ error: 'Revise os campos do produto.' });
  }
  const { rows } = await pool.query(
    `UPDATE products SET name = $1, description = $2, sku = $3, category = $4, price = $5, stock = $6,
     image_url = $7, product_type = $8, updated_at = NOW() WHERE id = $9 AND active = TRUE RETURNING id`,
    [name.trim(), description.trim(), sku.trim(), category.trim(), price, stock, String(image_url), product_type, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Produto não encontrado.' });
  res.json(rows[0]);
}));

app.delete('/api/products/:id', requireAdmin, asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query(
    'UPDATE products SET active = FALSE, updated_at = NOW() WHERE id = $1 AND active = TRUE',
    [req.params.id],
  );
  if (!rowCount) return res.status(404).json({ error: 'Produto não encontrado.' });
  res.status(204).end();
}));

// Retention runs only on authenticated dashboard traffic, at most once per hour.
app.use(['/api/orders', '/api/repairs', '/api/dashboard'], requireAdmin, asyncRoute(async (_req, _res, next) => {
  await cleanupHistory();
  next();
}));

app.get('/api/orders', requireAdmin, asyncRoute(async (req, res) => {
  const limit = req.query.recent === 'true' ? 5 : 100;
  const { rows } = await pool.query(`SELECT id, customer_name, customer_whatsapp, purchase_description, total, status, payment_status, source, mp_order_id, pagbank_checkout_id, stock_issue, payment_issue, created_at FROM orders WHERE created_at >= ${retentionCutoff} ORDER BY created_at DESC, id DESC LIMIT $1`, [limit]);
  res.json(rows);
}));

app.get('/api/orders/:id', requireAdmin, asyncRoute(async (req, res) => {
  if (!/^\d{1,18}$/.test(req.params.id)) throw problem('Pedido inválido.');
  const { rows } = await pool.query(`SELECT id, customer_name, customer_whatsapp, customer_email, customer_address, customer_complement, customer_zipcode, purchase_description, items, source, total, payment_status, status, mp_order_id, pagbank_checkout_id, payment_refunded_amount, created_at FROM orders WHERE id = $1 AND created_at >= ${retentionCutoff}`, [req.params.id]);
  if (!rows.length) throw problem('Pedido não encontrado.', 404);
  res.json(rows[0]);
}));

registerCommerce(app, { pool, requireAdmin, asyncRoute, cleanupHistory });

app.post('/api/orders', requireAdmin, asyncRoute(async (req, res) => {
  const { customer_name, customer_whatsapp, purchase_description, product_id, total, status = 'pending', payment_status = 'pending' } = req.body || {};
  if (typeof customer_name !== 'string' || !customer_name.trim() || customer_name.length > 120 || typeof purchase_description !== 'string' || !purchase_description.trim() || purchase_description.length > 1000 || !Number.isFinite(Number(total)) || Number(total) <= 0 || !validStatuses.includes(status) || !['pending', 'approved'].includes(payment_status)) throw problem('Revise os dados do pedido.');
  if (['paid', 'shipped', 'delivered'].includes(status) && payment_status !== 'approved') throw problem('Confirme o pagamento antes de marcar o pedido como pago ou enviado.');
  let items = [];
  if (product_id) {
    if (!/^\d{1,18}$/.test(String(product_id))) throw problem('Produto inválido.');
    const { rows: products } = await pool.query('SELECT id, name, description, sku, price FROM products WHERE id = $1 AND active = TRUE', [product_id]);
    if (!products[0]) throw problem('Produto não encontrado.');
    const product = products[0];
    items = [{ product_id: String(product.id), name: product.name, description: product.description || '', sku: product.sku, quantity: 1, unit_price: Number(product.price) }];
  }
  const { rows } = await pool.query(
    'INSERT INTO orders (customer_name, customer_whatsapp, purchase_description, items, total, status, payment_status) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING id',
    [customer_name.trim(), whatsapp(customer_whatsapp), purchase_description.trim(), JSON.stringify(items), total, payment_status === 'approved' && status === 'pending' ? 'paid' : status, payment_status],
  );
  res.status(201).json(rows[0]);
}));

app.patch('/api/orders/:id', requireAdmin, asyncRoute(async (req, res) => {
  const status = req.body?.status;
  const paymentStatus = req.body?.payment_status;
  if (status !== undefined && !validStatuses.includes(status)) throw problem('Status inválido.');
  if (paymentStatus !== undefined && !['pending', 'approved', 'cancelled'].includes(paymentStatus)) throw problem('Pagamento inválido.');
  if (status === undefined && paymentStatus === undefined) throw problem('Informe o estado do pedido.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT id, source, status, payment_status, stock_issue, payment_issue FROM orders WHERE id = $1 AND created_at >= ${retentionCutoff} FOR UPDATE`, [req.params.id]);
    const order = rows[0];
    if (!order) throw problem('Pedido não encontrado.', 404);
    if (['mercado_pago', 'pagbank'].includes(order.source) && (paymentStatus !== undefined || ['paid', 'cancelled'].includes(status))) throw problem('O pagamento online é atualizado pelo provedor de pagamento.');
    const nextPayment = paymentStatus ?? order.payment_status;
    let nextStatus = status ?? order.status;
    if (['paid', 'shipped', 'delivered'].includes(nextStatus) && nextPayment !== 'approved') {
      if (status === undefined) nextStatus = 'pending';
      else throw problem('O pagamento ainda não foi aprovado.');
    }
    if (['shipped', 'delivered'].includes(nextStatus) && (order.stock_issue || order.payment_issue)) throw problem('Este pedido precisa de conferência de estoque ou pagamento antes do envio.');
    if (paymentStatus === 'approved' && nextStatus === 'pending') nextStatus = 'paid';
    await client.query('UPDATE orders SET status = $1, payment_status = $2, updated_at = NOW() WHERE id = $3', [nextStatus, nextPayment, order.id]);
    await client.query('COMMIT');
    res.json({ id: order.id });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

app.get('/api/repairs', requireAdmin, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, repair_name, customer_name, customer_whatsapp, value, status, created_at, updated_at FROM repairs WHERE created_at >= ${retentionCutoff} ORDER BY created_at DESC, id DESC LIMIT 200`,
  );
  res.json(rows);
}));

app.post('/api/repairs', requireAdmin, asyncRoute(async (req, res) => {
  const { repair_name, customer_name, customer_whatsapp, value } = req.body || {};
  const whatsappDigits = String(customer_whatsapp || '').replace(/\D/g, '');
  if (!repair_name?.trim() || !customer_name?.trim() || whatsappDigits.length < 10 || whatsappDigits.length > 15 || !Number.isFinite(Number(value)) || Number(value) < 0) {
    return res.status(400).json({ error: 'Preencha o reparo, cliente, WhatsApp válido e valor.' });
  }
  const { rows } = await pool.query(
    'INSERT INTO repairs (repair_name, customer_name, customer_whatsapp, value) VALUES ($1, $2, $3, $4) RETURNING *',
    [repair_name.trim(), customer_name.trim(), whatsappDigits, value],
  );
  res.status(201).json(rows[0]);
}));

app.patch('/api/repairs/:id', requireAdmin, asyncRoute(async (req, res) => {
  if (!validRepairStatuses.includes(req.body?.status)) return res.status(400).json({ error: 'Estado de reparo inválido.' });
  const { rows } = await pool.query(
    `UPDATE repairs SET status = $1, updated_at = NOW() WHERE id = $2 AND created_at >= ${retentionCutoff} RETURNING *`,
    [req.body.status, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Reparo não encontrado.' });
  res.json(rows[0]);
}));

app.get('/api/dashboard/summary', requireAdmin, asyncRoute(async (_req, res) => {
  const [{ rows: totals }, { rows: repairTotals }, { rows: weekly }, { rows: weeklyRepairs }] = await Promise.all([
    pool.query(`SELECT
      COALESCE(SUM(total - payment_refunded_amount) FILTER (WHERE created_at >= date_trunc('month', NOW()) AND payment_status IN ('approved', 'partially_refunded')), 0)::numeric AS monthly_revenue,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))::int AS orders_this_month,
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS orders_today,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_orders,
      (SELECT COUNT(*)::int FROM products WHERE active = TRUE) AS products_count
      FROM orders WHERE created_at >= ${retentionCutoff}`),
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_repairs,
      COALESCE(SUM(value) FILTER (WHERE status = 'repaired' AND created_at >= date_trunc('month', NOW())), 0)::numeric AS monthly_repair_revenue
      FROM repairs WHERE created_at >= ${retentionCutoff}`),
    pool.query(`SELECT days.day::date AS day, TO_CHAR(days.day, 'Dy') AS label,
      COALESCE(SUM(orders.total - orders.payment_refunded_amount) FILTER (WHERE orders.payment_status IN ('approved', 'partially_refunded')), 0)::numeric AS revenue
      FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)
      LEFT JOIN orders ON orders.created_at >= days.day AND orders.created_at < days.day + INTERVAL '1 day'
      GROUP BY days.day ORDER BY days.day`),
    pool.query(`SELECT created_at::date AS day, COALESCE(SUM(value), 0)::numeric AS revenue
      FROM repairs WHERE status = 'repaired' AND created_at >= CURRENT_DATE - INTERVAL '6 days'
      GROUP BY created_at::date`),
  ]);
  const repairRevenueByDay = new Map(weeklyRepairs.map((row) => [new Date(row.day).toISOString().slice(0, 10), Number(row.revenue)]));
  const combinedWeekly = weekly.map((day) => {
    const dateKey = new Date(day.day).toISOString().slice(0, 10);
    return { ...day, revenue: Number(day.revenue) + (repairRevenueByDay.get(dateKey) || 0) };
  });
  const monthlyRepairRevenue = Number(repairTotals[0].monthly_repair_revenue);
  res.json({
    monthlyRevenue: Number(totals[0].monthly_revenue) + monthlyRepairRevenue,
    monthlyRepairRevenue,
    pendingRepairs: repairTotals[0].pending_repairs,
    ordersThisMonth: totals[0].orders_this_month,
    ordersToday: totals[0].orders_today,
    pendingOrders: totals[0].pending_orders,
    productsCount: totals[0].products_count,
    weeklySales: combinedWeekly.map((day) => ({
      ...day,
      label: new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(day.day)),
    })),
    weeklyTotal: combinedWeekly.reduce((total, day) => total + Number(day.revenue), 0),
  });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint não encontrado.' }));
app.use((error, _req, res, _next) => {
  if (error.code === '23505') return res.status(409).json({ error: 'Este SKU já está cadastrado.' });
  if (error.status) return res.status(error.status).json({ error: error.message });
  console.error('Erro na API:', error.code || error.name);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(currentDir, '../dist');
const standalone = !process.env.VERCEL && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isProduction && standalone) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// Local development/Docker run a listening server. Vercel imports the app only;
// migrations and seed data are not repeated on every serverless cold start.
if (standalone) {
  initializeDatabase()
    .then(() => app.listen(port, '0.0.0.0', () => console.log(`Lux Baterias disponível na porta ${port}`)))
    .catch((error) => {
      console.error('Não foi possível iniciar com o PostgreSQL:', error.code || error.name);
      process.exit(1);
    });
}

export default app;
