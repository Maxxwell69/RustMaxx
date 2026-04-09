-- Single vs quantity streamer item gives; cap for quantity-mode grants.

ALTER TABLE streamer_platform_items
  ADD COLUMN IF NOT EXISTS give_mode text NOT NULL DEFAULT 'quantity';

ALTER TABLE streamer_platform_items
  DROP CONSTRAINT IF EXISTS streamer_platform_items_give_mode_check;

ALTER TABLE streamer_platform_items
  ADD CONSTRAINT streamer_platform_items_give_mode_check
  CHECK (give_mode IN ('single', 'quantity'));

ALTER TABLE streamer_platform_items
  ADD COLUMN IF NOT EXISTS max_amount int;

UPDATE streamer_platform_items
SET max_amount = GREATEST(default_amount, 1)
WHERE max_amount IS NULL;

ALTER TABLE streamer_platform_items
  ALTER COLUMN max_amount SET NOT NULL;

ALTER TABLE streamer_platform_items
  ALTER COLUMN max_amount SET DEFAULT 1;

ALTER TABLE streamer_platform_items
  DROP CONSTRAINT IF EXISTS streamer_platform_items_max_amount_check;

ALTER TABLE streamer_platform_items
  ADD CONSTRAINT streamer_platform_items_max_amount_check
  CHECK (max_amount >= 1 AND max_amount <= 999999);

COMMENT ON COLUMN streamer_platform_items.give_mode IS 'single = one-off spawn or single inventory unit; quantity = stackable give between default_amount and max_amount (within stack cap).';
COMMENT ON COLUMN streamer_platform_items.max_amount IS 'Upper bound for quantity-mode gives; typically <= Rust stack size.';
