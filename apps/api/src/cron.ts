import { eq, lte, and, gte, lte as lteOp } from "drizzle-orm";
import { createDatabase } from "./db";
import { events, reminders } from "./db/schema";
import type { Bindings } from "./types";
import { getEnv } from "./lib/env";
import { broadcastPush } from "./lib/push";

/**
 * Cloudflare Cron Trigger handler.
 *
 * Runs two jobs:
 * 1. Recurring meeting expiry check (daily)
 * 2. Reminder/notification dispatch (every 15 min)
 */
export async function handleCron(
  event: ScheduledEvent,
  env: Bindings,
  _ctx: ExecutionContext,
): Promise<void> {
  const db = createDatabase(env.DATABASE_URL);
  const envConfig = getEnv(env);
  const cron = event.cron;

  console.log(`[CRON] Triggered: ${cron}`);

  // Daily job: check recurring meeting expiry
  if (cron === "0 0 * * *") {
    await checkRecurringExpiry(db);
  }

  // Every 15 minutes: dispatch reminders/notifications
  if (cron === "*/15 * * * *") {
    await dispatchReminders(db, envConfig);
  }
}

/**
 * Find all recurring events whose expiry date has passed
 * and set their status to 'pending_review'.
 */
async function checkRecurringExpiry(db: ReturnType<typeof createDatabase>) {
  const now = new Date();

  const expired = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.recurrenceStatus, "active"),
        lte(events.recurrenceExpiryAt, now),
      ),
    );

  for (const event of expired) {
    await db
      .update(events)
      .set({ recurrenceStatus: "pending_review" })
      .where(eq(events.id, event.id));
    console.log(`[CRON] Event "${event.title}" set to pending_review`);
  }

  console.log(`[CRON] Recurring expiry check complete. ${expired.length} events flagged.`);
}

/**
 * Check active reminders and upcoming events, then deliver real
 * Web Push notifications to all subscribed clients.
 */
async function dispatchReminders(
  db: ReturnType<typeof createDatabase>,
  env: ReturnType<typeof getEnv>,
) {
  const now = new Date();
  const in15Min = new Date(now.getTime() + 15 * 60 * 1000);

  // Find events starting in the next 15 minutes
  const upcomingEvents = await db
    .select()
    .from(events)
    .where(
      and(
        gte(events.startAt, now),
        lteOp(events.startAt, in15Min),
      ),
    );

  for (const event of upcomingEvents) {
    const startsIn = Math.max(
      0,
      Math.round((event.startAt.getTime() - now.getTime()) / 60000),
    );
    console.log(
      `[CRON] Notification: Event "${event.title}" starts at ${event.startAt}`,
    );
    await broadcastPush(db, env, {
      title: event.title,
      body:
        startsIn <= 0
          ? "Starting now"
          : `Starting in ${startsIn} min`,
      url: "/m/calendar",
      tag: `event-${event.id}`,
      icon: "/icons/ember-192.png",
      badge: "/icons/ember-192.png",
    });
  }

  // Find active reminders that are due within this cycle
  const activeReminders = await db
    .select()
    .from(reminders)
    .where(eq(reminders.isActive, true));

  for (const reminder of activeReminders) {
    if (reminder.scheduleType === "daily_time" && reminder.timeOfDay) {
      const [h, m] = reminder.timeOfDay.split(":").map(Number);
      const reminderTime = new Date(now);
      reminderTime.setHours(h, m, 0, 0);
      // Check if current time matches (within 15 min window)
      const diff = Math.abs(now.getTime() - reminderTime.getTime());
      if (diff < 15 * 60 * 1000) {
        console.log(`[CRON] Notification: Reminder "${reminder.name}" due now`);
        await broadcastPush(db, env, {
          title: reminder.name,
          body: "Scheduled reminder",
          url: "/m/reminders",
          tag: `reminder-${reminder.id}`,
          icon: "/icons/ember-192.png",
          badge: "/icons/ember-192.png",
        });
      }
    }
    // Interval-based reminders would need a last-fired timestamp
    // to avoid re-firing every cycle; logged for now.
    if (reminder.scheduleType === "interval") {
      console.log(
        `[CRON] Notification: Interval reminder "${reminder.name}" (every ${reminder.intervalMinutes} min)`,
      );
    }
  }

  console.log(
    `[CRON] Reminder dispatch complete. ${upcomingEvents.length} upcoming events, ${activeReminders.length} active reminders.`,
  );
}
