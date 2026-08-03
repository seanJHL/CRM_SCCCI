import { eq, lte, and, gte, isNull } from "drizzle-orm";
import { createDatabase } from "./db";
import { events, reminders } from "./db/schema";
import type { Bindings } from "./types";
import { getEnv } from "./lib/env";
import { broadcastPush } from "./lib/push";

/**
 * Cloudflare Cron Trigger handler.
 *
 * Runs three independent jobs:
 * 1. Recurring meeting expiry check (daily, 00:00).
 * 2. Calendar event alerts — upcoming events starting soon (every minute).
 * 3. Reminder alarms — point-in-time nudges from the reminders table
 *    (every minute). This is fully decoupled from calendar scheduling.
 */
export async function handleCron(
  event: ScheduledEvent,
  env: Bindings,
  _ctx: ExecutionContext,
): Promise<void> {
  const db = createDatabase(env.DATABASE_URL);
  const envConfig = getEnv(env);
  const cron = event.cron;
  const scheduledNow = new Date(event.scheduledTime);

  console.log(`[CRON] Triggered: ${cron}`);

  // Daily job: check recurring meeting expiry
  if (cron === "0 0 * * *") {
    await checkRecurringExpiry(db);
  }

  // Every minute: dispatch calendar event alerts + reminder alarms
  if (cron === "* * * * *") {
    const eventAlerts = await dispatchEventNotifications(
      db,
      envConfig,
      scheduledNow,
    );
    const reminderAlarms = await dispatchReminderAlarms(
      db,
      envConfig,
      scheduledNow,
    );
    console.log(
      `[CRON] Dispatch complete: ${eventAlerts} event alert(s), ${reminderAlarms} reminder alarm(s).`,
    );
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
 * Calendar event alerts — fire a Web Push notification for any event
 * starting within the next 15 minutes. This is the only place the
 * reminders/cron logic touches the calendar; reminders below are handled
 * in their own dedicated path.
 */
async function dispatchEventNotifications(
  db: ReturnType<typeof createDatabase>,
  env: ReturnType<typeof getEnv>,
  now: Date,
): Promise<number> {
  const in15Min = new Date(now.getTime() + 15 * 60 * 1000);
  let sent = 0;

  const upcomingEvents = await db
    .select()
    .from(events)
    .where(
      and(
        gte(events.startAt, now),
        lte(events.startAt, in15Min),
        isNull(events.lastNotifiedAt),
      ),
    );

  for (const event of upcomingEvents) {
    const startsIn = Math.max(
      0,
      Math.round((event.startAt.getTime() - now.getTime()) / 60000),
    );
    console.log(
      `[CRON] Event alert: "${event.title}" starts at ${event.startAt}`,
    );
    const delivered = await broadcastPush(db, env, {
      title: event.title,
      body: startsIn <= 0 ? "Starting now" : `Starting in ${startsIn} min`,
      url: "/m/calendar",
      tag: `event-${event.id}`,
      icon: "/icons/ember-192.png",
      badge: "/icons/ember-192.png",
    });

    if (delivered > 0) {
      await db
        .update(events)
        .set({ lastNotifiedAt: now })
        .where(eq(events.id, event.id));
      sent += 1;
    }
  }

  return sent;
}

/**
 * Reminder alarms — fire Web Push notifications for active reminders in
 * the `reminders` table. This is intentionally a separate function from
 * calendar event alerts so reminders remain an independent concept
 * (alarms / quick point-in-time nudges) and never depend on, or feed
 * from, calendar scheduling.
 *
 * - `daily_time` reminders use the device's IANA timezone and retry for a
 *   short window if delivery has a transient failure.
 * - `interval` reminders fire relative to creation or their last delivery.
 */
async function dispatchReminderAlarms(
  db: ReturnType<typeof createDatabase>,
  env: ReturnType<typeof getEnv>,
  now: Date,
): Promise<number> {
  let fired = 0;

  const activeReminders = await db
    .select()
    .from(reminders)
    .where(eq(reminders.isActive, true));

  for (const reminder of activeReminders) {
    let due = false;

    if (reminder.scheduleType === "daily_time" && reminder.timeOfDay) {
      const [h, m] = reminder.timeOfDay.split(":").map(Number);
      const zonedNow = getZonedMinute(now, reminder.timeZone);
      const scheduledMinute = h * 60 + m;
      const minutesAfterSchedule = zonedNow.minuteOfDay - scheduledMinute;
      const lastFiredDate = reminder.lastFiredAt
        ? getZonedMinute(reminder.lastFiredAt, reminder.timeZone).date
        : null;
      due =
        minutesAfterSchedule >= 0 &&
        minutesAfterSchedule < 5 &&
        lastFiredDate !== zonedNow.date;
    } else if (
      reminder.scheduleType === "interval" &&
      reminder.intervalMinutes
    ) {
      const previous = reminder.lastFiredAt ?? reminder.createdAt;
      due =
        now.getTime() - previous.getTime() >=
        reminder.intervalMinutes * 60 * 1000;
    }

    if (!due) continue;

    console.log(JSON.stringify({
      message: "Reminder due",
      reminderId: reminder.id,
      scheduleType: reminder.scheduleType,
    }));
    const delivered = await broadcastPush(db, env, {
      title: reminder.name,
      body: reminder.scheduleType === "interval" ? "Recurring nudge" : "Alarm",
      url: "/m/reminders",
      tag: `reminder-${reminder.id}`,
      icon: "/icons/ember-192.png",
      badge: "/icons/ember-192.png",
    });

    if (delivered > 0) {
      await db
        .update(reminders)
        .set({ lastFiredAt: now })
        .where(eq(reminders.id, reminder.id));
      fired += 1;
    }
  }

  return fired;
}

function getZonedMinute(date: Date, requestedTimeZone: string): {
  date: string;
  minuteOfDay: number;
} {
  let timeZone = requestedTimeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(date);
  } catch {
    timeZone = "Asia/Singapore";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minuteOfDay: Number(value("hour")) * 60 + Number(value("minute")),
  };
}
