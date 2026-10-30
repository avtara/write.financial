ALTER TABLE "accounts" DROP CONSTRAINT "accounts_default_active_check";--> statement-breakpoint
DROP INDEX "accounts_default_quick_entry_key";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "is_default_quick_entry";