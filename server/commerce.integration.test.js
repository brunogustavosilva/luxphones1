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
  const ordersMigration = await readFile(new URL('./migrations/002-orders-api.sql', import.meta.url), 'utf8');
  await pool.query(ordersMigration);
  await pool.query(ordersMigration);
  assert.equal((await pool.query("SELECT payment_status FROM orders WHERE customer_name='Legacy'")).rows[0].payment_status, 'approved');
  const { rows: [product] } = await pool.query("INSERT INTO products(name,sku,category,product_type,price,stock) VALUES ('Capinha','CASE','Luxphone','cases',19.90,3) RETURNING id");
  let creations = 0;
  let checkoutInput;
  const resources = new Map();
  const payments = new Map();
  const remoteId = 'ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9';
  const provider = { testMode: true, merchant: async () => 99, request: async (path, options) => {
    if (path === '/v1/orders') {
      creations++; checkoutInput = options.body;
      const resource = { id: remoteId, external_reference: options.body.external_reference, type: 'online', processing_mode: 'manual', user_id: '99', currency: 'BRL', total_amount: options.body.total_amount, total_paid_amount: '0.00', status: 'created', status_detail: 'created', created_date: new Date().toISOString(), last_updated_date: new Date().toISOString(), checkout_url: `https://www.mercadopago.com.br/checkout/v1/redirect?order_id=${remoteId}` };
      resources.set(remoteId, resource);
      return resource;
    }
    if (path.startsWith('/v1/orders/')) return resources.get(path.split('/').at(-1));
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
    assert.equal(creations,1);
    assert.equal(results[0].data.mp_order_id,remoteId);
    assert.equal(results[0].data.order_token,results[1].data.order_token);
    assert.equal(checkoutInput.items[0].unit_price,'19.90');
    assert.equal((await call('/api/checkout',{...input,customer_name:'Changed'})).status,409);
    const {rows:[order]}=await pool.query('SELECT id, total, customer_whatsapp, items FROM orders WHERE checkout_key=$1',[input.checkout_key]);
    assert.equal(Number(order.total),39.8);
    assert.equal(order.customer_whatsapp,'5541999999999');
    const token=results[0].data.order_token;
    const publicData=(await call(`/api/checkout/${token}`)).data;
    assert.equal(publicData.customer_whatsapp,undefined);
    assert.equal(publicData.customer_name,undefined);
    assert.equal(publicData.mp_order_id,remoteId);
    assert.equal((await call('/api/checkout/'+randomUUID())).status,404);
    const approved={...resources.get(remoteId),total_paid_amount:'39.80',status:'processed',status_detail:'accredited',last_updated_date:new Date().toISOString(),transactions:{payments:[{id:'PAY01J67CQQH5904WDBVZEM4JMEP3',status:'processed',status_detail:'accredited'}]}};
    resources.set(remoteId,approved);
    await Promise.all([applyPayment(approved,true),applyPayment(approved,true)]);
    assert.equal((await pool.query('SELECT stock FROM products WHERE id=$1',[product.id])).rows[0].stock,1);
    assert.equal((await call(`/api/checkout/${token}/sync`,{})).data.payment_status,'approved');
    await assert.rejects(applyPayment({...approved,total_amount:'1.00'},true),/corresponde/);
    await assert.rejects(applyPayment({...approved,id:remoteId.slice(0,-1)+'0'},true),/Order ID/);
    await applyPayment({...approved,status:'created',last_updated_date:'2000-01-01T00:00:00Z'},true);
    assert.equal((await pool.query('SELECT payment_status FROM orders WHERE id=$1',[order.id])).rows[0].payment_status,'approved');
    const rejectedWebhook=await call(`/api/payments/webhook?data.id=${remoteId}&type=order`,{type:'order',data:{id:remoteId}});
    assert.equal(rejectedWebhook.status,401);
    const requestId='request-1'; const ts=String(Date.now()); const sig=createHmac('sha256','test-secret').update(`id:${remoteId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
    assert.equal((await call(`/api/payments/webhook?data.id=${remoteId}&type=order`,{type:'order',data:{id:remoteId}},{'x-signature':`ts=${ts},v1=${sig}`,'x-request-id':requestId})).status,200);
    const partial={...approved,status_detail:'partially_refunded',last_updated_date:new Date(Date.now()+500).toISOString(),transactions:{...approved.transactions,refunds:[{amount:'10.00',status:'processed'}]}};
    await applyPayment(partial,true);
    assert.equal(Number((await pool.query('SELECT payment_refunded_amount FROM orders WHERE id=$1',[order.id])).rows[0].payment_refunded_amount),10);
    const refunded={...approved,status:'refunded',status_detail:'refunded',last_updated_date:new Date(Date.now()+1000).toISOString()};
    await applyPayment(refunded,true);
    assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[order.id])).rows[0].status,'cancelled');
    assert.equal((await pool.query('SELECT stock FROM products WHERE id=$1',[product.id])).rows[0].stock,1);
    await pool.query("INSERT INTO orders(customer_name,total,created_at) VALUES ('Expired',1,NOW()-INTERVAL '4 months')");
    await createRetentionCleanup(pool)();
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders WHERE customer_name='Expired'")).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n,1);
    await t.test('insufficient stock at confirmation is flagged without negative stock',async()=>{
      const key=randomUUID();
      await pool.query("INSERT INTO orders(customer_name,total,source,checkout_key,items) VALUES ('Another',39.8,'mercado_pago',$1,$2::jsonb)",[key,JSON.stringify(order.items)]);
      const legacy={id:'456',external_reference:key,transaction_amount:39.8,currency_id:'BRL',collector_id:99,live_mode:true,status:'approved',date_last_updated:new Date().toISOString()};
      payments.set('456',legacy);
      await applyPayment(legacy);
      const {rows:[flagged]}=await pool.query('SELECT stock_issue,stock_applied,payment_status FROM orders WHERE checkout_key=$1',[key]);
      assert.equal(flagged.stock_issue,true); assert.equal(flagged.stock_applied,false); assert.equal(flagged.payment_status,'approved');
      assert.equal((await pool.query('SELECT stock FROM products WHERE id=$1',[product.id])).rows[0].stock,1);
    });
    await t.test('existing Preferences checkouts retain their URL and their legacy payment lookup',async()=>{
      const key=randomUUID(),legacyToken=randomUUID();
      const {rows:[legacyOrder]}=await pool.query("INSERT INTO orders(customer_name,total,source,checkout_key,public_token,checkout_url,items) VALUES ('Legacy checkout',19.9,'mercado_pago',$1,$2,'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=legacy',$3::jsonb) RETURNING id",[key,legacyToken,JSON.stringify([{product_id:String(product.id),quantity:1}])]);
      const legacy={id:'789',external_reference:key,transaction_amount:19.9,currency_id:'BRL',collector_id:99,live_mode:true,status:'approved',date_last_updated:new Date().toISOString()};
      payments.set('789',legacy);
      const result=await call(`/api/checkout/${legacyToken}/sync`,{});
      assert.equal(result.status,200);assert.equal(result.data.payment_status,'approved');assert.equal(result.data.mp_order_id,null);
      assert.equal((await pool.query('SELECT mp_order_id FROM orders WHERE id=$1',[legacyOrder.id])).rows[0].mp_order_id,null);
      assert.equal(creations,1);
    });
  } finally {
    await new Promise((resolve)=>server.close(resolve));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
