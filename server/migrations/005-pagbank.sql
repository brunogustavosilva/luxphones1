BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pagbank_checkout_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_pagbank_checkout_id_idx ON orders (pagbank_checkout_id) WHERE pagbank_checkout_id IS NOT NULL;
COMMIT;