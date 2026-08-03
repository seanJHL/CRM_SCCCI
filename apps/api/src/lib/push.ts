import {
  buildPushPayload,
  type PushSubscription,
} from "@block65/webcrypto-web-push";
import { eq } from "drizzle-orm";
import type { createDatabase } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import type { EnvConfig } from "@/lib/env";

/**
 * Payload delivered to the service worker's `push` event handler.
 * Mirrors the shape expected by apps/web/public/sw.js.
 */
export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
}

/**
 * Returns whether this environment has the keys required for Web Push.
 */
export function configureVapid(env: EnvConfig): boolean {
  return Boolean(
    env.vapidSubject && env.vapidPublicKey && env.vapidPrivateKey,
  );
}

/**
 * Send a single push notification. Returns true on success.
 * Throws on transient delivery errors (caller should handle).
 */
export async function sendPush(
  subscription: { endpoint: string; p256dhKey: string; authKey: string },
  payload: PushPayload,
  env: EnvConfig,
): Promise<boolean> {
  if (!configureVapid(env)) return false;

  const browserSubscription: PushSubscription = {
    endpoint: subscription.endpoint,
    expirationTime: null,
    keys: {
      p256dh: subscription.p256dhKey,
      auth: subscription.authKey,
    },
  };
  const request = await buildPushPayload(
    {
      data: JSON.stringify(payload),
      options: {
        ttl: 60 * 60,
        urgency: "high",
      },
    },
    browserSubscription,
    {
      subject: env.vapidSubject,
      publicKey: env.vapidPublicKey,
      privateKey: env.vapidPrivateKey,
    },
  );

  const response = await fetch(subscription.endpoint, request);
  if (response.ok) return true;

  // 404 / 410 mean the subscription is no longer valid.
  if (response.status === 404 || response.status === 410) return false;

  throw new Error(`Push service responded with ${response.status}`);
}

/**
 * Fan out a push notification to every stored subscription.
 * Automatically prunes subscriptions that have expired (404/410).
 * Returns the number of successful deliveries.
 */
export async function broadcastPush(
  db: ReturnType<typeof createDatabase>,
  env: EnvConfig,
  payload: PushPayload,
): Promise<number> {
  if (!configureVapid(env)) {
    console.log(JSON.stringify({
      message: "Push skipped: VAPID keys are not configured",
      environment: env.environment,
    }));
    return 0;
  }

  const subs = await db.select().from(pushSubscriptions);
  if (subs.length === 0) return 0;

  let delivered = 0;
  for (const sub of subs) {
    try {
      const success = await sendPush(sub, payload, env);
      if (success) {
        delivered += 1;
      } else {
        // Subscription expired — remove it.
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.id, sub.id));
        console.log(JSON.stringify({
          message: "Expired push subscription pruned",
          subscriptionId: sub.id,
        }));
      }
    } catch (err) {
      console.error(JSON.stringify({
        message: "Push delivery failed",
        subscriptionId: sub.id,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  console.log(JSON.stringify({
    message: "Push broadcast complete",
    delivered,
    subscriptions: subs.length,
  }));
  return delivered;
}
