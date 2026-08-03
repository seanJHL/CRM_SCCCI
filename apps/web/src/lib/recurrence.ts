import { addDays, addWeeks, addMonths, isBefore } from "date-fns";
import type { Event } from "@/lib/query-keys";

export interface EventOccurrence {
  event: Event;
  occurrenceStart: Date;
  occurrenceEnd: Date;
  isRecurring: boolean;
}

/** Completion belongs to an exact occurrence, not to elapsed calendar time. */
export function isOccurrenceComplete(occurrence: EventOccurrence): boolean {
  const occurrenceTime = occurrence.occurrenceStart.getTime();
  return (occurrence.event.completions ?? []).some(
    (completion) =>
      new Date(completion.occurrenceStart).getTime() === occurrenceTime,
  );
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
    // Include events that overlap the range, including events that began on
    // the previous day and continue into the visible day.
    if (isBefore(end, rangeStart) || isBefore(rangeEnd, start)) return [];
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
    const occurrenceEnd = new Date(cursor.getTime() + durationMs);
    // A long recurring occurrence can begin before the range and still be
    // active inside it, so compare both ends of the occurrence.
    if (!isBefore(occurrenceEnd, rangeStart)) {
      occurrences.push({
        event,
        occurrenceStart: cursor,
        occurrenceEnd,
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
