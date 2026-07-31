import webpush from "web-push";
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

let vapidConfigured = false;

/**
 * Configure VAPID details once per isolate. Safe to call repeatedly.
 * Returns false when VAPID keys are not configured (push disabled).
 */
export function configureVapid(env: EnvConfig): boolean {
  if (vapidConfigured) return true;
  if (!env.vapidPublicKey || !env.vapidPrivateKey) return false;
  webpush.setVapidDetails(
    env.vapidSubject,
    env.vapidPublicKey,
    env.vapidPrivateKey,
  );
  vapidConfigured = true;
  return true;
}

/**
 * Send a single push notification. Returns true on success.
 * Throws on transient delivery errors (caller should handle).
 */
export async function sendPush(
  subscription: { endpoint: string; p256dhKey: string; authKey: string },
  payload: PushPayload,
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dhKey,
          auth: subscription.authKey,
        },
      },
      JSON.stringify(payload),
    );
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    // 404 / 410 mean the subscription is no longer valid.
    if (status === 404 || status === 410) {
      return false;
    }
    throw err;
  }
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
    console.log("[PUSH] VAPID keys not configured — skipping broadcast");
    return 0;
  }

  const subs = await db.select().from(pushSubscriptions);
  if (subs.length === 0) return 0;

  let delivered = 0;
  for (const sub of subs) {
    try {
      const success = await sendPush(sub, payload);
      if (success) {
        delivered += 1;
      } else {
        // Subscription expired — remove it.
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.id, sub.id));
        console.log(`[PUSH] Pruned expired subscription ${sub.id}`);
      }
    } catch (err) {
      console.error(`[PUSH] Failed to deliver to ${sub.id}:`, err);
    }
  }

  console.log(`[PUSH] Broadcast complete: ${delivered}/${subs.length} delivered`);
  return delivered;
}
