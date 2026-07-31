ALTER TABLE "exercises"
  ADD COLUMN IF NOT EXISTS "tracking_type" text NOT NULL DEFAULT 'strength';

ALTER TABLE "group_exercises"
  ADD COLUMN IF NOT EXISTS "default_distance_km" real,
  ADD COLUMN IF NOT EXISTS "default_duration_minutes" integer;

ALTER TABLE "session_sets"
  ADD COLUMN IF NOT EXISTS "distance_km" real,
  ADD COLUMN IF NOT EXISTS "duration_minutes" integer;

UPDATE "exercises"
SET "tracking_type" = 'run'
WHERE "name" = 'Treadmill Run';

INSERT INTO "exercises" ("id", "name", "category", "equipment_type", "tracking_type")
SELECT gen_random_uuid(), 'Outdoor Run', 'cardio', 'outdoor', 'run'
WHERE NOT EXISTS (
  SELECT 1
  FROM "exercises"
  WHERE LOWER("name") = LOWER('Outdoor Run')
);
