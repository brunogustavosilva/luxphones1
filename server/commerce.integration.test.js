import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
import { registerCommerce } from './commerce.js';
import { createRetentionCleanup } from './retention.js';

const connectionString = process.env.COMMERCE_TEST_DATABASE_URL;
test('commerce migration and checkout/payment/retention against isolated PostgreSQL', { skip: !connectionString, timeout: 120000 }, async (t) => {
  // Require explicit test credentials. Never fall back to DATABASE_URL.
  assert.match(new URL(connectionString).hostname, new RegExp('^' + String(process.env.COMMERCE_TEST_BRANCH_HOST || 'missing-test-host').replaceAll('.', '\\.').replaceAll('-', '\\-') + '$'), 'Use the explicitly configured isolated test branch');
  const schema = `commerce_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, options: `-c search_path=${schema}`, max: 4 });
  const base = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  const migration = await readFile(new URL('./migrations/001-commerce.sql', import.meta.url), 'utf8');
  await pool.query(base);
  await pool.query("INSERT INTO orders(customer_name,total,status) VALUES ('Legacy',100,'paid')");
  await pool.query(migration);
  await pool.query(migration);
  assert.equal((await pool.query("SELECT payment_status FROM orders WHERE customer_name='Legacy'")).rows[0].payment_status, 'approved');
  const { rows: [product] } = await pool.query("INSERT INTO products(name,sku,category,product_type,price,stock) VALUES ('Capinha','CASE','Luxphone','cases',19.90,3) RETURNING id");
  let preferences = 0;
  let preferenceInput;
  const payments = new Map();
  const provider = { testMode: true, merchant: async () => 99, request: async (path, options) => {
    if (path === '/checkout/preferences') { preferences++; preferenceInput = options.body; return { id: 'pref-test', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-test' }; }
    if (path.startsWith('/v1/payments/search')) return { results: [...payments.values()] };
    return payments.get(path.split('/').at(-1));
  } };
  const app = express(); app.use(express.json());
  const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req,res,next)).catch(next);
  const { applyPayment } = registerCommerce(app, { pool, provider, requireAdmin: (_req,_res,next) => next(), asyncRoute, cleanupHistory: createRetentionCleanup(pool), webhookSecret: 'test-secret', siteUrl: 'http://localhost:5173', webhookUrl: '' });
  app.use((error,_req,res,_next) => res.status(error.status || 500).json({ error:error.message }));
  const server = await new Promise((resolve) => { const handle = app.listen(0,'127.0.0.1',()=>resolve(handle)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function call(path, body, headers={}) { const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}); return { status:response.status, data:await response.json().catch(()=>null) }; }
  try {
    const input={ customer_name:'Cliente Teste', customer_whatsapp:'41999999999', customer_email:'cliente@example.com', checkout_key:randomUUID(), items:[{product_id:String(product.id),quantity:2,price:0.01}] };
    const results=await Promise.all([call('/api/checkout',input),call('/api/checkout',input)]);
    for(const result of results) assert.equal(result.status,201,JSON.stringify(result.data));
    assert.equal(preferences,1);
    assert.equal(results[0].data.order_token,results[1].data.order_token);
    assert.equal(preferenceInput.items[0].unit_price,19.9);
    assert.equal((await call('/api/checkout',{...input,customer_name:'Changed'})).status,409);
    const {rows:[order]}=await pool.query('SELECT id, total, customer_whatsapp, items FROM orders WHERE checkout_key=$1',[input.checkout_key]);
    assert.equal(Number(order.total),39.8);
    assert.equal(order.customer_whatsapp,'5541999999999');
    const token=results[0].data.order_token;
    const publicData=(await call(`/api/checkout/${token}`)).data;
    assert.equal(publicData.customer_whatsapp,undefined);
    assert.equal(publicData.customer_name,undefined);
    assert.equal((await call('/api/checkout/'+randomUUID())).status,404);
    const approved={id:'123',external_reference:input.checkout_key,transaction_amount:39.8,currency_id:'BRL',collector_id:99,live_mode:false,status:'approved',date_last_updated:new Date().toISOString()};
    payments.set('123',approved);
    await Promise.all([applyPayment(approved),applyPayment(approved)]);
    assert.equal((await pool.query('SELECT stock FROM products WHERE id=$1',[product.id])).rows[0].stock,1);
    assert.equal((await call(`/api/checkout/${token}/sync`,{})).data.payment_status,'approved');
    await assert.rejects(applyPayment({...approved,transaction_amount:1}),/corresponde/);
    await applyPayment({...approved,status:'pending',date_last_updated:'2000-01-01T00:00:00Z'});
    assert.equal((await pool.query('SELECT payment_status FROM orders WHERE id=$1',[order.id])).rows[0].payment_status,'approved');
    const rejectedWebhook=await call('/api/payments/webhook?data.id=123&type=payment',{type:'payment',data:{id:'123'}});
    assert.equal(rejectedWebhook.status,401);
    const requestId='request-1'; const ts=String(Date.now()); const sig=createHmac('sha256','test-secret').update(`id:123;request-id:${requestId};ts:${ts};`).digest('hex');
    assert.equal((await call('/api/payments/webhook?data.id=123&type=payment',{type:'payment',data:{id:'123'}},{'x-signature':`ts=${ts},v1=${sig}`,'x-request-id':requestId})).status,200);
    const refunded={...approved,status:'refunded',date_last_updated:new Date(Date.now()+1000).toISOString()};
    await applyPayment(refunded);
    assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[order.id])).rows[0].status,'cancelled');
    assert.equal((await pool.query('SELECT stock FROM products WHERE id=$1',[product.id])).rows[0].stock,1);
    await pool.query("INSERT INTO orders(customer_name,total,created_at) VALUES ('Expired',1,NOW()-INTERVAL '4 months')");
    await createRetentionCleanup(pool)();
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders WHERE customer_name='Expired'")).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n,1);
    await t.test('insufficient stock at confirmation is flagged without negative stock',async()=>{
      const key=randomUUID();
      await pool.query("INSERT INTO orders(customer_name,total,source,checkout_key,items) VALUES ('Another',39.8,'mercado_pago',$1,$2::jsonb)",[key,JSON.stringify(order.items)]);
      await applyPayment({...approved,id:'456',external_reference:key});
      const {rows:[flagged]}=await pool.query('SELECT stock_issue,stock_applied,payment_status FROM orders WHERE checkout_key=$1',[key]);
      assert.equal(flagged.stock_issue,true); assert.equal(flagged.stock_applied,false); assert.equal(flagged.payment_status,'approved');
      assert.equal((await pool.query('SELECT stock FROM products WHERE id=$1',[product.id])).rows[0].stock,1);
    });
  } finally {
    await new Promise((resolve)=>server.close(resolve));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
