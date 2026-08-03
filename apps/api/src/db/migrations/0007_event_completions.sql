CREATE TABLE IF NOT EXISTS "event_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"occurrence_start" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_completions_event_occurrence_unique" ON "event_completions" USING btree ("event_id", "occurrence_start");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_completions" ADD CONSTRAINT "event_completions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
