import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";
import { configureVapid, sendPush } from "@/lib/push";

/**
 * Shape produced by PushSubscription.toJSON() on the client.
 */
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine(
    (value) => value.startsWith("https://"),
    "Push endpoint must use HTTPS",
  ),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const subscribeSchema = z.object({
  subscription: subscriptionSchema,
  userAgent: z.string().max(500).optional(),
});

const unsubscribeSchema = z.object({
  endpoint: subscriptionSchema.shape.endpoint,
});

const testSchema = unsubscribeSchema;

const pushRoute = new Hono<AppBindings>();

// Return the VAPID public key so the client can subscribe.
pushRoute.get("/vapid-public-key", (c) => {
  const env = getEnv(c.env);
  if (!env.vapidPublicKey) {
    throw ApiError.internal("VAPID public key is not configured");
  }
  c.header("cache-control", "public, max-age=3600");
  return c.json(ok({ publicKey: env.vapidPublicKey }));
});

// Store a push subscription (upsert by endpoint).
pushRoute.post("/subscribe", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = subscribeSchema.parse(await c.req.json());
  const { subscription, userAgent } = body;

  const [existing] = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, subscription.endpoint));

  if (existing) {
    // Refresh keys in case they rotated.
    await db
      .update(pushSubscriptions)
      .set({
        p256dhKey: subscription.keys.p256dh,
        authKey: subscription.keys.auth,
        userAgent: userAgent ?? existing.userAgent,
      })
      .where(eq(pushSubscriptions.id, existing.id));
    return c.json(ok({ id: existing.id }, "Subscription updated"));
  }

  const [created] = await db
    .insert(pushSubscriptions)
    .values({
      endpoint: subscription.endpoint,
      p256dhKey: subscription.keys.p256dh,
      authKey: subscription.keys.auth,
      userAgent: userAgent ?? null,
    })
    .returning();
  return c.json(ok({ id: created.id }, "Subscription stored"), 201);
});

// Remove a push subscription by endpoint.
pushRoute.post("/unsubscribe", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = unsubscribeSchema.parse(await c.req.json());

  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, body.endpoint));
  return c.json(ok(null, "Subscription removed"));
});

// Send a test push only to the requesting browser's exact endpoint.
pushRoute.post("/test", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = testSchema.parse(await c.req.json());

  if (!configureVapid(env)) {
    throw ApiError.internal("VAPID keys are not configured");
  }

  const [subscription] = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, body.endpoint));
  if (!subscription) {
    throw ApiError.notFound("Push subscription is not registered");
  }

  const delivered = await sendPush(subscription, {
    title: "Ember 🔥",
    body: "Push notifications are working! You're all set.",
    url: "/m",
    tag: "ember-test",
    icon: "/icons/ember-192.png",
    badge: "/icons/ember-192.png",
  }, env);

  if (!delivered) {
    await db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.id, subscription.id));
  }

  return c.json(ok({ delivered }, delivered ? "Test push dispatched" : "Subscription expired"));
});

export default pushRoute;
