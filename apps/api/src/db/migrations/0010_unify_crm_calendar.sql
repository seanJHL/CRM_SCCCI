ALTER TABLE "events" ADD COLUMN "source" text DEFAULT 'ember' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "owner_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "google_event_id" text;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "crm_booking_id" uuid;
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_crm_booking_id_calendar_bookings_id_fk" FOREIGN KEY ("crm_booking_id") REFERENCES "public"."calendar_bookings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "events_crm_booking_unique" ON "events" USING btree ("crm_booking_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "events_owner_google_event_unique" ON "events" USING btree ("owner_user_id","google_event_id");
--> statement-breakpoint
INSERT INTO "events" (
  "title",
  "description",
  "start_at",
  "end_at",
  "is_all_day",
  "category",
  "tags",
  "link",
  "source",
  "owner_user_id",
  "google_event_id",
  "crm_booking_id",
  "created_at",
  "updated_at"
)
SELECT
  booking."title",
  booking."description",
  booking."start_at",
  booking."end_at",
  false,
  'meeting',
  'crm,google-calendar',
  booking."meet_link",
  'google_crm',
  booking."user_id",
  booking."google_event_id",
  booking."id",
  booking."created_at",
  now()
FROM "calendar_bookings" AS booking
WHERE booking."status" = 'confirmed'
ON CONFLICT ("crm_booking_id") DO UPDATE SET
  "title" = EXCLUDED."title",
  "description" = EXCLUDED."description",
  "start_at" = EXCLUDED."start_at",
  "end_at" = EXCLUDED."end_at",
  "link" = EXCLUDED."link",
  "google_event_id" = EXCLUDED."google_event_id",
  "updated_at" = now();
