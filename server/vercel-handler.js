// One Express instance is reused across warm function invocations.
export function createVercelHandler(loadApp, env = process.env) {
  let appPromise;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const missing = ['DATABASE_URL', 'JWT_SECRET'].filter((key) => !env[key]);
    if (missing.length || (env.JWT_SECRET || '').length < 32) {
      return res.status(503).json({ error: missing.length ? `Configure ${missing.join(' e ')} nas variáveis de ambiente da Vercel e faça um novo deploy.` : 'JWT_SECRET precisa ter pelo menos 32 caracteres. Atualize a variável na Vercel e faça um novo deploy.' });
    }
    try {
      if (!appPromise) appPromise = loadApp().catch((error) => { appPromise = undefined; throw error; });
      const app = await appPromise;
      return app(req, res);
    } catch (error) {
      console.error('Falha ao carregar a API:', error.code || error.name);
      return res.status(503).json({ error: 'Não foi possível iniciar a API. Confira as variáveis de ambiente e os logs da função na Vercel.' });
    }
  };
}
