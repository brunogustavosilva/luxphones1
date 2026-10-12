import dotenv from 'dotenv';
import pg from 'pg';
import { migrateSchema } from './migrations.js';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });
const raw = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!raw) throw new Error('DATABASE_URL não definida.');
const url = new URL(raw);
// Migrations use the direct endpoint, while normal API traffic remains pooled.
url.hostname = url.hostname.replace('-pooler.', '.');
const pool = new pg.Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 15000 });
try { await migrateSchema(pool); console.log('Migração do catálogo e dos pedidos concluída.'); }
catch (error) { console.error('Falha na migração:', error.code || error.name); process.exitCode = 1; }
finally { await pool.end(); }
