import { addDays, addWeeks, addMonths, isBefore, startOfDay } from "date-fns";
import type { Event } from "@/lib/query-keys";

export interface EventOccurrence {
  event: Event;
  occurrenceStart: Date;
  occurrenceEnd: Date;
  isRecurring: boolean;
}

interface ParsedRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
}

/** Parse FREQ and INTERVAL from our supported RRULE subset. */
function parseRule(rule: string): ParsedRule | null {
  const freqMatch = rule.match(/FREQ=(DAILY|WEEKLY|MONTHLY)/);
  if (!freqMatch) return null;
  const freq = freqMatch[1] as ParsedRule["freq"];

  const intervalMatch = rule.match(/INTERVAL=(\d+)/);
  const interval = intervalMatch ? parseInt(intervalMatch[1], 10) : 1;

  return { freq, interval: Math.max(1, interval) };
}

/** Advance a date by one recurrence step. */
function advance(date: Date, rule: ParsedRule): Date {
  switch (rule.freq) {
    case "DAILY":
      return addDays(date, rule.interval);
    case "WEEKLY":
      return addWeeks(date, rule.interval);
    case "MONTHLY":
      return addMonths(date, rule.interval);
  }
}

const MAX_ITERATIONS = 365;

/**
 * Expand a single event into all occurrences within [rangeStart, rangeEnd].
 * Non-recurring events produce a single occurrence.
 * Recurring events iterate from startAt by the rule step until expiry or rangeEnd.
 */
export function expandEvent(
  event: Event,
  rangeStart: Date,
  rangeEnd: Date,
): EventOccurrence[] {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const durationMs = end.getTime() - start.getTime();

  // Non-recurring: single occurrence
  if (!event.recurrenceRule || event.recurrenceStatus !== "active") {
    // Only include if it falls within the visible range
    if (isBefore(start, rangeStart) || isBefore(rangeEnd, start)) {
      // Check day-level overlap
      const dayStart = startOfDay(start);
      const dayRangeStart = startOfDay(rangeStart);
      const dayRangeEnd = startOfDay(rangeEnd);
      if (isBefore(dayStart, dayRangeStart) || isBefore(dayRangeEnd, dayStart)) {
        return [];
      }
    }
    return [{ event, occurrenceStart: start, occurrenceEnd: end, isRecurring: false }];
  }

  const rule = parseRule(event.recurrenceRule);
  if (!rule) {
    return [{ event, occurrenceStart: start, occurrenceEnd: end, isRecurring: false }];
  }

  const expiry = event.recurrenceExpiryAt
    ? new Date(event.recurrenceExpiryAt)
    : rangeEnd;
  const effectiveEnd = isBefore(expiry, rangeEnd) ? expiry : rangeEnd;

  const occurrences: EventOccurrence[] = [];
  let cursor = start;
  let iterations = 0;

  while (
    !isBefore(effectiveEnd, cursor) &&
    iterations < MAX_ITERATIONS
  ) {
    // Only emit if cursor is within [rangeStart, effectiveEnd]
    if (!isBefore(cursor, rangeStart)) {
      occurrences.push({
        event,
        occurrenceStart: cursor,
        occurrenceEnd: new Date(cursor.getTime() + durationMs),
        isRecurring: true,
      });
    }
    cursor = advance(cursor, rule);
    iterations++;
  }

  return occurrences;
}

/**
 * Expand all events (recurring + non-recurring) for a visible date range.
 * Returns a flat list of occurrences sorted by start time.
 */
export function expandEvents(
  events: Event[],
  rangeStart: Date,
  rangeEnd: Date,
): EventOccurrence[] {
  const all: EventOccurrence[] = [];
  for (const event of events) {
    all.push(...expandEvent(event, rangeStart, rangeEnd));
  }
  all.sort((a, b) => a.occurrenceStart.getTime() - b.occurrenceStart.getTime());
  return all;
}
