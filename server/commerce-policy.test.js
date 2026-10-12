import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { normalizeCheckout, priceCart, checkoutHash, verifyWebhook, validatePayment } from './commerce-policy.js';
import { createMercadoPago, preferenceBody } from './mercado-pago.js';
const input = () => ({ customer_name: 'Cliente Teste', customer_email: 'cliente@example.com', customer_address: 'Rua Teste, 10, Centro, Curitiba PR', customer_zipcode: '80000-000', customer_whatsapp: '(41) 99999-9999', checkout_key: randomUUID(), items: [{ product_id: '1', quantity: 2 }] });

test('checkout normalizes contact and rejects malformed or excessive quantities', () => {
  const body = input();
  assert.equal(normalizeCheckout(body).customer_whatsapp, '5541999999999');
  for (const quantity of [0, -1, 1.5, 21, '2', null]) assert.throws(() => normalizeCheckout({ ...body, items: [{ product_id: '1', quantity }] }));
  assert.throws(() => normalizeCheckout({ ...body, items: [{ product_id: '1', quantity: 20 }, { product_id: '1', quantity: 1 }] }));
  assert.throws(() => normalizeCheckout({ ...body, customer_whatsapp: '123' }));
  assert.throws(() => normalizeCheckout({ ...body, items: [] }));
});
test('server prices override client data, sum in cents, and enforce available stock', () => {
  const requested = [{ product_id: '1', quantity: 3, unit_price: 0.01 }];
  const product = { id: '1', name: 'Capinha', description: 'Proteção reforçada.', sku: 'CASE', price: '19.90', stock: 3, active: true };
  const result = priceCart(requested, [product]);
  assert.equal(result.total, 59.7);
  assert.equal(result.items[0].unit_price, 19.9);
  assert.equal(result.items[0].description, 'Proteção reforçada.');
  assert.throws(() => priceCart(requested, [{ ...product, stock: 2 }]), /Estoque insuficiente/);
  assert.throws(() => priceCart(requested, [{ ...product, active: false }]), /disponível/);
});
test('idempotency hash ignores key, but captures changes in client or cart', () => {
  const a = normalizeCheckout(input());
  assert.equal(checkoutHash(a), checkoutHash({ ...a, checkout_key: randomUUID() }));
  assert.notEqual(checkoutHash(a), checkoutHash({ ...a, customer_name: 'Outro cliente' }));
});
test('webhook signature rejects missing or tampered headers and data', () => {
  const secret = 'test-secret'; const dataId = '123'; const requestId = 'req-1'; const ts = '1742505638683';
  const digest = createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  const args = { secret, dataId, requestId, signature: `ts=${ts},v1=${digest}` };
  assert.equal(verifyWebhook(args), true);
  for (const changed of [{ dataId: '124' }, { requestId: 'other' }, { secret: '' }, { signature: '' }, { signature: 'ts=abc,v1=00' }]) assert.equal(verifyWebhook({ ...args, ...changed }), false);
});
test('payment requires matching amount, reference, currency, receiver and test mode', () => {
  const payment = { id: '123', external_reference: 'key', transaction_amount: 19.9, currency_id: 'BRL', collector_id: '456', live_mode: false, status: 'approved' };
  const order = { checkout_key: 'key', total: '19.90' }; const config = { testMode: true, merchantId: '456', verifiedTestSeller: true };
  validatePayment(payment, order, config);
  for (const changed of [{ transaction_amount: 1 }, { external_reference: 'other' }, { currency_id: 'USD' }, { collector_id: '000' }, { live_mode: 'true' }, { status: 'invented' }]) assert.throws(() => validatePayment({ ...payment, ...changed }, order, config));
});
test('test mode refuses a real seller before opening a checkout', async () => {
  const mp = createMercadoPago({ token: 'placeholder', fetcher: async () => ({ ok: true, json: async () => ({ id: 1, tags: [] }) }) });
  await assert.rejects(mp.merchant(), /conta vendedora de teste/);
});
test('localhost returns do not enable HTTPS-only auto return or webhook', () => {
  const order = { public_token: randomUUID(), checkout_key: randomUUID(), created_at: new Date(), items: [{ name: 'Fone', product_id: '1', quantity: 1, unit_price: 99.9 }], customer_name: 'Cliente', customer_email: 'cliente@example.com', customer_address: 'Rua Teste, 10, Centro, Curitiba PR', customer_zipcode: '80000-000', customer_whatsapp: '5541999999999' };
  const local = preferenceBody(order, 'http://localhost:5173', '');
  assert.equal(local.auto_return, undefined);
  assert.equal(local.notification_url, undefined);
  assert.match(local.back_urls.success, /^http:\/\/localhost:5173/);
  const production = preferenceBody(order, 'https://example.com', 'https://example.com/api/payments/webhook');
  assert.equal(production.auto_return, 'approved');
});

test('published checkout returns every payment result to the current domain and identifies the order', () => {
  const token = randomUUID();
  const order = { public_token: token, checkout_key: randomUUID(), created_at: new Date(), items: [{ name: 'Produto teste', product_id: '1', quantity: 1, unit_price: 10 }], customer_name: 'Cliente', customer_email: 'cliente@example.com', customer_address: 'Rua Teste, 10, Centro, Curitiba PR', customer_zipcode: '80000-000', customer_whatsapp: '5541999999999' };
  const domain = 'https://luxphones1-odpn.vercel.app';
  const body = preferenceBody(order, domain, domain + '/api/payments/webhook');
  for (const value of Object.values(body.back_urls)) {
    const url = new URL(value);
    assert.equal(url.origin, domain);
    assert.equal(url.searchParams.get('checkout_return'), token);
  }
  assert.equal(body.auto_return, 'approved');
  assert.equal(body.notification_url, domain + '/api/payments/webhook');
});

test('verified test sellers accept live_mode=true without allowing an unverified test environment', () => {
  const payment = { id: '123', external_reference: 'key', transaction_amount: 19.9, currency_id: 'BRL', collector_id: '456', live_mode: true, status: 'approved' };
  const order = { checkout_key: 'key', total: '19.90' };
  validatePayment(payment, order, { testMode: true, merchantId: '456', verifiedTestSeller: true });
  assert.throws(() => validatePayment(payment, order, { testMode: true, merchantId: '456' }), /Ambiente/);
  assert.throws(() => validatePayment({ ...payment, live_mode: false }, order, { testMode: false, merchantId: '456' }), /Ambiente/);
});

test('checkout requires an address and CEP, accepts optional complement, and hashes delivery changes', () => {
  const body = input();
  const normalized = normalizeCheckout({ ...body, customer_complement: '  Apto 12  ' });
  assert.equal(normalized.customer_zipcode, '80000000');
  assert.equal(normalized.customer_complement, 'Apto 12');
  assert.equal(normalizeCheckout(body).customer_complement, '');
  for (const changed of [{ customer_address: '' }, { customer_address: 'a'.repeat(301) }, { customer_zipcode: '12345' }, { customer_complement: 'a'.repeat(161) }]) assert.throws(() => normalizeCheckout({ ...body, ...changed }));
  assert.notEqual(checkoutHash(normalized), checkoutHash({ ...normalized, customer_address: 'Outro endereço, 20' }));
  assert.notEqual(checkoutHash(normalized), checkoutHash({ ...normalized, customer_complement: 'Apto 13' }));
});
