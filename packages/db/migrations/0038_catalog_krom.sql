-- Krom (PT Krom Bank Indonesia Tbk) as a bank provider with its brand-published icon (see TRADEMARK.md), and the
-- accounts already typed as "Krom" linked to it the way 0028 linked earlier hand-typed names: only an unambiguous exact
-- name/alias of a provider supporting the account type. wf_migrate gets a short-lived policy for the one-off update
-- (FORCE RLS applies to the owner too).
INSERT INTO reference_catalog (id, kind, name, aliases, account_types, symbol, venue, currency, asset_class, market, logo_path, source_url, data_license, logo_source_url, logo_license) VALUES
('provider:krom', 'provider', 'Krom', '["Krom Bank", "Bank Krom", "Krom Bank Indonesia"]'::jsonb, '["bank"]'::jsonb, NULL, NULL, NULL, NULL, NULL, '/catalog-logos/krom.png', 'https://krom.id/', 'AGPL-3.0-only (original factual curation; not source website content)', 'https://krom.id/wp-content/uploads/2022/08/cropped-ic_krom_logo.png', 'Brand-published icon, used only to identify the user''s own account; trademark rights reserved by the owner')
ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, aliases = EXCLUDED.aliases, account_types = EXCLUDED.account_types, symbol = EXCLUDED.symbol, venue = EXCLUDED.venue, currency = EXCLUDED.currency, asset_class = EXCLUDED.asset_class, market = EXCLUDED.market, logo_path = EXCLUDED.logo_path, source_url = EXCLUDED.source_url, data_license = EXCLUDED.data_license, logo_source_url = EXCLUDED.logo_source_url, logo_license = EXCLUDED.logo_license;
--> statement-breakpoint
CREATE POLICY catalog_krom_accounts ON accounts FOR ALL TO wf_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
UPDATE accounts AS a SET catalog_id = m.catalog_id
FROM (
  SELECT acc.id, min(rc.id) AS catalog_id, count(*) AS matches
  FROM accounts AS acc
  JOIN reference_catalog AS rc
    ON rc.kind = 'provider'
   AND rc.account_types ? acc.type::text
   AND (regexp_replace(lower(btrim(rc.name)), '\s+', ' ', 'g') = regexp_replace(lower(btrim(acc.provider_name)), '\s+', ' ', 'g')
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(rc.aliases) AS alias
                   WHERE regexp_replace(lower(btrim(alias)), '\s+', ' ', 'g') = regexp_replace(lower(btrim(acc.provider_name)), '\s+', ' ', 'g')))
  WHERE acc.catalog_id IS NULL
  GROUP BY acc.id
) AS m
WHERE a.id = m.id AND m.matches = 1 AND m.catalog_id = 'provider:krom';
--> statement-breakpoint
DROP POLICY catalog_krom_accounts ON accounts;
