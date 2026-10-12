import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const productTypes = ['smartphones', 'chargers', 'headphones', 'cases', 'computers', 'notebooks'];
export const paymentStatuses = ['pending', 'approved', 'authorized', 'in_process', 'in_mediation', 'rejected', 'cancelled', 'refunded', 'charged_back'];
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function problem(message, status = 400) { return Object.assign(new Error(message), { status }); }
export function whatsapp(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!/^\d{12,15}$/.test(digits)) throw problem('Informe um WhatsApp válido com DDD.');
  return digits;
}
export function normalizeCheckout(body) {
  const name = String(body?.customer_name || '').trim();
  const email = String(body?.customer_email || '').trim().toLowerCase();
  if (name.length < 2 || name.length > 120) throw problem('Informe o nome completo do cliente.');
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw problem('Informe um e-mail válido.');
  if (!uuidPattern.test(String(body?.checkout_key || ''))) throw problem('Identificador do carrinho inválido.');
  if (!Array.isArray(body?.items) || !body.items.length || body.items.length > 30) throw problem('O carrinho deve conter de 1 a 30 produtos.');
  const items = new Map();
  for (const item of body.items) {
    const id = String(item?.product_id || '');
    if (!/^\d{1,18}$/.test(id) || BigInt(id) <= 0n || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) throw problem('Revise os produtos e quantidades do carrinho.');
    const quantity = (items.get(id) || 0) + item.quantity;
    if (quantity > 20) throw problem('O limite é de 20 unidades por produto.');
    items.set(id, quantity);
  }
  return { customer_name: name, customer_email: email, customer_whatsapp: whatsapp(body.customer_whatsapp), checkout_key: body.checkout_key.toLowerCase(), items: [...items].sort(([a], [b]) => a.localeCompare(b)).map(([product_id, quantity]) => ({ product_id, quantity })) };
}
export function checkoutHash(input) {
  const { checkout_key, ...payload } = input;
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
export function priceCart(requested, products) {
  const byId = new Map(products.map((product) => [String(product.id), product]));
  let cents = 0;
  const items = requested.map(({ product_id, quantity }) => {
    const product = byId.get(product_id);
    if (!product || !product.active) throw problem('Um produto do carrinho não está mais disponível.', 409);
    if (Number(product.stock) < quantity) throw problem(`Estoque insuficiente para ${product.name}.`, 409);
    const unitCents = Math.round(Number(product.price) * 100);
    if (!Number.isSafeInteger(unitCents) || unitCents <= 0) throw problem(`${product.name} não está disponível para pagamento online.`, 409);
    cents += unitCents * quantity;
    return { product_id, name: product.name, sku: product.sku, quantity, unit_price: unitCents / 100 };
  });
  if (!Number.isSafeInteger(cents) || cents > 999999999999) throw problem('Valor do carrinho inválido.');
  return { items, total: cents / 100 };
}
export function verifyWebhook({ signature, requestId, dataId, secret }) {
  if (!secret || typeof signature !== 'string' || typeof requestId !== 'string' || typeof dataId !== 'string') return false;
  const parts = Object.fromEntries(signature.split(',').map((part) => part.trim().split('=')));
  if (!/^\d+$/.test(parts.ts || '') || !/^[a-f0-9]{64}$/i.test(parts.v1 || '')) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, 'hex'));
}
export function validatePayment(payment, order, { testMode, merchantId }) {
  if (String(payment.external_reference) !== String(order.checkout_key) || payment.currency_id !== 'BRL' || Math.round(Number(payment.transaction_amount) * 100) !== Math.round(Number(order.total) * 100)) throw problem('Pagamento não corresponde ao pedido.', 409);
  if (String(payment.collector_id) !== String(merchantId)) throw problem('Recebedor do pagamento inválido.', 409);
  if (payment.live_mode !== !testMode) throw problem('Ambiente do pagamento não corresponde à configuração.', 409);
  if (!paymentStatuses.includes(payment.status) || !/^\d+$/.test(String(payment.id))) throw problem('Resposta de pagamento inválida.', 502);
}
