import { randomUUID } from 'node:crypto';
import { normalizeCheckout, checkoutHash, priceCart, problem, uuidPattern, verifyWebhook, validatePayment } from './commerce-policy.js';
import { ordersBody, ordersIdPattern, normalizeOrdersPayment } from './orders-policy.js';
import { createMercadoPago } from './mercado-pago.js';
import { createPagBank } from './pagbank.js';
import { checkoutBody, normalizePagBankOrder, pagBankCheckoutUrl, verifyPagBankWebhook } from './pagbank-policy.js';
import { retentionCutoff } from './retention.js';

export function registerCommerce(app, { pool, requireAdmin, asyncRoute, cleanupHistory, provider, legacyMp = createMercadoPago({ token: process.env.MP_ACCESS_TOKEN, testMode: process.env.MP_ENV !== 'production' }), siteUrl = process.env.SITE_URL || 'http://localhost:5173', webhookUrl = process.env.PAGBANK_WEBHOOK_URL || '', pagbankToken = process.env.PAGBANK_ACCESS_TOKEN, legacyWebhookSecret = process.env.MP_WEBHOOK_SECRET || '' }) {
  const pagbank = provider || createPagBank({ token: process.env.PAGBANK_ACCESS_TOKEN, testMode: process.env.PAGBANK_ENV !== 'production' });
  const site = new URL(siteUrl);
  if (!['http:', 'https:'].includes(site.protocol)) throw new Error('SITE_URL inválida.');
  if (webhookUrl && new URL(webhookUrl).protocol !== 'https:') throw new Error('PAGBANK_WEBHOOK_URL precisa usar HTTPS.');
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
  const publicOrder = (order) => ({ id: order.id, total: order.total, status: order.status, payment_status: order.payment_status, stock_issue: order.stock_issue, test_mode: order.source === 'mercado_pago' ? legacyMp.testMode : pagbank.testMode, provider: order.source, provider_reference: order.source === 'mercado_pago' ? order.mp_order_id || null : order.pagbank_checkout_id || null, mp_order_id: order.mp_order_id || null });
  async function byToken(token) {
    if (!uuidPattern.test(token)) throw problem('Pedido não encontrado.', 404);
    const { rows } = await pool.query(`SELECT id, total, status, payment_status, checkout_key, payment_id, mp_order_id, pagbank_checkout_id, source, stock_issue, payment_checked_at FROM orders WHERE public_token = $1 AND created_at >= ${retentionCutoff}`, [token]);
    if (!rows[0]) throw problem('Pedido não encontrado ou expirado.', 404);
    return rows[0];
  }

  app.post('/api/checkout', rateLimit, asyncRoute(async (req, res) => {
    if (process.env.VERCEL && (site.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname))) {
      throw problem('Configure SITE_URL na Vercel com o endereço público HTTPS da loja e faça um novo deploy.', 503);
    }
    const input = normalizeCheckout(req.body);
    const hash = checkoutHash(input);
    await cleanupHistory();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.checkout_key]);
      const { rows: existing } = await client.query(`SELECT id, total, items, customer_name, customer_email, customer_whatsapp, checkout_key, public_token, checkout_hash, checkout_url, mp_order_id, pagbank_checkout_id, source, created_at FROM orders WHERE checkout_key = $1 AND created_at >= ${retentionCutoff}`, [input.checkout_key]);
      let order = existing[0];
      if (order && order.checkout_hash !== hash) throw problem('O carrinho mudou. Atualize a tentativa de pagamento.', 409);
      if (order && Date.now() - new Date(order.created_at).getTime() >= 86400000) throw problem('Esta tentativa expirou. Reabra o carrinho para gerar outra.', 409);
      if (!order) {
        const { rows: products } = await client.query('SELECT id, name, description, sku, price, stock, active FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR SHARE', [input.items.map((item) => item.product_id)]);
        const cart = priceCart(input.items, products);
        const { rows } = await client.query(`INSERT INTO orders (customer_name, customer_whatsapp, customer_email, purchase_description, items, total, source, checkout_key, public_token, checkout_hash, customer_address, customer_complement, customer_zipcode) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'pagbank',$7,$8,$9,$10,$11,$12) RETURNING id, total, items, customer_name, customer_email, customer_whatsapp, checkout_key, public_token, checkout_hash, created_at`, [input.customer_name, input.customer_whatsapp, input.customer_email, cart.items.map((item) => `${item.quantity}× ${item.name}`).join(', '), JSON.stringify(cart.items), cart.total, input.checkout_key, randomUUID(), hash, input.customer_address, input.customer_complement, input.customer_zipcode]);
        order = rows[0];
        order.source = 'pagbank';
      }
      if (!order.checkout_url && order.source === 'pagbank') {
        const resource = await pagbank.request('/checkouts', { method: 'POST', body: checkoutBody(order, siteUrl, webhookUrl) });
        const url = pagBankCheckoutUrl(resource, order.checkout_key);
        await client.query('UPDATE orders SET pagbank_checkout_id = $1, checkout_url = $2, updated_at = NOW() WHERE id = $3', [resource.id, url, order.id]);
        order.pagbank_checkout_id = resource.id;
        order.checkout_url = url;
      }
      await client.query('COMMIT');
      res.status(201).json({ checkout_url: order.checkout_url, order_token: order.public_token, provider_reference: order.source === 'mercado_pago' ? order.mp_order_id || null : order.pagbank_checkout_id || null, test_mode: order.source === 'mercado_pago' ? legacyMp.testMode : pagbank.testMode });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }));

  async function applyPagBankPayment(resource) {
    if (!resource?.reference_id) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT id, total, items, status, payment_status, checkout_key, payment_id, payment_updated_at, stock_applied, stock_issue, pagbank_checkout_id FROM orders WHERE checkout_key = $1 AND source = 'pagbank' AND created_at >= ${retentionCutoff} FOR UPDATE`, [resource.reference_id]);
      const order = rows[0];
      if (!order) { await client.query('COMMIT'); return; }
      const normalized = normalizePagBankOrder(resource, order);
      if (order.payment_id && String(order.payment_id) !== String(normalized.paymentId) && ['approved', 'refunded', 'charged_back'].includes(order.payment_status)) {
        if (normalized.status === 'approved') await client.query('UPDATE orders SET payment_issue = TRUE WHERE id = $1', [order.id]);
        await client.query('COMMIT');
        return;
      }
      const updated = new Date(normalized.updatedAt);
      if (String(order.payment_id) === String(normalized.paymentId) && order.payment_updated_at && new Date(order.payment_updated_at) > updated) { await client.query('COMMIT'); return; }
      let applied = order.stock_applied;
      let issue = order.stock_issue;
      if (['approved', 'partially_refunded'].includes(normalized.status) && !applied) {
        const { rows: products } = await client.query('SELECT id, stock FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [order.items.map((item) => item.product_id)]);
        const stock = new Map(products.map((product) => [String(product.id), product.stock]));
        issue = order.items.some((item) => !stock.has(item.product_id) || stock.get(item.product_id) < item.quantity);
        if (!issue) {
          for (const item of order.items) await client.query('UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2', [item.quantity, item.product_id]);
          applied = true;
        }
      } else if (['refunded', 'charged_back'].includes(normalized.status) && applied) issue = false;
      const status = ['approved', 'partially_refunded'].includes(normalized.status) ? (['shipped', 'delivered'].includes(order.status) ? order.status : 'paid') : ['cancelled', 'refunded', 'charged_back'].includes(normalized.status) ? 'cancelled' : (order.status === 'paid' ? 'pending' : order.status);
      await client.query('UPDATE orders SET payment_status = $1, payment_id = $2, payment_updated_at = $3, payment_checked_at = NOW(), status = $4, stock_applied = $5, stock_issue = $6, payment_refunded_amount = $8, payment_issue = payment_issue OR $9, updated_at = NOW() WHERE id = $7', [normalized.status, normalized.paymentId, updated, status, applied, issue, order.id, normalized.refundedAmount, normalized.status === 'partially_refunded' || normalized.duplicateApproved]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async function applyPayment(payment, ordersResource = false) {
    if (!payment || !uuidPattern.test(String(payment.external_reference || ''))) return;
    const merchantId = await legacyMp.merchant();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT id, total, items, status, payment_status, checkout_key, payment_id, payment_updated_at, stock_applied, stock_issue, mp_order_id FROM orders WHERE checkout_key = $1 AND source = 'mercado_pago' AND created_at >= ${retentionCutoff} FOR UPDATE`, [payment.external_reference]);
      const order = rows[0];
      if (!order) { await client.query('COMMIT'); return; }
      let statusValue = payment.status;
      let paymentId = String(payment.id);
      let updated;
      let refundedAmount = 0;
      if (ordersResource) {
        const normalized = normalizeOrdersPayment(payment, order, merchantId);
        statusValue = normalized.status;
        paymentId = normalized.paymentId;
        updated = new Date(normalized.updatedAt);
        refundedAmount = normalized.refundedAmount;
      } else {
        if (order.mp_order_id) throw problem('Este pedido deve ser consultado pela Orders API.', 409);
        validatePayment(payment, order, { merchantId, testMode: legacyMp.testMode, verifiedTestSeller: legacyMp.testMode });
        updated = new Date(payment.date_last_updated || payment.date_created);
        if (payment.status === 'refunded') refundedAmount = Number(order.total);
        if (order.payment_id && String(order.payment_id) !== String(payment.id) && ['approved', 'refunded', 'charged_back'].includes(order.payment_status)) {
          if (payment.status === 'approved') await client.query('UPDATE orders SET payment_issue = TRUE WHERE id = $1', [order.id]);
          await client.query('COMMIT');
          return;
        }
      }
      if (!Number.isFinite(updated.getTime())) throw problem('Data do pagamento inválida.', 502);
      if ((ordersResource || String(order.payment_id) === String(payment.id)) && order.payment_updated_at && new Date(order.payment_updated_at) > updated) { await client.query('COMMIT'); return; }
      let applied = order.stock_applied;
      let issue = order.stock_issue;
      if (['approved', 'partially_refunded'].includes(statusValue) && !applied) {
        const { rows: products } = await client.query('SELECT id, stock FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [order.items.map((item) => item.product_id)]);
        const stock = new Map(products.map((product) => [String(product.id), product.stock]));
        issue = order.items.some((item) => !stock.has(item.product_id) || stock.get(item.product_id) < item.quantity);
        if (!issue) {
          for (const item of order.items) await client.query('UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2', [item.quantity, item.product_id]);
          applied = true;
        }
      } else if (['refunded', 'charged_back'].includes(statusValue) && applied) {
        // A financial reversal does not imply the physical goods were returned.
        // The team adjusts inventory after receiving the goods.
        issue = false;
      }
      const status = ['approved', 'partially_refunded'].includes(statusValue) ? (['shipped', 'delivered'].includes(order.status) ? order.status : 'paid') : ['cancelled', 'refunded', 'charged_back'].includes(statusValue) ? 'cancelled' : (order.status === 'paid' ? 'pending' : order.status);
      await client.query('UPDATE orders SET payment_status = $1, payment_id = $2, payment_updated_at = $3, payment_checked_at = NOW(), status = $4, stock_applied = $5, stock_issue = $6, payment_refunded_amount = $8, payment_issue = payment_issue OR $9, updated_at = NOW() WHERE id = $7', [statusValue, paymentId, updated, status, applied, issue, order.id, refundedAmount, statusValue === 'partially_refunded']);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  const syncing = new Map();
  async function syncOrder(order, force = false) {
    if (syncing.has(order.id)) return syncing.get(order.id);
    if (!force && order.payment_checked_at && Date.now() - new Date(order.payment_checked_at).getTime() < 15000) return;
    const task = (async () => {
      if (!order.checkout_key) return;
      if (order.source === 'pagbank') {
        const checkout = await pagbank.request(`/checkouts/${encodeURIComponent(order.pagbank_checkout_id)}?limit=100`);
        if (checkout.id !== order.pagbank_checkout_id || checkout.reference_id !== order.checkout_key) throw problem('Checkout PagBank não corresponde ao pedido.', 409);
        let resources = checkout.orders || checkout.payments || [];
        if (checkout.charges?.length) resources = [checkout];
        for (const item of resources) {
          const resource = item.charges ? item : /^ORDE_[A-Z0-9-]+$/i.test(item.id || '') ? await pagbank.request(`/orders/${encodeURIComponent(item.id)}`) : null;
          if (resource) await applyPagBankPayment(resource);
        }
        await pool.query('UPDATE orders SET payment_checked_at = NOW() WHERE id = $1', [order.id]);
        return;
      }
      if (order.mp_order_id) {
        await applyPayment(await legacyMp.request(`/v1/orders/${encodeURIComponent(order.mp_order_id)}`), true);
        await pool.query('UPDATE orders SET payment_checked_at = NOW() WHERE id = $1', [order.id]);
        return;
      }
      const found = await legacyMp.request(`/v1/payments/search?external_reference=${encodeURIComponent(order.checkout_key)}&sort=date_created&criteria=desc&limit=20`);
      const results = (found.results || []).filter((payment) => String(payment.external_reference) === order.checkout_key);
      const keepPayment = order.payment_id && ['approved', 'refunded', 'charged_back'].includes(order.payment_status);
      const selected = keepPayment ? { id: order.payment_id } : results.find((item) => item.status === 'approved') || results[0] || (order.payment_id ? { id: order.payment_id } : null);
      if (selected) await applyPayment(await legacyMp.request(`/v1/payments/${encodeURIComponent(selected.id)}`));
      for (const extra of results.filter((payment) => payment.status === 'approved' && String(payment.id) !== String(selected?.id))) {
        await applyPayment(await legacyMp.request(`/v1/payments/${encodeURIComponent(extra.id)}`));
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
    const { rows } = await pool.query(`SELECT id, checkout_key, payment_id, mp_order_id, pagbank_checkout_id, source, payment_status, payment_checked_at FROM orders WHERE id = $1 AND source IN ('mercado_pago', 'pagbank') AND created_at >= ${retentionCutoff}`, [req.params.id]);
    if (!rows[0]) throw problem('Pedido online não encontrado.', 404);
    await syncOrder(rows[0]);
    res.json({ ok: true });
  }));
  app.post('/api/payments/webhook', asyncRoute(async (req, res) => {
    if (req.get('x-authenticity-token')) {
      if (!pagbankToken) throw problem('Webhook PagBank ainda não configurado.', 503);
      if (!verifyPagBankWebhook({ signature: req.get('x-authenticity-token'), rawBody: req.rawBody, token: pagbankToken })) throw problem('Assinatura inválida.', 401);
      const id = req.body?.id;
      if (/^ORDE_[A-Z0-9-]+$/i.test(id || '')) {
        await applyPagBankPayment(await pagbank.request(`/orders/${encodeURIComponent(id)}`));
      } else if (/^CHEC_[A-Z0-9-]+$/i.test(id || '')) {
        const checkout = await pagbank.request(`/checkouts/${encodeURIComponent(id)}?limit=100`);
        if (checkout.id === id && checkout.reference_id) {
          const { rows } = await pool.query(`SELECT id, checkout_key, pagbank_checkout_id, source, payment_status, payment_checked_at FROM orders WHERE checkout_key = $1 AND source = 'pagbank' AND created_at >= ${retentionCutoff}`, [checkout.reference_id]);
          if (rows[0]) await syncOrder(rows[0], true);
        }
      }
    } else {
      const dataId = req.query['data.id'];
      if (!verifyWebhook({ signature: req.get('x-signature'), requestId: req.get('x-request-id'), dataId, secret: legacyWebhookSecret })) throw problem('Assinatura inválida.', 401);
      const topic = req.body?.type || req.query.type;
      if (!['payment', 'order', 'orders_v2'].includes(topic)) return res.sendStatus(200);
      const isOrder = topic !== 'payment';
      if (!(isOrder ? ordersIdPattern.test(dataId) : /^\d+$/.test(dataId)) || (req.body?.data?.id && String(req.body.data.id) !== dataId)) throw problem('Notificação inválida.');
      await applyPayment(await legacyMp.request(isOrder ? `/v1/orders/${encodeURIComponent(dataId)}` : `/v1/payments/${encodeURIComponent(dataId)}`), isOrder);
    }
    res.sendStatus(200);
  }));
  return { applyPayment, applyPagBankPayment, syncOrder };
}
