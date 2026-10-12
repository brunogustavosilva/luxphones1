// Calendar months, using the store's time zone even if PostgreSQL uses UTC.
export const retentionCutoff = "((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '3 months') AT TIME ZONE 'America/Sao_Paulo'";
const cleanupInterval = 60 * 60 * 1000;

// Run on demand so an idle application does not wake the database every hour.
export function createRetentionCleanup(pool, now = Date.now) {
  let lastCleanup = null;
  let running = null;
  return function cleanup() {
    if (running) return running;
    if (lastCleanup !== null && now() - lastCleanup < cleanupInterval) return Promise.resolve();
    running = (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT pg_try_advisory_xact_lock(741309) AS acquired');
        if (rows[0].acquired) {
          // A single transaction gives both tables the same expiration boundary.
          await client.query(`DELETE FROM orders WHERE created_at < ${retentionCutoff}`);
          await client.query(`DELETE FROM repairs WHERE created_at < ${retentionCutoff}`);
        }
        await client.query('COMMIT');
        if (rows[0].acquired) lastCleanup = now();
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })().finally(() => { running = null; });
    return running;
  };
}
