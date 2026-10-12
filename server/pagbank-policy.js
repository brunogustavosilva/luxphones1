import { createHash, timingSafeEqual } from 'node:crypto';
import { problem } from './commerce-policy.js';

export function checkoutBody(order, siteUrl, webhookUrl) {
  const returnUrl = new URL('/', siteUrl);
  returnUrl.searchParams.set('checkout_return', order.public_token);
  const body = {
    reference_id: order.checkout_key,
    expiration_date: new Date(new Date(order.created_at).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    customer_modifiable: true,
    items: order.items.map((item) => ({
      reference_id: item.product_id,
      name: item.name.slice(0, 100),
      quantity: item.quantity,
      unit_amount: Math.round(Number(item.unit_price) * 100),
    })),
    return_url: returnUrl.href,
    redirect_url: returnUrl.href,
  };
  if (webhookUrl) body.payment_notification_urls = [webhookUrl];
  return body;
}

export function pagBankCheckoutUrl(resource, checkoutKey) {
  const payUrl = resource?.links?.find((link) => link.rel === 'PAY')?.href;
  let url;
  try { url = new URL(payUrl); } catch { throw problem('PagBank não retornou um checkout válido.', 502); }
  if (!/^CHEC_[A-F0-9-]{12,}$/i.test(resource.id || '') || resource.reference_id !== checkoutKey || resource.status !== 'ACTIVE' || url.protocol !== 'https:' || !/(^|\.)pagbank\.com\.br$|(^|\.)pagseguro\.uol\.com\.br$/i.test(url.hostname)) {
    throw problem('PagBank não retornou um checkout válido.', 502);
  }
  return url.href;
}

export function verifyPagBankWebhook({ signature, rawBody, token }) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature) || typeof rawBody !== 'string' || !token) return false;
  const expected = createHash('sha256').update(`${token}-${rawBody}`).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(expected, received);
}

export function normalizePagBankOrder(resource, order) {
  if (!resource?.id || resource.reference_id !== String(order.checkout_key)) throw problem('Pedido PagBank não corresponde ao checkout.', 409);
  const charges = Array.isArray(resource.charges) ? resource.charges : [];
  if (!charges.length) throw problem('PagBank ainda não retornou os pagamentos do pedido.', 409);

  const expectedTotal = Math.round(Number(order.total) * 100);
  if (charges.some((charge) => charge.amount?.currency !== 'BRL' || !Number.isSafeInteger(Number(charge.amount?.value)) || Number(charge.amount.value) !== expectedTotal)) {
    throw problem('Valor do pagamento PagBank não corresponde ao pedido.', 409);
  }

  const paid = charges.filter((charge) => ['PAID', 'REFUNDED'].includes(charge.status));
  const refunded = paid.reduce((sum, charge) => sum + Number(charge.amount?.summary?.refunded ?? (charge.status === 'REFUNDED' ? charge.amount.value : 0)), 0);
  const status = paid.length
    ? refunded >= expectedTotal ? 'refunded' : refunded > 0 ? 'partially_refunded' : 'approved'
    : charges.some((charge) => ['CHARGEBACK', 'IN_DISPUTE'].includes(charge.status)) ? 'charged_back'
      : charges.some((charge) => charge.status === 'AUTHORIZED') ? 'authorized'
      : charges.some((charge) => charge.status === 'IN_ANALYSIS') ? 'in_process'
        : charges.some((charge) => charge.status === 'DECLINED') ? 'rejected'
          : charges.some((charge) => charge.status === 'CANCELED') ? 'cancelled'
            : charges.every((charge) => charge.status === 'EXPIRED') ? 'cancelled' : 'pending';
  const latest = charges.toSorted((left, right) => String(right.paid_at || right.created_at || '').localeCompare(String(left.paid_at || left.created_at || '')))[0];
  const updatedAt = latest.paid_at || latest.created_at || resource.created_at;
  if (!Number.isFinite(new Date(updatedAt).getTime())) throw problem('Data do pagamento PagBank inválida.', 502);
  return { status, paymentId: paid[0]?.id || charges[0]?.id, updatedAt, refundedAmount: refunded / 100, duplicateApproved: paid.filter((charge) => charge.status === 'PAID').length > 1 };
}