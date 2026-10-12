import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { checkoutBody, normalizePagBankOrder, pagBankCheckoutUrl, verifyPagBankWebhook } from './pagbank-policy.js';
import { createPagBank } from './pagbank.js';

function order() {
  return { checkout_key: randomUUID(), public_token: randomUUID(), created_at: new Date(), total: '39.80', items: [{ product_id: '1', name: 'Capinha', quantity: 2, unit_price: 19.9 }] };
}

test('PagBank checkout uses cents, a return token and payment notification URL', () => {
  const localOrder = order();
  const body = checkoutBody(localOrder, 'https://luxphones.example', 'https://luxphones.example/api/payments/webhook');
  assert.equal(body.reference_id, localOrder.checkout_key);
  assert.equal(body.items[0].unit_amount, 1990);
  assert.equal(body.items[0].quantity, 2);
  assert.equal(new URL(body.return_url).searchParams.get('checkout_return'), localOrder.public_token);
  assert.deepEqual(body.payment_notification_urls, ['https://luxphones.example/api/payments/webhook']);
});

test('PagBank client uses the selected API environment and server bearer token', async () => {
  let request;
  const pagbank = createPagBank({ token: 'private-token', testMode: true, fetcher: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ id: 'CHEC_123456789012' }) };
  } });
  await pagbank.request('/checkouts', { method: 'POST', body: { reference_id: 'checkout' } });
  assert.equal(request.url, 'https://sandbox.api.pagseguro.com/checkouts');
  assert.equal(request.options.headers.Authorization, 'Bearer private-token');
  assert.deepEqual(JSON.parse(request.options.body), { reference_id: 'checkout' });
});

test('PagBank checkout redirect must be a valid provider PAY link', () => {
  const localOrder = order();
  const valid = { id: 'CHEC_123456789012', reference_id: localOrder.checkout_key, status: 'ACTIVE', links: [{ rel: 'PAY', href: 'https://pagamento.pagbank.com.br/pagamento?code=123' }] };
  assert.equal(pagBankCheckoutUrl(valid, localOrder.checkout_key), valid.links[0].href);
  assert.throws(() => pagBankCheckoutUrl({ ...valid, links: [{ rel: 'PAY', href: 'https://evil.example/pay' }] }, localOrder.checkout_key), /checkout válido/);
  assert.throws(() => pagBankCheckoutUrl({ ...valid, reference_id: randomUUID() }, localOrder.checkout_key), /checkout válido/);
});

test('PagBank webhook validates SHA-256 over the exact raw request body', () => {
  const rawBody = '{"id":"ORDE_123","reference_id":"key"}';
  const token = 'pagbank-secret';
  const signature = createHash('sha256').update(`${token}-${rawBody}`).digest('hex');
  assert.equal(verifyPagBankWebhook({ signature, rawBody, token }), true);
  assert.equal(verifyPagBankWebhook({ signature, rawBody: '{ "id":"ORDE_123", "reference_id":"key" }', token }), false);
  assert.equal(verifyPagBankWebhook({ signature, rawBody, token: '' }), false);
});

test('PagBank payment normalization checks the reference, BRL total and provider status', () => {
  const localOrder = order();
  const resource = { id: 'ORDE_123456', reference_id: localOrder.checkout_key, created_at: new Date().toISOString(), charges: [{ id: 'CHAR_123', status: 'PAID', created_at: new Date().toISOString(), amount: { value: 3980, currency: 'BRL', summary: { refunded: 0 } } }] };
  assert.equal(normalizePagBankOrder(resource, localOrder).status, 'approved');
  assert.throws(() => normalizePagBankOrder({ ...resource, charges: [{ ...resource.charges[0], amount: { value: 100, currency: 'BRL' } }] }, localOrder), /não corresponde/);
  const retry = { ...resource, charges: [{ id: 'CHAR_FAILED', status: 'DECLINED', created_at: resource.created_at, amount: { value: 3980, currency: 'BRL' } }, resource.charges[0]] };
  assert.equal(normalizePagBankOrder(retry, localOrder).status, 'approved');
  const duplicate = { ...resource, charges: [resource.charges[0], { ...resource.charges[0], id: 'CHAR_SECOND' }] };
  assert.equal(normalizePagBankOrder(duplicate, localOrder).duplicateApproved, true);
  assert.throws(() => normalizePagBankOrder({ ...resource, reference_id: randomUUID() }, localOrder), /não corresponde/);
  assert.throws(() => normalizePagBankOrder({ ...resource, charges: [{ ...resource.charges[0], amount: { value: 100, currency: 'USD' } }] }, localOrder), /não corresponde/);
  const partial = { ...resource, charges: [{ ...resource.charges[0], amount: { value: 3980, currency: 'BRL', summary: { refunded: 500 } } }] };
  assert.equal(normalizePagBankOrder(partial, localOrder).status, 'partially_refunded');
  assert.equal(normalizePagBankOrder(partial, localOrder).refundedAmount, 5);
  const refunded = { ...resource, charges: [{ ...resource.charges[0], status: 'REFUNDED', amount: { value: 3980, currency: 'BRL' } }] };
  assert.equal(normalizePagBankOrder(refunded, localOrder).status, 'refunded');
});