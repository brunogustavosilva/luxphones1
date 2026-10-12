import { problem } from './commerce-policy.js';
export const ordersIdPattern = /^ORD(?:TST)?[A-Z0-9]{20,32}$/;

export function ordersBody(order, siteUrl) {
  const url = new URL('/', siteUrl);
  url.searchParams.set('checkout_return', order.public_token);
  const online = { success_url: url.href, failure_url: url.href, pending_url: url.href };
  if (url.protocol === 'https:') online.auto_return = 'approved';
  return {
    type: 'online', processing_mode: 'manual', capture_mode: 'automatic_async',
    external_reference: order.checkout_key, total_amount: Number(order.total).toFixed(2),
    expiration_time: 'P1D', payer: { email: order.customer_email },
    items: order.items.map((item) => ({ external_code: item.product_id, title: item.name, quantity: item.quantity, unit_price: Number(item.unit_price).toFixed(2) })),
    config: { online },
  };
}

// A provider order is fetched with the seller's authenticated credential, never
// accepted from the browser or from the body of a webhook.
export function normalizeOrdersPayment(resource, order, merchantId) {
  if (!ordersIdPattern.test(resource?.id || '') || resource.id !== order.mp_order_id || resource.type !== 'online' || resource.processing_mode !== 'manual') throw problem('Order ID não corresponde ao pedido.', 409);
  if (resource.external_reference !== String(order.checkout_key) || resource.currency !== 'BRL' || String(resource.user_id) !== String(merchantId)) throw problem('Order não corresponde ao pedido ou à conta vendedora.', 409);
  const total = Math.round(Number(resource.total_amount) * 100);
  const paid = Math.round(Number(resource.total_paid_amount || 0) * 100);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(paid) || total !== Math.round(Number(order.total) * 100) || paid < 0 || paid > total) throw problem('Valor da order não corresponde ao pedido.', 409);
  let status;
  let refunded = 0;
  const detail = resource.status_detail;
  if (resource.status === 'refunded' || (resource.status === 'processed' && detail === 'refunded')) { status = 'refunded'; refunded = total; }
  else if (resource.status === 'processed' && ['accredited', 'partially_refunded'].includes(detail)) {
    status = detail === 'partially_refunded' ? 'partially_refunded' : 'approved';
    if (status === 'partially_refunded') {
      refunded = (resource.transactions?.refunds || []).filter((item) => item.status === 'processed').reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0);
      if (!Number.isSafeInteger(refunded) || refunded <= 0 || refunded >= total) throw problem('Valores do reembolso parcial ainda não confirmados.', 409);
    }
    if (paid !== total && !(status === 'partially_refunded' && paid + refunded === total)) throw problem('Pagamento da order ainda não foi confirmado integralmente.', 409);
  } else if (resource.status === 'created') status = 'pending';
  else if (resource.status === 'processing') status = 'in_process';
  else if (resource.status === 'action_required') status = detail === 'waiting_capture' ? 'authorized' : 'in_process';
  else if (resource.status === 'failed') status = 'rejected';
  else if (['canceled', 'cancelled', 'expired'].includes(resource.status)) status = 'cancelled';
  else throw problem('Estado da order não reconhecido. Consulte o Mercado Pago.', 502);
  const transactions = resource.transactions?.payments || [];
  const transaction = transactions.find((item) => item.status === 'processed' && item.status_detail === 'accredited') || transactions[0];
  return { status, paymentId: transaction?.id || null, updatedAt: resource.last_updated_date || resource.created_date, refundedAmount: refunded / 100 };
}
