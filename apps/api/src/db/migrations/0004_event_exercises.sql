CREATE TABLE IF NOT EXISTS "event_exercises" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "exercise_id" uuid NOT NULL REFERENCES "exercises"("id") ON DELETE CASCADE,
  "sets" integer NOT NULL DEFAULT 3,
  "reps" integer NOT NULL DEFAULT 10,
  "weight" real,
  "position" integer NOT NULL DEFAULT 0
);
