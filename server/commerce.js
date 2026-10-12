import { randomUUID } from 'node:crypto';
import { normalizeCheckout, checkoutHash, priceCart, problem, uuidPattern, verifyWebhook, validatePayment } from './commerce-policy.js';
import { createMercadoPago, preferenceBody } from './mercado-pago.js';
import { retentionCutoff } from './retention.js';

export function registerCommerce(app, { pool, requireAdmin, asyncRoute, cleanupHistory, provider, siteUrl = process.env.SITE_URL || 'http://localhost:5173', webhookUrl = process.env.MP_WEBHOOK_URL || '', webhookSecret = process.env.MP_WEBHOOK_SECRET || '' }) {
  const mp = provider || createMercadoPago({ token: process.env.MP_ACCESS_TOKEN, testMode: process.env.MP_ENV !== 'production' });
  const site = new URL(siteUrl);
  if (!['http:', 'https:'].includes(site.protocol)) throw new Error('SITE_URL inválida.');
  if (webhookUrl && (new URL(webhookUrl).protocol !== 'https:' || !webhookSecret)) throw new Error('Webhook exige MP_WEBHOOK_URL HTTPS e MP_WEBHOOK_SECRET.');
  const requests = new Map();
  function rateLimit(req, res, next) {
    const key = `${req.ip}:${req.path === '/api/checkout' ? 'checkout' : 'sync'}`;
    const now = Date.now();
    for (const [id, bucket] of requests) if (bucket.until <= now) requests.delete(id);
    const bucket = requests.get(key) || { until: now + 60000, count: 0 };
    bucket.count++;
    if (requests.size > 5000 || bucket.count > (req.path === '/api/checkout' ? 10 : 60)) return res.status(429).json({ error: 'Muitas solicitações. Aguarde um minuto.' });
    requests.set(key, bucket);
    next();
  }
  const publicOrder = (order) => ({ id: order.id, total: order.total, status: order.status, payment_status: order.payment_status, stock_issue: order.stock_issue, test_mode: mp.testMode });
  async function byToken(token) {
    if (!uuidPattern.test(token)) throw problem('Pedido não encontrado.', 404);
    const { rows } = await pool.query(`SELECT id, total, status, payment_status, checkout_key, payment_id, payment_status, stock_issue, payment_checked_at FROM orders WHERE public_token = $1 AND created_at >= ${retentionCutoff}`, [token]);
    if (!rows[0]) throw problem('Pedido não encontrado ou expirado.', 404);
    return rows[0];
  }

  app.post('/api/checkout', rateLimit, asyncRoute(async (req, res) => {
    const input = normalizeCheckout(req.body);
    const hash = checkoutHash(input);
    await mp.merchant(); // Verify the seller/test environment before creating any preference.
    await cleanupHistory();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.checkout_key]);
      const { rows: existing } = await client.query(`SELECT id, total, items, customer_name, customer_email, customer_whatsapp, checkout_key, public_token, checkout_hash, checkout_url, created_at FROM orders WHERE checkout_key = $1 AND created_at >= ${retentionCutoff}`, [input.checkout_key]);
      let order = existing[0];
      if (order && order.checkout_hash !== hash) throw problem('O carrinho mudou. Atualize a tentativa de pagamento.', 409);
      if (order && Date.now() - new Date(order.created_at).getTime() >= 86400000) throw problem('Esta tentativa expirou. Reabra o carrinho para gerar outra.', 409);
      if (!order) {
        const { rows: products } = await client.query('SELECT id, name, sku, price, stock, active FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR SHARE', [input.items.map((item) => item.product_id)]);
        const cart = priceCart(input.items, products);
        const { rows } = await client.query(`INSERT INTO orders (customer_name, customer_whatsapp, customer_email, purchase_description, items, total, source, checkout_key, public_token, checkout_hash) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'mercado_pago',$7,$8,$9) RETURNING id, total, items, customer_name, customer_email, customer_whatsapp, checkout_key, public_token, checkout_hash, created_at`, [input.customer_name, input.customer_whatsapp, input.customer_email, cart.items.map((item) => `${item.quantity}× ${item.name}`).join(', '), JSON.stringify(cart.items), cart.total, input.checkout_key, randomUUID(), hash]);
        order = rows[0];
      }
      if (!order.checkout_url) {
        const preference = await mp.request('/checkout/preferences', { method: 'POST', body: preferenceBody(order, siteUrl, webhookUrl), key: input.checkout_key });
        // Test seller credentials are also APP_USR. Environment is verified above;
        // Checkout Pro uses init_point with test buyer accounts.
        const url = preference.init_point;
        if (!url || !/^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.br)?\//i.test(url)) throw problem('Mercado Pago não retornou um checkout válido.', 502);
        await client.query('UPDATE orders SET preference_id = $1, checkout_url = $2, updated_at = NOW() WHERE id = $3', [preference.id, url, order.id]);
        order.checkout_url = url;
      }
      await client.query('COMMIT');
      res.status(201).json({ checkout_url: order.checkout_url, order_token: order.public_token, test_mode: mp.testMode });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }));

  async function applyPayment(payment) {
    if (!payment || !uuidPattern.test(String(payment.external_reference || ''))) return;
    const merchantId = await mp.merchant();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT id, total, items, status, payment_status, checkout_key, payment_id, payment_updated_at, stock_applied, stock_issue FROM orders WHERE checkout_key = $1 AND source = 'mercado_pago' AND created_at >= ${retentionCutoff} FOR UPDATE`, [payment.external_reference]);
      const order = rows[0];
      if (!order) { await client.query('COMMIT'); return; }
      validatePayment(payment, order, { merchantId, testMode: mp.testMode });
      const updated = new Date(payment.date_last_updated || payment.date_created);
      if (!Number.isFinite(updated.getTime())) throw problem('Data do pagamento inválida.', 502);
      if (order.payment_id && String(order.payment_id) !== String(payment.id) && ['approved', 'refunded', 'charged_back'].includes(order.payment_status)) {
        if (payment.status === 'approved') await client.query('UPDATE orders SET payment_issue = TRUE WHERE id = $1', [order.id]);
        await client.query('COMMIT');
        return;
      }
      if (String(order.payment_id) === String(payment.id) && order.payment_updated_at && new Date(order.payment_updated_at) > updated) { await client.query('COMMIT'); return; }
      let applied = order.stock_applied;
      let issue = order.stock_issue;
      if (payment.status === 'approved' && !applied) {
        const { rows: products } = await client.query('SELECT id, stock FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [order.items.map((item) => item.product_id)]);
        const stock = new Map(products.map((product) => [String(product.id), product.stock]));
        issue = order.items.some((item) => !stock.has(item.product_id) || stock.get(item.product_id) < item.quantity);
        if (!issue) {
          for (const item of order.items) await client.query('UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2', [item.quantity, item.product_id]);
          applied = true;
        }
      } else if (['refunded', 'charged_back'].includes(payment.status) && applied) {
        // A financial reversal does not imply the physical goods were returned.
        // The team adjusts inventory after receiving the goods.
        issue = false;
      }
      const status = payment.status === 'approved' ? (['shipped', 'delivered'].includes(order.status) ? order.status : 'paid') : ['cancelled', 'refunded', 'charged_back'].includes(payment.status) ? 'cancelled' : (order.status === 'paid' ? 'pending' : order.status);
      await client.query('UPDATE orders SET payment_status = $1, payment_id = $2, payment_updated_at = $3, payment_checked_at = NOW(), status = $4, stock_applied = $5, stock_issue = $6, updated_at = NOW() WHERE id = $7', [payment.status, String(payment.id), updated, status, applied, issue, order.id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  const syncing = new Map();
  async function syncOrder(order) {
    if (syncing.has(order.id)) return syncing.get(order.id);
    if (order.payment_checked_at && Date.now() - new Date(order.payment_checked_at).getTime() < 15000) return;
    const task = (async () => {
      if (!order.checkout_key) return;
      const found = await mp.request(`/v1/payments/search?external_reference=${encodeURIComponent(order.checkout_key)}&sort=date_created&criteria=desc&limit=20`);
      const results = (found.results || []).filter((payment) => String(payment.external_reference) === order.checkout_key);
      const keepPayment = order.payment_id && ['approved', 'refunded', 'charged_back'].includes(order.payment_status);
      const selected = keepPayment ? { id: order.payment_id } : results.find((item) => item.status === 'approved') || results[0] || (order.payment_id ? { id: order.payment_id } : null);
      if (selected) await applyPayment(await mp.request(`/v1/payments/${encodeURIComponent(selected.id)}`));
      for (const extra of results.filter((payment) => payment.status === 'approved' && String(payment.id) !== String(selected?.id))) {
        await applyPayment(await mp.request(`/v1/payments/${encodeURIComponent(extra.id)}`));
      }
      await pool.query('UPDATE orders SET payment_checked_at = NOW() WHERE id = $1', [order.id]);
    })().finally(() => syncing.delete(order.id));
    syncing.set(order.id, task);
    return task;
  }
  app.get('/api/checkout/:token', rateLimit, asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'no-store').json(publicOrder(await byToken(req.params.token)));
  }));
  app.post('/api/checkout/:token/sync', rateLimit, asyncRoute(async (req, res) => {
    const order = await byToken(req.params.token);
    await syncOrder(order);
    res.set('Cache-Control', 'no-store').json(publicOrder(await byToken(req.params.token)));
  }));
  app.post('/api/orders/:id/sync-payment', requireAdmin, asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`SELECT id, checkout_key, payment_id, payment_status, payment_checked_at FROM orders WHERE id = $1 AND source = 'mercado_pago' AND created_at >= ${retentionCutoff}`, [req.params.id]);
    if (!rows[0]) throw problem('Pedido online não encontrado.', 404);
    await syncOrder(rows[0]);
    res.json({ ok: true });
  }));
  app.post('/api/payments/webhook', asyncRoute(async (req, res) => {
    if (!webhookSecret) throw problem('Webhook ainda não configurado.', 503);
    const dataId = req.query['data.id'];
    if (!verifyWebhook({ signature: req.get('x-signature'), requestId: req.get('x-request-id'), dataId, secret: webhookSecret })) throw problem('Assinatura inválida.', 401);
    if ((req.body?.type || req.query.type) !== 'payment') return res.sendStatus(200);
    if (!/^\d+$/.test(dataId) || (req.body?.data?.id && String(req.body.data.id) !== dataId)) throw problem('Notificação inválida.');
    // Signed notifications still never provide the trusted payment status.
    await applyPayment(await mp.request(`/v1/payments/${encodeURIComponent(dataId)}`));
    res.sendStatus(200);
  }));
  return { applyPayment, syncOrder };
}
