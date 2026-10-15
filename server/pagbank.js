function problem(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function createPagBank({ token, testMode = true, fetcher = fetch }) {
  const baseUrl = testMode
    ? 'https://sandbox.api.pagseguro.com'
    : 'https://api.pagseguro.com';

  async function request(path, { method = 'GET', body } = {}) {
    if (!token) {
      throw problem('Pagamento PagBank não configurado.', 503);
    }

    let response;

    try {
      console.log('[PAGBANK] Iniciando requisição:', {
        endpoint: path.split('?')[0],
        method,
        environment: testMode ? 'sandbox' : 'production'
      });

      response = await fetcher(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000)
      });

    } catch (error) {
      console.error('[PAGBANK] Falha de comunicação:', {
        name: error.name,
        message: error.message
      });

      throw problem('Falha de comunicação com PagBank.', 502);
    }

    const rawResponse = await response.text();

    let data;

    try {
      data = JSON.parse(rawResponse);
    } catch {
      data = {};
    }

    if (!response.ok) {
      console.error('[PAGBANK ERROR]', {
        status: response.status,
        endpoint: path.split('?')[0],
        details: rawResponse.slice(0, 2000)
      });

      throw problem(
        response.status === 401 || response.status === 403
          ? 'Credencial PagBank inválida ou sem permissão.'
          : 'Erro na API PagBank.',
        502
      );
    }

    console.log('[PAGBANK] Requisição concluída:', {
      status: response.status
    });

    return data;
  }

  return { request, testMode };
}