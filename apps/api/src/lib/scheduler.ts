/**
 * Smart scheduling engine using chrono-node for natural-language
 * date/time detection. Checks Google Calendar availability and
 * suggests alternative time slots. No calendar event is created
 * without explicit user confirmation.
 */

import * as chrono from "chrono-node";
import {
  calendarFreeBusy,
  type BusySlot,
  type CalendarBusyResult,
} from "@/lib/google-api";

// --- Types ---

export interface ParsedSchedule {
  start: string; // ISO datetime
  end: string; // ISO datetime
  durationMinutes: number;
  isAmbiguous: boolean;
  ambiguityReason: string | null;
  interpretation: string; // human-readable, e.g. "Monday, 3 August 2026 at 8:00 PM"
  matchedText: string;
}

export interface AvailabilityResult {
  available: boolean;
  conflicts: BusySlot[];
  reason: string;
  withinWorkingHours: boolean;
  participantAvailability: Array<{
    calendarId: string;
    available: boolean | null;
    conflicts: BusySlot[];
    error?: string;
  }>;
}

export interface SuggestedSlot {
  start: string;
  end: string;
  label: string;
}

export interface WorkingHours {
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

// --- Duration parsing ---

const DURATION_PATTERNS: { regex: RegExp; minutes: number }[] = [
  { regex: /(\d+)\s*(?:hour|hr|hours|hrs)\b/i, minutes: 0 }, // dynamic
  { regex: /(\d+)\s*(?:min|minutes|mins)\b/i, minutes: 0 }, // dynamic
  { regex: /\bhalf\s*hour\b/i, minutes: 30 },
  { regex: /\bhour\b/i, minutes: 60 },
  { regex: /\bquick\b/i, minutes: 15 },
];

/**
 * Extract meeting duration from text. Returns minutes (default 30).
 */
export function extractDuration(text: string): number {
  for (const pattern of DURATION_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match) {
      if (match[1]) {
        const num = parseInt(match[1], 10);
        if (/hour|hr/i.test(match[0])) return num * 60;
        return num;
      }
      return pattern.minutes;
    }
  }
  return 30;
}

// --- Meeting request detection ---

const MEETING_KEYWORDS =
  /\b(meet|meeting|schedule|call|appointment|availability|free at|available on|book a time|slot|sync up|catch up|catchup|let'?s talk|discussion)\b/i;

/**
 * Detect whether a text contains a meeting/scheduling request.
 */
export function detectMeetingRequest(text: string): boolean {
  return MEETING_KEYWORDS.test(text);
}

// --- NLP date/time parsing ---

const AMBIGUOUS_MARKERS = /\b(this|next|last|tomorrow|today|yesterday)\b/i;

/**
 * Parse natural-language scheduling text using chrono-node.
 * Converts phrases like "I am free at 8:00 PM on Monday" into
 * an exact datetime based on the user's timezone.
 */
export function parseSchedulingText(
  text: string,
  timezone: string,
  now = new Date(),
): ParsedSchedule | null {
  const referenceOffset = getTimeZoneOffsetMinutes(now, timezone);
  const results = chrono.parse(text, { instant: now, timezone: referenceOffset }, {
    forwardDate: true,
  });

  if (results.length === 0) return null;

  const result = results[0];
  const startDate = componentsToDate(result.start, timezone);
  const endDate = result.end ? componentsToDate(result.end, timezone) : null;

  const durationMinutes = endDate
    ? Math.max(15, Math.round((endDate.getTime() - startDate.getTime()) / 60000))
    : extractDuration(text);

  const end = endDate ?? new Date(startDate.getTime() + durationMinutes * 60000);

  // Check ambiguity: if the matched text mentions a weekday without
  // "this", "next", "tomorrow", etc., it's ambiguous
  const matchedText = result.text;
  const weekdayWithoutQualifier =
    !AMBIGUOUS_MARKERS.test(matchedText) &&
    /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      matchedText,
    );
  const missingDate =
    !result.start.isCertain("day") &&
    !result.start.isCertain("weekday") &&
    !/\b(today|tomorrow|tonight)\b/i.test(matchedText);
  const missingTime = !result.start.isCertain("hour");
  const isAmbiguous = weekdayWithoutQualifier || missingDate || missingTime;
  const ambiguityReason = weekdayWithoutQualifier
    ? "The weekday did not specify whether it means this week or next week."
    : missingDate
      ? "A date was not specified."
      : missingTime
        ? "A specific time was not provided."
        : null;

  const interpretation = formatDateLabel(startDate, timezone);

  return {
    start: startDate.toISOString(),
    end: end.toISOString(),
    durationMinutes,
    isAmbiguous,
    ambiguityReason,
    interpretation,
    matchedText,
  };
}

/**
 * Format a date as a human-readable label in the user's timezone.
 * e.g. "Monday, 3 August 2026 at 8:00 PM"
 */
function formatDateLabel(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  });
  return formatter
    .format(date)
    .replace(/\b(am|pm)\b/i, (marker) => marker.toUpperCase());
}

// --- Availability checking ---

/**
 * Check if a time range is available (no calendar conflicts and within working hours).
 */
export async function checkAvailability(
  accessToken: string,
  start: string,
  end: string,
  timezone: string,
  workingHours: WorkingHours,
  participantCalendarIds: string[] = [],
): Promise<AvailabilityResult> {
  const startDate = new Date(start);
  const endDate = new Date(end);

  // Check working hours
  const withinWorkingHours = isWithinWorkingHours(startDate, endDate, workingHours, timezone);

  // Check calendar conflicts
  const calendarIds = [
    "primary",
    ...new Set(participantCalendarIds.filter((id) => id !== "primary")),
  ];
  const calendarResults = await calendarFreeBusy(
    accessToken,
    start,
    end,
    calendarIds,
    timezone,
  );
  const busySlots = calendarResults.flatMap((calendar) => calendar.busy);
  const conflicts = busySlots.filter((slot) => {
    const slotStart = new Date(slot.start);
    const slotEnd = new Date(slot.end);
    return slotStart < endDate && slotEnd > startDate;
  });

  const primaryError = calendarResults.find(
    (calendar) => calendar.calendarId === "primary",
  )?.error;
  const available = conflicts.length === 0 && withinWorkingHours && !primaryError;

  let reason = "";
  if (primaryError) {
    reason = "Primary calendar availability could not be checked";
  } else if (conflicts.length > 0) {
    reason = `Conflicts with ${conflicts.length} existing event(s)`;
  } else if (!withinWorkingHours) {
    reason = "Outside of working hours";
  } else {
    reason = "Available";
  }

  return {
    available,
    conflicts,
    reason,
    withinWorkingHours,
    participantAvailability: toParticipantAvailability(calendarResults),
  };
}

/**
 * Suggest alternative available time slots near a requested start time.
 * Searches within working hours, avoiding calendar conflicts.
 */
export async function suggestAlternativeSlots(
  accessToken: string,
  requestedStart: string,
  durationMinutes: number,
  timezone: string,
  workingHours: WorkingHours,
  count = 5,
  participantCalendarIds: string[] = [],
): Promise<SuggestedSlot[]> {
  const slots: SuggestedSlot[] = [];
  const requestedDate = new Date(requestedStart);
  let searchDate = new Date(
    Math.ceil(requestedDate.getTime() / (30 * 60_000)) * (30 * 60_000),
  );
  const maxSearchDate = new Date(
    searchDate.getTime() + 14 * 24 * 60 * 60 * 1000,
  );
  const calendarResults = await calendarFreeBusy(
    accessToken,
    searchDate.toISOString(),
    maxSearchDate.toISOString(),
    [
      "primary",
      ...new Set(participantCalendarIds.filter((id) => id !== "primary")),
    ],
    timezone,
  );
  const busySlots = calendarResults.flatMap((calendar) => calendar.busy);

  while (slots.length < count && searchDate < maxSearchDate) {
    const slotEnd = new Date(searchDate.getTime() + durationMinutes * 60_000);
    const dayOfWeek = zonedDateParts(searchDate, timezone).dayOfWeek;
    const hasConflict = busySlots.some(
      (slot) => new Date(slot.start) < slotEnd && new Date(slot.end) > searchDate,
    );

    if (
      dayOfWeek !== 0 &&
      dayOfWeek !== 6 &&
      isWithinWorkingHours(searchDate, slotEnd, workingHours, timezone) &&
      !hasConflict
    ) {
      slots.push({
        start: searchDate.toISOString(),
        end: slotEnd.toISOString(),
        label: formatDateLabel(searchDate, timezone),
      });
    }

    searchDate = new Date(searchDate.getTime() + 30 * 60000);
  }

  return slots;
}

// --- Helpers ---

function isWithinWorkingHours(
  start: Date,
  end: Date,
  workingHours: WorkingHours,
  timezone: string,
): boolean {
  // Get the local time in the user's timezone
  const startParts = zonedDateParts(start, timezone);
  const endParts = zonedDateParts(end, timezone);
  const startMinutes = startParts.hour * 60 + startParts.minute;
  const endMinutes = endParts.hour * 60 + endParts.minute;

  const [whStartHour, whStartMin] = workingHours.start.split(":").map(Number);
  const [whEndHour, whEndMin] = workingHours.end.split(":").map(Number);
  const whStartMinutes = whStartHour * 60 + whStartMin;
  const whEndMinutes = whEndHour * 60 + whEndMin;

  const sameLocalDay =
    startParts.year === endParts.year &&
    startParts.month === endParts.month &&
    startParts.day === endParts.day;

  return (
    sameLocalDay &&
    startMinutes >= whStartMinutes &&
    endMinutes <= whEndMinutes
  );
}

function zonedDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  return {
    year,
    month,
    day,
    hour: value("hour"),
    minute: value("minute"),
    dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

function componentsToDate(
  components: chrono.ParsedComponents,
  timezone: string,
): Date {
  const year = components.get("year")!;
  const month = components.get("month")!;
  const day = components.get("day")!;
  const hour = components.get("hour") ?? 12;
  const minute = components.get("minute") ?? 0;
  const second = components.get("second") ?? 0;
  const millisecond = components.get("millisecond") ?? 0;
  const utcWallClock = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );

  if (components.isCertain("timezoneOffset")) {
    const explicitOffset = components.get("timezoneOffset") ?? 0;
    return new Date(utcWallClock - explicitOffset * 60_000);
  }

  // Resolve an IANA wall-clock time to an instant. Iterating handles DST
  // boundaries where the target offset differs from the reference date.
  let instant = new Date(utcWallClock);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offset = getTimeZoneOffsetMinutes(instant, timezone);
    instant = new Date(utcWallClock - offset * 60_000);
  }
  return instant;
}

function getTimeZoneOffsetMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const representedAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return Math.round((representedAsUtc - date.getTime()) / 60_000);
}

function toParticipantAvailability(results: CalendarBusyResult[]) {
  return results.map((calendar) => ({
    calendarId: calendar.calendarId,
    available: calendar.error ? null : calendar.busy.length === 0,
    conflicts: calendar.busy,
    ...(calendar.error ? { error: calendar.error } : {}),
  }));
}
