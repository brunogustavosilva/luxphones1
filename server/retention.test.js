import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetentionCleanup } from './retention.js';

function database({ failOnce = false, acquired = true } = {}) {
  const queries = [];
  let releases = 0;
  let connections = 0;
  const pool = {
    async connect() {
      connections++;
      return {
        async query(sql) {
          queries.push(sql);
          if (failOnce && sql.startsWith('DELETE FROM repairs')) {
            failOnce = false;
            throw new Error('Database unavailable');
          }
          return { rows: [{ acquired }] };
        },
        release() { releases++; },
      };
    },
  };
  return { pool, queries, get releases() { return releases; }, get connections() { return connections; } };
}

test('concurrent requests share one cleanup and idle time schedules no queries', async () => {
  const db = database();
  let now = 0;
  const cleanup = createRetentionCleanup(db.pool, () => now);
  await Promise.all([cleanup(), cleanup(), cleanup()]);
  assert.equal(db.connections, 1);
  assert.equal(db.releases, 1);
  assert.equal(db.queries.at(-1), 'COMMIT');
  const deletions = db.queries.filter((sql) => sql.startsWith('DELETE'));
  assert.equal(deletions.length, 2);
  for (const sql of deletions) {
    assert.match(sql, /created_at </);
    assert.match(sql, /INTERVAL '3 months'/);
    assert.match(sql, /America\/Sao_Paulo/);
    assert.doesNotMatch(sql, /products|admin_users|updated_at|status/);
  }
  now = 3599999;
  await cleanup();
  assert.equal(db.connections, 1);
  now = 3600000;
  assert.equal(db.connections, 1);
  await cleanup();
  assert.equal(db.connections, 2);
});

test('failure rolls back both deletions, releases connection, and retries immediately', async () => {
  const db = database({ failOnce: true });
  const cleanup = createRetentionCleanup(db.pool, () => 0);
  await assert.rejects(cleanup(), /Database unavailable/);
  assert.equal(db.queries.at(-1), 'ROLLBACK');
  assert.equal(db.releases, 1);
  await cleanup();
  assert.equal(db.connections, 2);
  assert.equal(db.queries.at(-1), 'COMMIT');
  assert.equal(db.releases, 2);
});

test('another server holding the cleanup lock prevents competing deletions', async () => {
  const db = database({ acquired: false });
  const cleanup = createRetentionCleanup(db.pool, () => 0);
  await cleanup();
  assert.equal(db.queries.some((sql) => sql.startsWith('DELETE')), false);
  assert.equal(db.queries.at(-1), 'COMMIT');
  await cleanup();
  assert.equal(db.connections, 2);
});
