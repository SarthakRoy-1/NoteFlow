ALTER TABLE "users" ALTER COLUMN "google_sub" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_method_check" CHECK ("users"."google_sub" is not null or "users"."password_hash" is not null);