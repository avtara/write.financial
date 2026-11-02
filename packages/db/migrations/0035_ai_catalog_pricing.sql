-- AI prices come only from the provider catalog, stored when the settings are saved. Connections that kept manual
-- prices fall back to catalog pricing with no prices yet, so paid requests stay refused until the model is saved (or
-- tested) again and its catalog prices are stored. AI connections force Row-Level Security even for their owner (this
-- migration runs as wf_migrate), so the force is lifted while the rows are converted.
ALTER TABLE ai_connections NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE ai_connections SET pricing_source = 'catalog', pricing = NULL WHERE pricing_source = 'manual';--> statement-breakpoint
ALTER TABLE ai_connections FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_connections" DROP CONSTRAINT "ai_connections_pricing_check";--> statement-breakpoint
ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_pricing_check" CHECK ("ai_connections"."pricing_source" in ('catalog'));
