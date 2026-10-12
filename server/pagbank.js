import { problem } from './commerce-policy.js';

export function createPagBank({ token, testMode = true, fetcher = fetch }) {
  const baseUrl = testMode ? 'https://sandbox.api.pagseguro.com' : 'https://api.pagseguro.com';

  async function request(path, { method = 'GET', body } = {}) {
    if (!token) throw problem('Pagamento PagBank ainda não configurado no servidor.', 503);
    let response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
    } catch { throw problem('PagBank indisponível. Tente novamente em instantes.', 502); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`PagBank: HTTP ${response.status} em ${path.split('?')[0]}`);
      throw problem(response.status === 401 || response.status === 403 ? 'Credencial PagBank inválida ou sem permissão.' : 'Não foi possível concluir a solicitação ao PagBank.', 502);
    }
    return data;
  }

  return { request, testMode };
}