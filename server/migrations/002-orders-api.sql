BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mp_order_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (payment_refunded_amount >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS orders_mp_order_id_idx ON orders (mp_order_id) WHERE mp_order_id IS NOT NULL;
COMMIT;
