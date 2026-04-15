-- Add combo pricing package kind and seed a default combo bundle.

ALTER TABLE pricing_packages
  DROP CONSTRAINT IF EXISTS pricing_packages_package_kind_check;

ALTER TABLE pricing_packages
  ADD CONSTRAINT pricing_packages_package_kind_check
  CHECK (package_kind IN ('server', 'streamer', 'combo'));

ALTER TABLE pricing_packages
  DROP CONSTRAINT IF EXISTS pricing_packages_tier_valid;

ALTER TABLE pricing_packages
  ADD CONSTRAINT pricing_packages_tier_valid CHECK (
    (package_kind = 'server' AND tier_key IN ('free', 'pro', 'analytics'))
    OR (package_kind = 'streamer' AND tier_key IN ('free', 'plus', 'max'))
    OR (package_kind = 'combo' AND tier_key IN ('bundle'))
  );

INSERT INTO pricing_packages (
  package_kind, tier_key, name, price_display, price_usd, period_display, billing_note, features, is_highlighted, sort_order
) VALUES (
  'combo', 'bundle', 'Combo Bundle', '$34.99', 34.99, '/mo', 'Server + streamer',
  '["Server Pro tier included", "Streamer Plus tier included", "One subscription for both sides"]'::jsonb, true, 10
)
ON CONFLICT (package_kind, tier_key) DO NOTHING;
