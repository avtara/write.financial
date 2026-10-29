CREATE TABLE "reference_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"aliases" jsonb NOT NULL,
	"account_types" jsonb NOT NULL,
	"symbol" text,
	"venue" text,
	"currency" char(3),
	"asset_class" text,
	"market" text,
	"logo_path" text,
	"source_url" text NOT NULL,
	"data_license" text NOT NULL,
	"logo_source_url" text,
	"logo_license" text,
	CONSTRAINT "reference_catalog_kind_check" CHECK ("reference_catalog"."kind" in ('provider', 'instrument', 'service'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "catalog_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "catalog_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "catalog_id" text;--> statement-breakpoint
CREATE INDEX "reference_catalog_kind_name_idx" ON "reference_catalog" USING btree ("kind","name");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_catalog_id_reference_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."reference_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_catalog_id_reference_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."reference_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_catalog_id_reference_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."reference_catalog"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Versioned factual curation and locally bundled logo provenance (see TRADEMARK.md).
INSERT INTO reference_catalog (id, kind, name, aliases, account_types, symbol, venue, currency, asset_class, market, logo_path, source_url, data_license, logo_source_url, logo_license) VALUES
('provider:bca', 'provider', 'BCA', '["Bank Central Asia", "Bank BCA", "myBCA"]'::jsonb, '["bank", "credit_card"]'::jsonb, NULL, NULL, NULL, NULL, NULL, '/catalog-logos/bca.svg', 'https://www.bca.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', 'https://commons.wikimedia.org/wiki/File:Bank_Central_Asia.svg', 'Public domain (PD-textlogo); trademark rights reserved'),
('provider:mandiri', 'provider', 'Bank Mandiri', '["Mandiri", "Livin"]'::jsonb, '["bank", "credit_card"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.bankmandiri.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:bri', 'provider', 'BRI', '["Bank Rakyat Indonesia", "BRImo"]'::jsonb, '["bank", "credit_card"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://bri.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:bni', 'provider', 'BNI', '["Bank Negara Indonesia", "wondr"]'::jsonb, '["bank", "credit_card"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.bni.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:bsi', 'provider', 'Bank Syariah Indonesia', '["BSI", "BYOND"]'::jsonb, '["bank"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.bankbsi.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:cimb-niaga', 'provider', 'CIMB Niaga', '["CIMB", "OCTO"]'::jsonb, '["bank", "credit_card"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.cimbniaga.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:jago', 'provider', 'Bank Jago', '["Jago"]'::jsonb, '["bank"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.jago.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:jenius', 'provider', 'Jenius', '["SMBC Indonesia", "BTPN"]'::jsonb, '["bank", "credit_card"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.jenius.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:seabank', 'provider', 'SeaBank', '["Sea Bank"]'::jsonb, '["bank"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.seabank.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:gopay', 'provider', 'GoPay', '["Go Pay", "Gojek"]'::jsonb, '["ewallet"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://gopay.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:ovo', 'provider', 'OVO', '["Grab OVO"]'::jsonb, '["ewallet"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.ovo.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:dana', 'provider', 'DANA', '["Dompet Digital Indonesia"]'::jsonb, '["ewallet"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.dana.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:shopeepay', 'provider', 'ShopeePay', '["Shopee Pay"]'::jsonb, '["ewallet"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://shopeepay.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:linkaja', 'provider', 'LinkAja', '["Link Aja", "TCASH"]'::jsonb, '["ewallet"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.linkaja.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:stockbit', 'provider', 'Stockbit', '["Stockbit Sekuritas"]'::jsonb, '["investment"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://stockbit.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:ajaib', 'provider', 'Ajaib', '["Ajaib Sekuritas"]'::jsonb, '["investment"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://ajaib.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:ipot', 'provider', 'IPOT', '["Indo Premier", "Indopremier"]'::jsonb, '["investment"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.indopremier.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:bibit', 'provider', 'Bibit', '["Bibit investasi"]'::jsonb, '["investment"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://bibit.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:ibkr', 'provider', 'Interactive Brokers', '["IBKR"]'::jsonb, '["investment"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.interactivebrokers.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:schwab', 'provider', 'Charles Schwab', '["Schwab"]'::jsonb, '["investment"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.schwab.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:chase', 'provider', 'Chase', '["JPMorgan Chase", "JP Morgan"]'::jsonb, '["bank", "credit_card"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.chase.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:hsbc', 'provider', 'HSBC', '["Hongkong Shanghai Banking"]'::jsonb, '["bank", "credit_card"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.hsbc.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:dbs', 'provider', 'DBS', '["digibank"]'::jsonb, '["bank", "credit_card"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.dbs.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('provider:wise', 'provider', 'Wise', '["TransferWise"]'::jsonb, '["bank"]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://wise.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('stock:xidx:bbca', 'instrument', 'Bank Central Asia', '["BCA", "PT Bank Central Asia Tbk"]'::jsonb, '[]'::jsonb, 'BBCA', 'XIDX', 'IDR', 'indonesia', 'idx_equity', '/catalog-logos/bca.svg', 'https://www.bca.co.id/en/tentang-bca/Hubungan-Investor', 'AGPL-3.0-only (original factual curation; not source website content)', 'https://commons.wikimedia.org/wiki/File:Bank_Central_Asia.svg', 'Public domain (PD-textlogo); trademark rights reserved'),
('stock:xidx:bbri', 'instrument', 'Bank Rakyat Indonesia', '["BRI"]'::jsonb, '[]'::jsonb, 'BBRI', 'XIDX', 'IDR', 'indonesia', 'idx_equity', NULL, 'https://www.ir-bri.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('stock:xidx:bmri', 'instrument', 'Bank Mandiri', '["Mandiri"]'::jsonb, '[]'::jsonb, 'BMRI', 'XIDX', 'IDR', 'indonesia', 'idx_equity', NULL, 'https://www.bankmandiri.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('stock:xidx:bbni', 'instrument', 'Bank Negara Indonesia', '["BNI"]'::jsonb, '[]'::jsonb, 'BBNI', 'XIDX', 'IDR', 'indonesia', 'idx_equity', NULL, 'https://www.bni.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('stock:xidx:tlkm', 'instrument', 'Telkom Indonesia', '["Telkom"]'::jsonb, '[]'::jsonb, 'TLKM', 'XIDX', 'IDR', 'indonesia', 'idx_equity', NULL, 'https://www.telkom.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('stock:xidx:asii', 'instrument', 'Astra International', '["Astra"]'::jsonb, '[]'::jsonb, 'ASII', 'XIDX', 'IDR', 'indonesia', 'idx_equity', NULL, 'https://www.astra.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('stock:xnas:aapl', 'instrument', 'Apple', '["Apple Inc"]'::jsonb, '[]'::jsonb, 'AAPL', 'XNAS', 'USD', 'us_stocks', 'us_equity', NULL, 'https://investor.apple.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('stock:xnas:msft', 'instrument', 'Microsoft', '["Microsoft Corporation"]'::jsonb, '[]'::jsonb, 'MSFT', 'XNAS', 'USD', 'us_stocks', 'us_equity', NULL, 'https://www.microsoft.com/en-us/Investor/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('stock:xnas:googl', 'instrument', 'Alphabet Class A', '["Google", "Alphabet"]'::jsonb, '[]'::jsonb, 'GOOGL', 'XNAS', 'USD', 'us_stocks', 'us_equity', NULL, 'https://abc.xyz/investor/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('stock:xnas:nvda', 'instrument', 'NVIDIA', '["Nvidia Corporation"]'::jsonb, '[]'::jsonb, 'NVDA', 'XNAS', 'USD', 'us_stocks', 'us_equity', NULL, 'https://investor.nvidia.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('stock:xnys:jpm', 'instrument', 'JPMorgan Chase', '["JP Morgan", "Chase"]'::jsonb, '[]'::jsonb, 'JPM', 'XNYS', 'USD', 'us_stocks', 'us_equity', NULL, 'https://www.jpmorganchase.com/ir', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('stock:xnys:tlk', 'instrument', 'Telkom Indonesia ADR', '["Telkom", "American Depositary Shares"]'::jsonb, '[]'::jsonb, 'TLK', 'XNYS', 'USD', 'us_stocks', 'us_equity', NULL, 'https://www.telkom.co.id/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('service:netflix', 'service', 'Netflix', '["Netflix Indonesia"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, '/catalog-logos/netflix.svg', 'https://www.netflix.com/', 'AGPL-3.0-only (original factual curation; not source website content)', 'https://commons.wikimedia.org/wiki/File:Netflix_2015_logo.svg', 'Public domain (PD-textlogo); trademark rights reserved'),
('service:youtube-premium', 'service', 'YouTube Premium', '["YouTube", "YT Premium", "YouTube Music"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, '/catalog-logos/youtube.svg', 'https://www.youtube.com/premium', 'AGPL-3.0-only (original factual curation; not source website content)', 'https://commons.wikimedia.org/wiki/File:YouTube_full-color_icon_(2024).svg', 'Public domain (PD-textlogo); trademark rights reserved'),
('service:spotify', 'service', 'Spotify', '["Spotify Premium", "musik", "music"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, '/catalog-logos/spotify.svg', 'https://www.spotify.com/', 'AGPL-3.0-only (original factual curation; not source website content)', 'https://commons.wikimedia.org/wiki/File:Spotify_logo_without_text.svg', 'Public domain (PD-textlogo); trademark rights reserved'),
('service:disney-plus', 'service', 'Disney+', '["Disney Plus", "Disney Hotstar", "Disney+ Hotstar"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.disneyplus.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('service:vidio', 'service', 'Vidio', '["Vidio Premier"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.vidio.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('service:viu', 'service', 'Viu', '["Viu Premium"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.viu.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('service:apple-music', 'service', 'Apple Music', '["Apple musik"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.apple.com/apple-music/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('service:icloud', 'service', 'iCloud+', '["iCloud", "Apple iCloud"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.apple.com/icloud/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('service:google-one', 'service', 'Google One', '["Google Drive", "Google storage"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://one.google.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('service:microsoft-365', 'service', 'Microsoft 365', '["Office 365", "Microsoft Office"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.microsoft.com/microsoft-365', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('service:canva', 'service', 'Canva', '["Canva Pro"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.canva.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('service:notion', 'service', 'Notion', '["Notion Plus"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.notion.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL),
('service:prime-video', 'service', 'Prime Video', '["Amazon Prime", "Amazon Video"]'::jsonb, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, NULL, 'https://www.primevideo.com/', 'AGPL-3.0-only (original factual curation; not source website content)', NULL, NULL);
--> statement-breakpoint
-- Reference data is public but immutable to application and worker roles.
ALTER TABLE reference_catalog ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reference_catalog FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reference_catalog_read ON reference_catalog FOR SELECT TO wf_app, wf_worker USING (true);
--> statement-breakpoint
CREATE POLICY reference_catalog_migrate ON reference_catalog FOR ALL TO wf_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON reference_catalog TO wf_app, wf_worker;
