# luxphones1

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

O carrinho permite adicionar, remover e ajustar quantidades, e guarda apenas IDs e quantidades no navegador. No checkout, o cliente informa nome, WhatsApp e e-mail. Preços e disponibilidade são conferidos no servidor; os valores enviados pelo navegador não definem a cobrança. O pagamento usa o redirecionamento do Checkout Pro via **Orders API** do Mercado Pago. Novos checkouts são criados com `POST /v1/orders`, guardam `mp_order_id` e são consultados por `GET /v1/orders/{id}`. Pedidos anteriores sem `mp_order_id` mantêm a consulta via Payments/Preferences. A Public Key não é necessária nesse fluxo, pois não há coleta de cartão na aplicação.

A entrega/retirada é combinada pelo WhatsApp. O checkout cobra os produtos, sem calcular ou incluir frete. Não há cálculo de entrega nem coleta de endereço nesta versão.

Pedidos exibem cliente, WhatsApp, descrição da compra, valor, pagamento e operação. Pagamentos online são confirmados exclusivamente pela API do Mercado Pago; o painel permite atualizar a consulta, enviar e entregar depois da aprovação. Pedidos de balcão permitem registro manual de recebimento. A receita de vendas considera pagamentos aprovados e desconta os valores confirmados de reembolsos parciais. O tema claro mantém a aparência existente, e o tema escuro usa carvão e dourado; a escolha é salva no navegador.

## Mercado Pago no localhost

Configure as variáveis de servidor em `.env.local`:

```dotenv
MP_ACCESS_TOKEN=token-da-conta-vendedora-de-teste
MP_ENV=test
SITE_URL=http://localhost:5173
MP_WEBHOOK_URL=
MP_WEBHOOK_SECRET=
```

O servidor verifica se a conta vendedora realmente é de teste antes de criar o checkout. Tokens de contas de teste do Checkout Pro também podem começar por `APP_USR`; o prefixo sozinho não determina o ambiente. Nunca coloque o Access Token em uma variável `VITE_*`, código de frontend ou arquivo versionado. Use uma conta compradora de teste diferente da vendedora e os meios de pagamento de teste fornecidos pelo Mercado Pago.

No localhost, clique no retorno à loja no Checkout Pro depois de pagar. A confirmação é consultada diretamente no provedor ao retornar, e pode ser atualizada no site ou no painel. Consultas repetidas são limitadas e reutilizam o resultado por 15 segundos. Não há polling contínuo. O Mercado Pago não consegue enviar webhooks para localhost; por isso, pagamentos concluídos sem retorno exigem a ação **Atualizar pagamento** no painel.

A API reaproveita o pedido para tentativas com a mesma chave e os mesmos dados de checkout. O link de checkout tem validade de 24 horas. O estoque é abatido uma única vez após a confirmação, dentro de uma transação. Não há reserva de estoque durante o pagamento: se outro comprador consumir as últimas unidades, o pedido aprovado é sinalizado e o envio bloqueado para a equipe conferir a disponibilidade. Uma confirmação de reembolso não repõe estoque automaticamente: ajuste-o após a devolução física. Uma segunda cobrança aprovada no mesmo pedido também é sinalizada para conferência no Mercado Pago.

## Implantação de pagamentos

1. Execute `npm run db:migrate` para aplicar as alterações aditivas de categorias e pedidos. O comando usa a conexão direta; a API continua usando a pooled. A inicialização da API também aplica as migrações de forma idempotente.
2. Configure `SITE_URL` com o domínio público HTTPS.
3. No painel do Mercado Pago, configure os eventos **Order (Mercado Pago)** para novos pedidos e **Pagamentos** para pedidos antigos para `https://SEU-DOMINIO/api/payments/webhook` e obtenha a chave de assinatura. Defina a mesma URL em `MP_WEBHOOK_URL` e a chave em `MP_WEBHOOK_SECRET`.
4. Para cobrar de verdade, substitua o token por credenciais de produção e configure `MP_ENV=production`. Reinicie a API depois de alterar as variáveis. O servidor recusa contas de teste no modo de produção.

O webhook verifica a assinatura HMAC e consulta o pagamento no Mercado Pago antes de atualizar o pedido. A confirmação exige correspondência de referência, valor, moeda, recebedor e ambiente. Alterar parâmetros na URL de retorno nunca marca um pedido como pago. Reembolsos e contestações são refletidos ao receber uma notificação ou atualizar o pagamento. A retenção de três meses continua valendo para pedidos online e de balcão.

Referências oficiais: [Checkout Pro](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-pro-preferences/overview), [contas de teste](https://www.mercadopago.com.br/developers/en/docs/checkout-pro-preferences/test-accounts), [notificações e assinatura](https://www.mercadopago.com.br/developers/en/docs/checkout-pro-preferences/payment-notifications).

Os testes em `server/commerce-policy.test.js` cobrem validação do carrinho, preços, estoque, ambiente e assinatura. `server/commerce.integration.test.js` cobre migração, checkout concorrente, pagamentos e retenção no PostgreSQL isolado; é ignorado quando `COMMERCE_TEST_DATABASE_URL` não está definida e exige `COMMERCE_TEST_BRANCH_HOST` com o hostname exato da branch isolada. O teste nunca usa `DATABASE_URL` como fallback.

## Vercel: frontend e API

O repositório contém `api/index.js`, que expõe a API Express como uma função Node.js. `vercel.json` configura o build Vite, encaminha `/api/*` para a função e `/admin/*` para o React. A função importa o Express sem abrir uma porta e sem executar migrações ou criar dados a cada inicialização. O desenvolvimento local e o Docker continuam inicializando o banco normalmente.

No projeto da Vercel, em **Settings → Environment Variables**, configure para Production (e Preview, se for usar previews):

- `DATABASE_URL`: conexão pooled do banco Neon existente, igual à usada localmente. Nunca use o prefixo `VITE_` para segredos.
- `JWT_SECRET`: segredo com pelo menos 32 caracteres. Deve permanecer estável para as sessões continuarem válidas.
- `SITE_URL`: `https://luxphones1-odpn.vercel.app`.
- Para checkout: `MP_ACCESS_TOKEN`, `MP_ENV` (`test` enquanto usar a conta de teste), `MP_WEBHOOK_URL` e `MP_WEBHOOK_SECRET` quando as notificações estiverem configuradas.

O `.env.local` não é enviado ao GitHub e não configura automaticamente a Vercel. Após cadastrar ou alterar variáveis, faça **Redeploy**. Use a raiz do repositório como Root Directory, preset **Vite**, build `npm run build` e saída `dist`.

O banco atual já recebeu a migração de comércio. Se trocar para um banco novo, aplique `npm run db:migrate` antes de usar a API e inicialize uma conta administrativa. A função não cria uma conta automaticamente. `ADMIN_PASSWORD` só é usada na criação inicial; alterá-la no painel da Vercel não muda a senha de uma conta já existente.

Para verificar o deploy, abra `/api/health`: deve retornar `{"status":"ok","database":"connected"}`. `/api/products` deve retornar JSON, e `/api/auth/me` deve retornar 401 em JSON para visitantes sem sessão. Se retornar HTML/404, confira as regras de roteamento e se o deploy inclui a função. Se retornar 503, confira as variáveis e os logs; se retornar 500, confira conectividade, URL do banco e tabelas.

Referência: [Vite e funções na Vercel](https://vercel.com/docs/frameworks/frontend/vite).

Para testar o checkout publicado, mantenha `MP_ENV=test` e `SITE_URL=https://luxphones1-odpn.vercel.app`. A API recusa um endereço de retorno HTTP/localhost quando executa na Vercel. Configure `MP_WEBHOOK_URL=https://luxphones1-odpn.vercel.app/api/payments/webhook` junto com `MP_WEBHOOK_SECRET`, obtido no painel do Mercado Pago. Valide o status pelo retorno à loja/Atualizar pagamento e configure o evento Order (Mercado Pago) para receber notificações da Orders API. Use o simulador do painel do Mercado Pago para conferir a assinatura e a recepção do webhook.

## Orders API e avaliação da integração

Após atualizar esta versão, execute `npm run db:migrate` antes do deploy. A migração `002-orders-api.sql` adiciona `mp_order_id` e o valor de reembolso sem apagar ou converter os pedidos existentes.

Novos pagamentos usam uma order `online`, com processamento `manual`, captura `automatic_async`, preços em strings decimais e chave de idempotência por checkout. O código verifica o Order ID, referência, conta vendedora, moeda e valores antes de confirmar o pagamento. Estados pendentes, em análise e autorizados não são marcados como pagos. A baixa de estoque continua transacional e ocorre uma única vez.

O painel mostra o **Order ID** completo nos pedidos novos; a página de retorno também mostra esse ID no modo de teste. Para a avaliação de qualidade, faça uma **nova compra de teste após o deploy**, aguarde a aprovação e copie esse identificador. IDs de ordens comerciais dos pagamentos antigos e Payment IDs não substituem o ID `ORD…`/`ORDTST…` da Orders API.

No Mercado Pago, habilite **Order (Mercado Pago)** (tópico `orders_v2`, notificações com `type=order`) para `https://luxphones1-odpn.vercel.app/api/payments/webhook`. Mantenha o evento **Pagamentos** se ainda precisar atualizar checkouts antigos. Configure a chave da mesma aplicação em `MP_WEBHOOK_SECRET` na Vercel e faça Redeploy após alterar variáveis. A assinatura é verificada antes de consultar a order no provedor; estados informados pelo navegador ou pelo corpo do webhook nunca confirmam pagamento.

Referências: [criação de order](https://www.mercadopago.com.br/developers/en/docs/checkout-pro-orders/create-order), [URLs de retorno](https://www.mercadopago.com.br/developers/en/docs/checkout-pro-orders/web-integration/configure-back-urls), [notificações Orders](https://www.mercadopago.com.br/developers/en/docs/checkout-pro-orders/notifications).
