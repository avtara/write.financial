-- A transaction has one title ("Judul" = `description`); the separate merchant goes. Before the column is dropped, a
-- merchant becomes the title when the description is blank, repeats the merchant (case and spaces aside), or is only
-- the email subject of a Gmail confirmation (the subject of its evidence, or a known bank notification subject when
-- the evidence is past retention); any other description is the user's title and is kept. Recurrence templates fold
-- their merchant the same way, and stored reports rename the merchant ranking to the title ranking ("titles") and drop
-- the merchant of their largest transactions. These tables force Row-Level Security even for their owner (this
-- migration runs as wf_migrate), so the force is lifted while the rows are converted.
ALTER TABLE transactions NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE review_items NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE email_ingest_logs NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE recurrences NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE reports NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE transactions t SET description = btrim(t.merchant)
WHERE nullif(btrim(t.merchant), '') IS NOT NULL
  AND (
    nullif(btrim(t.description), '') IS NULL
    OR lower(btrim(t.description)) = lower(btrim(t.merchant))
    OR (
      t.source = 'gmail'
      AND (
        btrim(t.description) IN (
          'Credit Card Transaction Notification',
          'Transfer Berhasil',
          'Internet Transaction Journal',
          'Transaksi QRIS Berhasil',
          'Pembayaran Berhasil!',
          'Top-up e-money Berhasil'
        )
        OR EXISTS (
          SELECT 1 FROM review_items r
          JOIN email_ingest_logs l ON l.user_id = r.user_id AND l.review_item_id = r.id
          WHERE r.user_id = t.user_id AND r.resulting_transaction_id = t.id AND btrim(l.subject) = btrim(t.description)
        )
      )
    )
  );--> statement-breakpoint
UPDATE recurrences SET template = (template - 'merchant') || CASE
    WHEN nullif(btrim(template->>'merchant'), '') IS NOT NULL
      AND (
        nullif(btrim(template->>'description'), '') IS NULL
        OR lower(btrim(template->>'description')) = lower(btrim(template->>'merchant'))
      )
    THEN jsonb_build_object('description', btrim(template->>'merchant'))
    ELSE '{}'::jsonb
  END
WHERE template ? 'merchant';--> statement-breakpoint
UPDATE reports SET sections = (sections - 'merchants')
  || jsonb_build_object(
    'titles',
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'title', line->'merchant',
            'totalMinor', line->'totalMinor',
            'count', line->'count',
            'shareBps', line->'shareBps'
          ) ORDER BY position
        )
        FROM jsonb_array_elements(sections->'merchants') WITH ORDINALITY AS lines(line, position)
      ),
      '[]'::jsonb
    ),
    'largest',
    coalesce(
      (
        SELECT jsonb_agg(line - 'merchant' ORDER BY position)
        FROM jsonb_array_elements(sections->'largest') WITH ORDINALITY AS lines(line, position)
      ),
      '[]'::jsonb
    )
  )
WHERE sections ? 'merchants';--> statement-breakpoint
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE review_items FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE email_ingest_logs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE recurrences FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE reports FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "transactions_merchant_trgm_idx";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "merchant";
