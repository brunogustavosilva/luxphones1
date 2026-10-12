import { problem } from './commerce-policy.js';

export function createMercadoPago({ token, testMode = true, fetcher = fetch }) {
  let merchantPromise;
  async function request(path, { method = 'GET', body, key } = {}) {
    if (!token) throw problem('Pagamento ainda não configurado no servidor.', 503);
    let response;
    try {
      response = await fetcher(`https://api.mercadopago.com${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(key ? { 'X-Idempotency-Key': key } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
    } catch { throw problem('Mercado Pago indisponível. Tente novamente em instantes.', 502); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Never expose provider responses, credentials, or customer information in logs.
      console.error(`Mercado Pago: HTTP ${response.status} em ${path.split('?')[0]}`);
      throw problem(response.status === 401 || response.status === 403 ? 'Credencial do Mercado Pago inválida ou sem permissão.' : 'Não foi possível concluir a solicitação ao Mercado Pago.', 502);
    }
    return data;
  }
  async function merchant() {
    if (!merchantPromise) merchantPromise = request('/users/me').then((user) => {
      const testAccount = user.tags?.includes('test_user');
      if (testMode && !testAccount) throw problem('Modo de teste exige credenciais de uma conta vendedora de teste do Mercado Pago.', 503);
      if (!testMode && testAccount) throw problem('Conta de teste não pode ser usada no modo de produção.', 503);
      return user.id;
    }).catch((error) => { merchantPromise = undefined; throw error; });
    return merchantPromise;
  }
  return { request, merchant, testMode };
}

export function preferenceBody(order, siteUrl, webhookUrl) {
  const returnUrl = new URL('/', siteUrl);
  returnUrl.searchParams.set('checkout_return', order.public_token);
  const result = {
    external_reference: order.checkout_key,
    items: order.items.map((item) => ({ id: item.product_id, title: item.name, quantity: item.quantity, currency_id: 'BRL', unit_price: item.unit_price })),
    payer: { name: order.customer_name, email: order.customer_email, phone: { area_code: order.customer_whatsapp.slice(2, 4), number: order.customer_whatsapp.slice(4) } },
    back_urls: { success: returnUrl.href, pending: returnUrl.href, failure: returnUrl.href },
    expires: true,
    expiration_date_to: new Date(new Date(order.created_at).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    statement_descriptor: 'LUXPHONES',
  };
  // Mercado Pago requires HTTPS for automatic returns and notifications.
  if (returnUrl.protocol === 'https:') result.auto_return = 'approved';
  if (webhookUrl) result.notification_url = webhookUrl;
  return result;
}
