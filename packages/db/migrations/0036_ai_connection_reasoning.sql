-- The chosen model's catalog reasoning mode, stored on save like its prices: `optional` reasoning is switched off in
-- every request. Models with mandatory reasoning are refused on save, so they are never stored. Existing connections
-- default to 'none' (nothing is sent) until the model is saved again and its real mode is stored. Adding a column with
-- a default rewrites no rows by hand, so Row-Level Security needs no change here.
ALTER TABLE "ai_connections" ADD COLUMN "reasoning" varchar(8) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_reasoning_check" CHECK ("ai_connections"."reasoning" in ('none','optional'));
