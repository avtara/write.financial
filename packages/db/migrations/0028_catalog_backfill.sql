-- Links records typed by hand before the catalog existed ("BCA", "Netflix", "QQQ") to their catalog entry, the way the
-- repositories now link new ones: only an unambiguous exact name/alias (accounts: of a provider supporting the account
-- type; subscriptions: of a service) or ticker + asset class + price market (assets). Manual names that match nothing
-- stay manual. wf_migrate gets short-lived policies for the one-off update (FORCE RLS applies to the owner too).
CREATE POLICY catalog_backfill_accounts ON accounts FOR ALL TO wf_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY catalog_backfill_subscriptions ON subscriptions FOR ALL TO wf_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY catalog_backfill_assets ON assets FOR ALL TO wf_migrate USING (true) WITH CHECK (true);
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
WHERE a.id = m.id AND m.matches = 1;
--> statement-breakpoint
UPDATE subscriptions AS s SET catalog_id = m.catalog_id
FROM (
  SELECT sub.id, min(rc.id) AS catalog_id, count(*) AS matches
  FROM subscriptions AS sub
  JOIN reference_catalog AS rc
    ON rc.kind = 'service'
   AND (regexp_replace(lower(btrim(rc.name)), '\s+', ' ', 'g') = regexp_replace(lower(btrim(sub.name)), '\s+', ' ', 'g')
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(rc.aliases) AS alias
                   WHERE regexp_replace(lower(btrim(alias)), '\s+', ' ', 'g') = regexp_replace(lower(btrim(sub.name)), '\s+', ' ', 'g')))
  WHERE sub.catalog_id IS NULL
  GROUP BY sub.id
) AS m
WHERE s.id = m.id AND m.matches = 1;
--> statement-breakpoint
UPDATE assets AS a SET catalog_id = m.catalog_id
FROM (
  SELECT asset.id, min(rc.id) AS catalog_id, count(*) AS matches
  FROM assets AS asset
  JOIN reference_catalog AS rc
    ON rc.kind = 'instrument'
   AND rc.symbol = upper(btrim(asset.symbol))
   AND rc.asset_class = asset.asset_class::text
   AND rc.market = asset.market::text
  WHERE asset.catalog_id IS NULL
  GROUP BY asset.id
) AS m
WHERE a.id = m.id AND m.matches = 1;
--> statement-breakpoint
DROP POLICY catalog_backfill_accounts ON accounts;
--> statement-breakpoint
DROP POLICY catalog_backfill_subscriptions ON subscriptions;
--> statement-breakpoint
DROP POLICY catalog_backfill_assets ON assets;
