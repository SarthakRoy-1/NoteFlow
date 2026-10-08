CREATE TYPE "public"."analysis_status" AS ENUM('pending', 'ok', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ask_status" AS ENUM('answered', 'no_info', 'failed');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('todo', 'reminder');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('pending', 'acknowledged', 'dismissed');--> statement-breakpoint
CREATE TABLE "ai_dismissed" (
	"source_note_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "item_kind" NOT NULL,
	"ai_fingerprint" text NOT NULL,
	CONSTRAINT "ai_dismissed_source_note_id_kind_ai_fingerprint_pk" PRIMARY KEY("source_note_id","kind","ai_fingerprint")
);
--> statement-breakpoint
CREATE TABLE "ask_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"status" "ask_status" DEFAULT 'answered' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ask_history_sources" (
	"ask_id" uuid NOT NULL,
	"note_id" uuid,
	"note_title_snapshot" text NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "ask_history_sources_ask_id_rank_pk" PRIMARY KEY("ask_id","rank")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"analysis_status" "analysis_status" DEFAULT 'pending' NOT NULL,
	"analysis_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_id_user_id_key" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_note_id" uuid NOT NULL,
	"content" text NOT NULL,
	"person" text,
	"due_at" timestamp with time zone,
	"status" "reminder_status" DEFAULT 'pending' NOT NULL,
	"alerted_at" timestamp with time zone,
	"created_by_ai" boolean DEFAULT false NOT NULL,
	"ai_fingerprint" text,
	"user_modified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_note_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"due_has_time" boolean DEFAULT false NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by_ai" boolean DEFAULT false NOT NULL,
	"ai_fingerprint" text,
	"user_modified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
ALTER TABLE "ai_dismissed" ADD CONSTRAINT "ai_dismissed_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_dismissed" ADD CONSTRAINT "ai_dismissed_source_note_owner_fk" FOREIGN KEY ("source_note_id","user_id") REFERENCES "public"."notes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_history" ADD CONSTRAINT "ask_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_history_sources" ADD CONSTRAINT "ask_history_sources_ask_id_ask_history_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."ask_history"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_history_sources" ADD CONSTRAINT "ask_history_sources_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_source_note_owner_fk" FOREIGN KEY ("source_note_id","user_id") REFERENCES "public"."notes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_source_note_owner_fk" FOREIGN KEY ("source_note_id","user_id") REFERENCES "public"."notes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_history_user_created_idx" ON "ask_history" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notes_user_updated_idx" ON "notes" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notes_search_idx" ON "notes" USING gin (to_tsvector('english', "title" || ' ' || "content"));--> statement-breakpoint
CREATE INDEX "reminders_user_due_idx" ON "reminders" USING btree ("user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "reminders_source_note_idx" ON "reminders" USING btree ("source_note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_note_fingerprint_key" ON "reminders" USING btree ("source_note_id","ai_fingerprint") WHERE "reminders"."ai_fingerprint" is not null;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "todos_user_status_idx" ON "todos" USING btree ("user_id","completed","due_at");--> statement-breakpoint
CREATE INDEX "todos_source_note_idx" ON "todos" USING btree ("source_note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "todos_note_fingerprint_key" ON "todos" USING btree ("source_note_id","ai_fingerprint") WHERE "todos"."ai_fingerprint" is not null;