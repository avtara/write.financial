ALTER TYPE "public"."security_event_type" ADD VALUE 'sign_in_failed' BEFORE 'sign_out';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'account_locked' BEFORE 'sign_out';