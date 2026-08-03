ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "last_notified_at" timestamp with time zone;

ALTER TABLE "reminders"
  ADD COLUMN IF NOT EXISTS "time_zone" text NOT NULL DEFAULT 'Asia/Singapore';

ALTER TABLE "reminders"
  ADD COLUMN IF NOT EXISTS "last_fired_at" timestamp with time zone;
