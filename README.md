# Lux Baterias

Loja responsiva de smartphones com painel de operação em React, API Express e PostgreSQL no Neon. O catálogo, estoque, pedidos, métricas e tentativas de autenticação ficam no banco.

## Desenvolvimento local

O projeto já está associado ao Neon. O comando `neon link` salvou a URL pooled em `.env.local`, que é ignorado pelo Git. Se precisar associar novamente, use `neon link --project-id wispy-base-72324728 --branch production -y`.

```sh
npm install
npm run dev
```

Abra `http://localhost:5173` para a loja e `http://localhost:5173/admin` para o painel. O Vite encaminha `/api` ao Express na porta 3001.

Na primeira inicialização, a API cria as tabelas descritas em `server/schema.sql`, insere uma conta administrativa com senha bcrypt e inclui quatro produtos de demonstração caso o catálogo esteja vazio. A conta inicial solicitada é `lucasphone2026` / `lucasphone2026`. Não há cadastro público. O usuário é criado apenas uma vez; mudar `ADMIN_PASSWORD` depois disso não altera a senha gravada.

## Neon e variáveis

A API lê primeiro `.env.local` e depois `.env`, sem sobrescrever variáveis já presentes no ambiente. `DATABASE_URL` deve ser a conexão pooled do Neon para tráfego da aplicação. Não compartilhe nem versione esses arquivos.

Para a primeira implantação pública, defina `ADMIN_PASSWORD` e `JWT_SECRET` fortes **antes** de inicializar o banco. Em produção, `JWT_SECRET` precisa ter no mínimo 32 caracteres. A senha de demonstração não deve ser mantida em produção.

## Docker

Copie `.env.example` para `.env`, preencha `DATABASE_URL`, `ADMIN_PASSWORD` e `JWT_SECRET`, então execute:

```sh
docker compose up --build
```

O site e a API ficam disponíveis em `http://localhost:3001`. `.dockerignore` impede que arquivos `.env*` e dependências locais entrem na imagem. O container usa a mesma connection string Neon; não é necessário executar um banco local.

## Funcionalidades

- Vitrine com filtro por marca e catálogo ativo.
- Painel com receita mensal, pedidos, vendas dos últimos sete dias e alertas de estoque baixo.
- CRUD de produtos, registro de pedidos e atualização de status.
- Sessão em cookie HTTP-only, sem rota de cadastro.
- Cinco falhas de login por usuário/endereço IP bloqueiam novas tentativas por 60 segundos.
- Testes da política de bloqueio: `npm test`.
- Build da interface: `npm run build`.

## Retenção do histórico

Pedidos e reparos têm duração de **três meses corridos desde `created_at`**, com o corte calculado no fuso `America/Sao_Paulo`. Atualizar o status não renova o prazo. Registros expirados são excluídos, inclusive pendentes; produtos e contas administrativas não expiram.

A API filtra o período no banco nas listas e métricas. A limpeza física acontece no primeiro acesso autenticado a pedidos, reparos ou métricas e, enquanto houver acessos, no máximo uma vez por hora. Sem acessos, os registros ficam armazenados até o próximo acesso, mas não voltam a aparecer no painel. Falhas na limpeza são registradas e permitem nova tentativa no próximo acesso.

A visão geral carrega apenas os cinco pedidos recentes; as listas de pedidos e reparos são buscadas ao abrir suas seções, mantendo os limites existentes de 100 pedidos e 200 reparos por resposta. Essa política entra em funcionamento ao reiniciar/implantar a API atualizada.

## Carrinho, categorias e temas

A vitrine tem filtros separados por marca e tipo de produto: smartphones, carregadores, fones de ouvido, capinhas, computadores e notebooks. Os produtos existentes são classificados como smartphones; altere a categoria no formulário de edição. Novas categorias aparecem mesmo sem produtos cadastrados, sem inserir estoque fictício.

O carrinho permite adicionar, remover e ajustar quantidades, e guarda apenas IDs e quantidades no navegador. No checkout, o cliente informa nome, WhatsApp, e-mail e endereço. Preços e disponibilidade são conferidos no servidor; os valores enviados pelo navegador não definem a cobrança. O pagamento usa o Checkout PagBank hospedado: a API cria o checkout e redireciona o cliente para o link seguro retornado pelo PagBank. O status é consultado no servidor e confirmado com webhook autenticado. Pedidos anteriores do Mercado Pago continuam identificados e consultáveis durante a transição, se as credenciais MP antigas permanecerem configuradas.

A entrega/retirada é combinada pelo WhatsApp. O checkout cobra os produtos, sem calcular ou incluir frete. Não há cálculo de entrega nem coleta de endereço nesta versão.

Pedidos exibem cliente, WhatsApp, descrição da compra, valor, pagamento e operação. Pagamentos online são confirmados exclusivamente pela API do provedor associado ao pedido; o painel permite atualizar a consulta, enviar e entregar depois da aprovação. Pedidos de balcão permitem registro manual de recebimento. A receita de vendas considera pagamentos aprovados e desconta os valores confirmados de reembolsos parciais. O tema claro mantém a aparência existente, e o tema escuro usa carvão e dourado; a escolha é salva no navegador.

## PagBank no localhost

Configure as variáveis de servidor em `.env.local`:

```dotenv
PAGBANK_ACCESS_TOKEN=token-de-sandbox-do-pagbank
PAGBANK_ENV=sandbox
SITE_URL=http://localhost:5173
PAGBANK_WEBHOOK_URL=
```

Gere o token de sandbox no portal de desenvolvedores PagBank. Nunca coloque o Access Token em uma variável `VITE_*`, no frontend ou em arquivo versionado. O servidor usa `https://sandbox.api.pagseguro.com` quando `PAGBANK_ENV=sandbox` e `https://api.pagseguro.com` quando `PAGBANK_ENV=production`.

No localhost, retorne à loja pelo checkout PagBank depois do pagamento e use **Atualizar pagamento** se a confirmação ainda estiver pendente. Webhooks não chegam a um endereço local; para recebê-los, exponha uma URL HTTPS pública e configure-a em `PAGBANK_WEBHOOK_URL`. A assinatura `x-authenticity-token` é verificada pelo token da conta e pelos bytes exatos do corpo antes de a API consultar o recurso autenticado no PagBank.

O checkout expira após 24 horas. O estoque é abatido uma única vez após a confirmação, dentro de uma transação. Não há reserva de estoque durante o pagamento: se outro comprador consumir as últimas unidades, o pedido aprovado é sinalizado e o envio bloqueado para a equipe conferir a disponibilidade. Uma confirmação de reembolso não repõe estoque automaticamente: ajuste-o após a devolução física. Uma segunda cobrança aprovada no mesmo pedido também é sinalizada para conferência.

## Implantação de pagamentos

1. Execute `npm run db:migrate` para aplicar as alterações aditivas de categorias, pedidos e identificador do checkout PagBank. O comando usa a conexão direta; a API continua usando a pooled. A inicialização da API também aplica as migrações de forma idempotente.
2. Configure `SITE_URL` com o domínio público HTTPS.
3. Configure o webhook HTTPS `https://SEU-DOMINIO/api/payments/webhook` como URL de notificação de pagamentos no PagBank e defina o mesmo endereço em `PAGBANK_WEBHOOK_URL`.
4. Para cobrar de verdade, configure o token de produção e `PAGBANK_ENV=production`. Reinicie ou faça redeploy após alterar as variáveis.

O webhook verifica o SHA-256 do corpo bruto com o token PagBank e consulta o pedido no provedor antes de atualizar o banco. A confirmação exige correspondência da referência, do total e da moeda. Alterar parâmetros na URL de retorno nunca marca um pedido como pago. Reembolsos e contestações são refletidos ao receber uma notificação ou atualizar o pagamento. A retenção de três meses continua valendo para pedidos online e de balcão.

Referências oficiais: [Criar Checkout](https://developer.pagbank.com.br/reference/criar-checkout), [Consultar Checkout](https://developer.pagbank.com.br/reference/consultar-checkout), [Webhooks Checkout](https://developer.pagbank.com.br/reference/webhooks-checkout), [autenticidade da notificação](https://developer.pagbank.com.br/reference/confirmar-autenticidade-da-notificacao).

Os testes em `server/commerce-policy.test.js` cobrem validação do carrinho, preços, estoque, ambiente e assinatura. `server/commerce.integration.test.js` cobre migração, checkout concorrente, pagamentos e retenção no PostgreSQL isolado; é ignorado quando `COMMERCE_TEST_DATABASE_URL` não está definida e exige `COMMERCE_TEST_BRANCH_HOST` com o hostname exato da branch isolada. O teste nunca usa `DATABASE_URL` como fallback.

## Vercel: frontend e API

O repositório contém `api/index.js`, que expõe a API Express como uma função Node.js. `vercel.json` configura o build Vite, encaminha `/api/*` para a função e `/admin/*` para o React. A função importa o Express sem abrir uma porta e sem executar migrações ou criar dados a cada inicialização. O desenvolvimento local e o Docker continuam inicializando o banco normalmente.

No projeto da Vercel, em **Settings → Environment Variables**, configure para Production (e Preview, se for usar previews):

- `DATABASE_URL`: conexão pooled do banco Neon existente, igual à usada localmente. Nunca use o prefixo `VITE_` para segredos.
- `JWT_SECRET`: segredo com pelo menos 32 caracteres. Deve permanecer estável para as sessões continuarem válidas.
- `SITE_URL`: `https://luxphones1-odpn.vercel.app`.
- Para novos checkouts: `PAGBANK_ACCESS_TOKEN`, `PAGBANK_ENV` (`sandbox` durante os testes) e `PAGBANK_WEBHOOK_URL`.
- Para atualizar pedidos Mercado Pago antigos ainda pendentes: mantenha temporariamente `MP_ACCESS_TOKEN`, `MP_ENV` e, se receber notificações MP, `MP_WEBHOOK_SECRET`.

O `.env.local` não é enviado ao GitHub e não configura automaticamente a Vercel. Após cadastrar ou alterar variáveis, faça **Redeploy**. Use a raiz do repositório como Root Directory, preset **Vite**, build `npm run build` e saída `dist`.

O banco atual já recebeu a migração de comércio. Se trocar para um banco novo, aplique `npm run db:migrate` antes de usar a API e inicialize uma conta administrativa. A função não cria uma conta automaticamente. `ADMIN_PASSWORD` só é usada na criação inicial; alterá-la no painel da Vercel não muda a senha de uma conta já existente.

Para verificar o deploy, abra `/api/health`: deve retornar `{"status":"ok","database":"connected"}`. `/api/products` deve retornar JSON, e `/api/auth/me` deve retornar 401 em JSON para visitantes sem sessão. Se retornar HTML/404, confira as regras de roteamento e se o deploy inclui a função. Se retornar 503, confira as variáveis e os logs; se retornar 500, confira conectividade, URL do banco e tabelas.

Referência: [Vite e funções na Vercel](https://vercel.com/docs/frameworks/frontend/vite).

Para testar o checkout publicado, use o token de sandbox com `PAGBANK_ENV=sandbox` e `SITE_URL=https://luxphones1-odpn.vercel.app`. Configure `PAGBANK_WEBHOOK_URL=https://luxphones1-odpn.vercel.app/api/payments/webhook` no ambiente do PagBank e na Vercel. Faça uma nova compra, retorne à loja e valide também com **Atualizar pagamento**; o webhook deve chegar com o header `x-authenticity-token`.

## Transição do Mercado Pago

Novos pedidos usam PagBank. Pedidos Mercado Pago existentes mantêm a origem e os identificadores originais; para continuar sincronizando esses pedidos, conserve `MP_ACCESS_TOKEN` e configure `MP_WEBHOOK_SECRET` até que não haja mais pagamentos pendentes. Remover essas variáveis não apaga histórico, mas desativa a consulta e as notificações MP.
