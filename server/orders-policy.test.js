import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ordersBody, normalizeOrdersPayment } from './orders-policy.js';
const id = 'ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9';
const local = () => ({ mp_order_id: id, checkout_key: randomUUID(), public_token: randomUUID(), total: '39.80', customer_email: 'test@testuser.com', items: [{ product_id: '1', name: 'Capinha', unit_price: 19.9, quantity: 2 }] });
const resource = (order) => ({ id, external_reference: order.checkout_key, type: 'online', processing_mode: 'manual', user_id: '99', currency: 'BRL', total_amount: '39.80', total_paid_amount: '39.80', status: 'processed', status_detail: 'accredited', last_updated_date: new Date().toISOString(), transactions: { payments: [{ id: 'PAY01J67CQQH5904WDBVZEM4JMEP3', status: 'processed', status_detail: 'accredited' }] } });

test('Orders checkout uses decimal strings and the supported item fields with HTTPS returns', () => {
  const order = local();
  const body = ordersBody(order, 'https://luxphones1-odpn.vercel.app');
  assert.equal(body.total_amount, '39.80');
  assert.equal(body.items[0].unit_price, '19.90');
  assert.equal(body.items[0].unit_measure, undefined);
  assert.equal(body.items[0].total_amount, undefined);
  assert.equal(body.processing_mode, 'manual');
  assert.equal(body.config.online.auto_return, 'approved');
  for (const key of ['success_url', 'failure_url', 'pending_url']) assert.equal(new URL(body.config.online[key]).searchParams.get('checkout_return'), order.public_token);
});
test('Orders confirmation verifies resource ID, seller, reference, currency, type and amount', () => {
  const order = local(); const mp = resource(order);
  assert.equal(normalizeOrdersPayment(mp, order, 99).status, 'approved');
  for (const changed of [{ id: '45189133893' }, { id: 'ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP0' }, { user_id: 'other' }, { currency: 'USD' }, { external_reference: randomUUID() }, { total_amount: '1.00' }, { total_paid_amount: '1.00' }, { type: 'qr' }, { processing_mode: 'automatic' }]) assert.throws(() => normalizeOrdersPayment({ ...mp, ...changed }, order, 99));
});
test('pending, declined, review, cancellation and refund map without claiming a payment approval', () => {
  const order = local(); const mp = resource(order);
  for (const [status, detail, expected] of [['created','created','pending'],['processing','in_process','in_process'],['failed','high_risk','rejected'],['action_required','waiting_capture','authorized'],['canceled','canceled','cancelled'],['processed','refunded','refunded']]) assert.equal(normalizeOrdersPayment({ ...mp, status, status_detail: detail }, order, 99).status, expected);
  assert.throws(() => normalizeOrdersPayment({ ...mp, status_detail: 'unknown' }, order, 99), /não reconhecido/);
  assert.equal(normalizeOrdersPayment({ ...mp, status: 'refunded' }, order, 99).refundedAmount, 39.8);
});
test('partial refund carries the confirmed refund amount and refuses an incomplete refund snapshot', () => {
  const order = local(); const mp = resource(order);
  const partial = { ...mp, status_detail: 'partially_refunded', transactions: { ...mp.transactions, refunds: [{ amount: '10.00', status: 'processed' }] } };
  assert.equal(normalizeOrdersPayment(partial, order, 99).refundedAmount, 10);
  assert.equal(normalizeOrdersPayment(partial, order, 99).status, 'partially_refunded');
  assert.equal(normalizeOrdersPayment({ ...partial, total_paid_amount: '29.80' }, order, 99).refundedAmount, 10);
  assert.throws(() => normalizeOrdersPayment({ ...partial, transactions: {} }, order, 99));
});
