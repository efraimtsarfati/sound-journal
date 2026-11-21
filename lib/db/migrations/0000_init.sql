CREATE TABLE "artist_genres" (
	"artist_id" uuid NOT NULL,
	"genre" text NOT NULL,
	"source" text NOT NULL,
	"weight" real,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_genres_pk" PRIMARY KEY("artist_id","source","genre")
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"mbid" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artists_mbid_unique" UNIQUE("mbid")
);
--> statement-breakpoint
CREATE TABLE "auth_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"fails" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "auth_attempts_fails_check" CHECK ("auth_attempts"."fails" >= 0)
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'song' NOT NULL,
	"title" text NOT NULL,
	"album" text,
	"original_release_year" integer,
	"duration_sec" integer,
	"mbid" uuid,
	"mbid_candidate" uuid,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"deleted_at" timestamp with time zone,
	"origin" text DEFAULT 'saved' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "entries_kind_check" CHECK ("entries"."kind" IN ('song', 'film', 'book', 'other')),
	CONSTRAINT "entries_duration_check" CHECK ("entries"."duration_sec" IS NULL OR "entries"."duration_sec" > 0),
	CONSTRAINT "entries_match_status_check" CHECK ("entries"."match_status" IN ('unmatched', 'matched', 'confirmed')),
	CONSTRAINT "entries_match_mbid_check" CHECK ("entries"."match_status" = 'unmatched' OR "entries"."mbid" IS NOT NULL),
	CONSTRAINT "entries_origin_check" CHECK ("entries"."origin" IN ('saved', 'suggested')),
	CONSTRAINT "entries_visibility_check" CHECK ("entries"."visibility" = 'private'),
	CONSTRAINT "entries_schema_version_check" CHECK ("entries"."schema_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "entry_artists" (
	"entry_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"role" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "entry_artists_pk" PRIMARY KEY("entry_id","artist_id","role"),
	CONSTRAINT "entry_artists_role_check" CHECK ("entry_artists"."role" IN ('primary', 'featured')),
	CONSTRAINT "entry_artists_position_check" CHECK ("entry_artists"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "entry_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"type" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"raw_title" text,
	"raw_author" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_sources_entry_type_external_unique" UNIQUE("entry_id","type","external_id"),
	CONSTRAINT "entry_sources_type_check" CHECK ("entry_sources"."type" IN ('youtube', 'spotify', 'film', 'book', 'url'))
);
--> statement-breakpoint
CREATE TABLE "highlight_tags" (
	"highlight_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text DEFAULT 'agent' NOT NULL,
	"agent_name" text,
	CONSTRAINT "highlight_tags_pk" PRIMARY KEY("highlight_id","tag_id"),
	CONSTRAINT "highlight_tags_added_by_check" CHECK ("highlight_tags"."added_by" IN ('agent', 'user'))
);
--> statement-breakpoint
CREATE TABLE "highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"start_sec" integer,
	"end_sec" integer,
	"note" text,
	"status" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note_updated_at" timestamp with time zone,
	"search_dirty" boolean DEFAULT true NOT NULL,
	"search_synced_at" timestamp with time zone,
	"visibility" text DEFAULT 'private' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "highlights_start_sec_check" CHECK ("highlights"."start_sec" IS NULL OR "highlights"."start_sec" >= 0),
	CONSTRAINT "highlights_end_sec_check" CHECK ("highlights"."end_sec" IS NULL OR ("highlights"."start_sec" IS NOT NULL AND "highlights"."end_sec" > "highlights"."start_sec")),
	CONSTRAINT "highlights_status_check" CHECK ("highlights"."status" IN ('needs_why', 'needs_tags', 'tagged')),
	CONSTRAINT "highlights_status_note_check" CHECK (("highlights"."status" = 'needs_why') = ("highlights"."note" IS NULL)),
	CONSTRAINT "highlights_note_not_blank_check" CHECK ("highlights"."note" IS NULL OR "highlights"."note" ~ '[^[:space:]]'),
	CONSTRAINT "highlights_visibility_check" CHECK ("highlights"."visibility" = 'private')
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"code_challenge" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "oauth_tokens_kind_check" CHECK ("oauth_tokens"."kind" IN ('access', 'refresh'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"mcp_enabled" boolean DEFAULT true NOT NULL,
	"mcp_allow_changes" boolean DEFAULT true NOT NULL,
	"mcp_allow_deletes" boolean DEFAULT false NOT NULL,
	"time_zone" text DEFAULT 'America/Toronto' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"axis" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"merged_into" uuid,
	"description" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	CONSTRAINT "tags_user_axis_slug_unique" UNIQUE("user_id","axis","slug"),
	CONSTRAINT "tags_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "tags_state_check" CHECK ("tags"."state" IN ('proposed', 'approved', 'rejected', 'merged')),
	CONSTRAINT "tags_merged_state_check" CHECK (("tags"."state" = 'merged') = ("tags"."merged_into" IS NOT NULL)),
	CONSTRAINT "tags_merged_not_self_check" CHECK ("tags"."merged_into" <> "tags"."id"),
	CONSTRAINT "tags_created_by_check" CHECK ("tags"."created_by" IN ('agent', 'user'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artist_genres" ADD CONSTRAINT "artist_genres_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_artists" ADD CONSTRAINT "entry_artists_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_artists" ADD CONSTRAINT "entry_artists_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_sources" ADD CONSTRAINT "entry_sources_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlight_tags" ADD CONSTRAINT "highlight_tags_highlight_id_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlight_tags" ADD CONSTRAINT "highlight_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_entry_user_fk" FOREIGN KEY ("entry_id","user_id") REFERENCES "public"."entries"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_merged_into_fk" FOREIGN KEY ("merged_into","user_id") REFERENCES "public"."tags"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artists_name_normalized_idx" ON "artists" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "entries_user_created_live_idx" ON "entries" USING btree ("user_id","created_at") WHERE "entries"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "entries_deleted_at_idx" ON "entries" USING btree ("deleted_at") WHERE "entries"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "entry_artists_artist_idx" ON "entry_artists" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "entry_sources_type_external_idx" ON "entry_sources" USING btree ("type","external_id");--> statement-breakpoint
CREATE INDEX "highlight_tags_tag_idx" ON "highlight_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "highlights_entry_idx" ON "highlights" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "highlights_user_status_live_idx" ON "highlights" USING btree ("user_id","status") WHERE "highlights"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "highlights_user_captured_live_idx" ON "highlights" USING btree ("user_id","captured_at") WHERE "highlights"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "highlights_user_search_dirty_idx" ON "highlights" USING btree ("user_id") WHERE "highlights"."search_dirty";--> statement-breakpoint
CREATE INDEX "highlights_deleted_at_idx" ON "highlights" USING btree ("deleted_at") WHERE "highlights"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "oauth_codes_expires_at_idx" ON "oauth_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_grants_user_idx" ON "oauth_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_client_idx" ON "oauth_grants" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_grant_idx" ON "oauth_tokens" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_expires_at_idx" ON "oauth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "tags_user_state_idx" ON "tags" USING btree ("user_id","state");--> statement-breakpoint
INSERT INTO "users" ("id", "display_name") VALUES ('00000000-0000-4000-8000-000000000001', 'Owner') ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "settings" ("user_id") VALUES ('00000000-0000-4000-8000-000000000001') ON CONFLICT ("user_id") DO NOTHING;
