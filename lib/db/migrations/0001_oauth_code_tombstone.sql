ALTER TABLE "oauth_codes" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD COLUMN "grant_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE set null ON UPDATE no action;