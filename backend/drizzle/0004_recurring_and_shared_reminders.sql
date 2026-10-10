CREATE TABLE "reminder_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reminder_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "reminder_shares_reminder_recipient_key" UNIQUE("reminder_id","recipient_id"),
	CONSTRAINT "reminder_shares_not_self" CHECK ("reminder_shares"."owner_id" <> "reminder_shares"."recipient_id")
);
--> statement-breakpoint
ALTER TABLE "ai_dismissed" ADD COLUMN "item_text" text;--> statement-breakpoint
ALTER TABLE "ai_dismissed" ADD COLUMN "person" text;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "recurrence_days" smallint[];--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "recurrence_time" text;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_id_user_id_key" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "reminder_shares" ADD CONSTRAINT "reminder_shares_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_shares" ADD CONSTRAINT "reminder_shares_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_shares" ADD CONSTRAINT "reminder_shares_reminder_owner_fk" FOREIGN KEY ("reminder_id","owner_id") REFERENCES "public"."reminders"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminder_shares_recipient_idx" ON "reminder_shares" USING btree ("recipient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_recurrence_days_check" CHECK ("reminders"."recurrence_days" is null or (cardinality("reminders"."recurrence_days") between 1 and 7 and "reminders"."recurrence_days" <@ array[1,2,3,4,5,6,7]::smallint[]));--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_recurrence_time_check" CHECK ("reminders"."recurrence_time" is null or ("reminders"."recurrence_days" is not null and "reminders"."recurrence_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));