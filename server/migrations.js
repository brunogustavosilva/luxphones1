import { readFile, readdir } from 'node:fs/promises';
export async function migrateSchema(pool) {
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const migrations = new URL('./migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort()) {
    await pool.query(await readFile(new URL(file, migrations), 'utf8'));
  }
}
