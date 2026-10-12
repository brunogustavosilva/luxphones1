import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { migrateSchema } from './migrations.js';

const { Pool } = pg;
dotenv.config({ path: '.env.local' });
dotenv.config();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL não definido. Configure o banco Neon em .env.local.');

export const pool = new Pool({
  connectionString,
  max: process.env.VERCEL ? 3 : 8,
  allowExitOnIdle: Boolean(process.env.VERCEL),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: connectionString.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
});

const fixtures = [
  ['iPhone 16 Pro', 'APL-16P', 'Apple', 7899, 8, 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&w=900&q=85', 'Tela Super Retina XDR de 6,3 polegadas, chip A18 Pro e sistema de câmeras avançado. Produto novo, lacrado e com garantia Apple.'],
  ['Galaxy S25 Ultra', 'SAM-S25U', 'Samsung', 7299, 5, 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=900&q=85', 'Smartphone premium com tela ampla, S Pen integrada e recursos Galaxy AI. Produto novo, lacrado e com garantia de fábrica.'],
  ['iPhone 15', 'APL-15', 'Apple', 4599, 12, 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?auto=format&fit=crop&w=900&q=85', 'Tela Super Retina XDR de 6,1 polegadas, câmera principal de 48 MP e conexão USB-C. Aparelho revisado e pronto para uso.'],
  ['Pixel 9 Pro', 'GOO-P9P', 'Google', 6199, 4, 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=900&q=85', 'Câmeras Pixel com processamento inteligente, tela LTPO OLED e recursos de IA do Google. Aparelho desbloqueado e revisado.'],
];

export async function initializeDatabase() {
  await migrateSchema(pool);

  const username = (process.env.ADMIN_USERNAME || 'lucasphone2026').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'lucasphone2026';
  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING',
    [username, passwordHash],
  );

  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM products');
  if (rows[0].count === 0) {
    for (const product of fixtures) {
      await pool.query(
        'INSERT INTO products (name, sku, category, price, stock, image_url, description) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (sku) DO NOTHING',
        product,
      );
    }
  }
}
