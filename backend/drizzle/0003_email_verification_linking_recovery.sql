CREATE TYPE "public"."user_token_purpose" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TABLE "oauth_link_attempts" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"code_verifier" text NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_registrations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "user_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_link_attempts" ADD CONSTRAINT "oauth_link_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_link_attempts" ADD CONSTRAINT "oauth_link_attempts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_link_attempts_expires_at_idx" ON "oauth_link_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_registrations_email_lower_unique" ON "pending_registrations" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "pending_registrations_expires_at_idx" ON "pending_registrations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_tokens_user_id_idx" ON "user_tokens" USING btree ("user_id");--> statement-breakpoint
-- Targeted backfill (security requirement): an account that signs in with Google already has an
-- email Google verified. Password-only accounts stay unverified (NULL) until the owner proves the
-- address with a link or a password reset; they are not deleted.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "google_sub" IS NOT NULL;
