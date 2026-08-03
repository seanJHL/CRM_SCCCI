import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { calendarBookings, events } from "@/db/schema";

/**
 * Mirror confirmed CRM bookings into Ember's canonical events table.
 *
 * The CRM booking id is the idempotency key, so repeated page loads, OAuth
 * callbacks, and background synchronisation cannot create duplicate events.
 */
export async function syncCrmBookingsToEmberCalendar(
  db: Database,
  userId: string,
): Promise<void> {
  const bookings = await db
    .select()
    .from(calendarBookings)
    .where(eq(calendarBookings.userId, userId));

  for (const booking of bookings) {
    if (booking.status !== "confirmed") {
      await db
        .delete(events)
        .where(
          and(
            eq(events.ownerUserId, userId),
            eq(events.crmBookingId, booking.id),
          ),
        );
      continue;
    }

    await db
      .insert(events)
      .values(calendarEventValues(booking))
      .onConflictDoUpdate({
        target: events.crmBookingId,
        set: {
          title: booking.title,
          description: booking.description,
          startAt: booking.startAt,
          endAt: booking.endAt,
          link: booking.meetLink,
          googleEventId: booking.googleEventId,
          ownerUserId: userId,
          source: "google_crm",
          updatedAt: new Date(),
        },
      });
  }
}

function calendarEventValues(
  booking: typeof calendarBookings.$inferSelect,
): typeof events.$inferInsert {
  return {
    title: booking.title,
    description: booking.description,
    startAt: booking.startAt,
    endAt: booking.endAt,
    isAllDay: false,
    category: "meeting",
    tags: "crm,google-calendar",
    link: booking.meetLink,
    source: "google_crm",
    ownerUserId: booking.userId,
    googleEventId: booking.googleEventId,
    crmBookingId: booking.id,
  };
}
