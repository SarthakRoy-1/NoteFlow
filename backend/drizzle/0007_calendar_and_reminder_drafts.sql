CREATE TABLE "google_calendar_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scope" text NOT NULL,
	"google_email" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_note_id" uuid NOT NULL,
	"content" text NOT NULL,
	"person" text,
	"suggested_date" text,
	"recurrence_days" smallint[],
	"ai_fingerprint" text NOT NULL,
	"ai_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_drafts_note_fingerprint_key" UNIQUE("source_note_id","ai_fingerprint")
);
--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "google_event_id" text;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "calendar_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_drafts" ADD CONSTRAINT "reminder_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_drafts" ADD CONSTRAINT "reminder_drafts_source_note_owner_fk" FOREIGN KEY ("source_note_id","user_id") REFERENCES "public"."notes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminder_drafts_user_idx" ON "reminder_drafts" USING btree ("user_id");