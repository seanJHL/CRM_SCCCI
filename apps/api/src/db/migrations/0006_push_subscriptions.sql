CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "endpoint" text NOT NULL UNIQUE,
  "p256dh_key" text NOT NULL,
  "auth_key" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
