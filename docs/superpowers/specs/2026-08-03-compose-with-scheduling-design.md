# Compose button with integrated scheduling — Design

Date: 2026-08-03

## Problem

The `/crm` page has no way to start a brand-new email conversation. The
existing message composer (`crm.tsx`, the "Create draft" dialog) only opens
in reply to an already-selected Gmail thread: the recipient is locked to a
thread participant and the subject is forced to `Re: ...`.

We need a **Compose** button that lets the user write and send a new message
to any recipient, with the same natural-language meeting detection,
conflict-checking, and calendar-booking behavior the reply flow already has
— but with the calendar event created automatically once the message is
sent, rather than as a separate manual step.

## Existing infrastructure (reused as-is, no changes)

- `apps/api/src/lib/scheduler.ts` — `parseSchedulingText` (chrono-node NL
  date/time parsing with ambiguity detection), `checkAvailability`,
  `suggestAlternativeSlots`, `detectMeetingRequest`. Verified this already
  resolves phrasing like "this Tuesday at 12:00 PM" to an unambiguous
  instant.
- Duplicate-event prevention, already layered three ways:
  1. A DB query for existing `confirmed` `calendarBookings` overlapping the
     requested time range, checked before creating.
  2. A live Google Calendar free/busy re-check immediately before creation,
     to close the race between slot suggestion and user confirmation.
  3. A unique DB constraint on `(userId, googleEventId)`.
  4. `syncCrmBookingsToEmberCalendar` upserts into the canonical `events`
     table keyed by the unique `crmBookingId`, so repeated syncs can't
     duplicate rows on the main Calendar page.
- `/api/calendar-crm/parse-schedule`, `/check-availability`,
  `/suggest-slots` — thread-agnostic already; reused unchanged by the new
  compose flow.

## Backend changes

### 1. Extract shared thread-caching helper

The classify-and-upsert-into-`emailThreads` logic currently inlined in
`GET /api/gmail` is extracted into a shared helper (e.g.
`cacheEmailThread(db, userId, timezone, detail)` in a new or existing lib
file) so it can also be used right after sending a brand-new message —
giving the newly sent conversation the same classification and
meeting-detection treatment as any synced thread, and making it show up in
the inbox immediately.

### 2. Extract shared booking-creation helper

The conflict-check + create + audit-log logic currently inlined in
`POST /api/calendar-crm/events` is extracted into a shared
`createCalendarBooking(db, env, userId, input)` helper. Both the existing
endpoint (used by the reply flow, behavior unchanged) and the new
compose-send endpoint call this helper, so there is exactly one
implementation of the duplicate-prevention logic.

### 3. New endpoint: `POST /api/gmail/send`

Sends a brand-new email (`gmailSendReply` reused with no `threadId`), then:

1. Fetches and caches the resulting Gmail thread via the shared helper
   above (step 1), so it's the "related email or conversation thread" and
   appears in the inbox.
2. If the request body includes a confirmed `meeting` payload (title,
   start, end, attendees, description, location, addMeetLink), calls the
   shared `createCalendarBooking` helper with `sourceThreadId` set to the
   newly cached thread's id.
3. If the send succeeds but booking fails (e.g. a conflict appeared between
   slot suggestion and confirmation), the response still reports the send
   as successful with a separate booking error — the email is not
   reversible, so a booking failure must not be reported as if nothing
   happened.

Request/response shape:

```
POST /api/gmail/send
{
  to: string (email),
  subject: string,
  body: string,
  confirmed: true,
  meeting?: {
    title: string,
    start: string (ISO), end: string (ISO),
    attendees: { email: string }[],
    description?: string, location?: string,
    addMeetLink?: boolean,
    allowOutsideWorkingHours?: boolean,
  }
}

-> { sent: true, messageId, threadId, booking: Booking | null, bookingError?: string }
```

Audit logging reuses the existing `EMAIL_SEND` and `CALENDAR_CREATE`
actions — no new audit action types needed.

No schema changes: `calendarBookings.sourceThreadId` is already nullable
and already the right place to record "the related email or conversation
thread"; `attendees` (jsonb) already captures the contact.

## Frontend changes

### 1. Compose button

Added to the Inbox toolbar in `crm.tsx`, next to the existing Gmail refresh
button. Opens the composer dialog in `mode: "new"`.

### 2. Extract `ComposerDialog` component

The current inline "Create draft" dialog and its two confirmation dialogs
(~250 lines inside `crm.tsx`) move to
`apps/web/src/components/crm/composer-dialog.tsx`, parameterized by
`mode: "reply" | "new"`:

- **`mode: "reply"`** — unchanged behavior. Recipient fixed to the thread
  participant, subject forced to `Re: ...`, scheduling section unchanged,
  booking remains a separate manual "Create Calendar event" step decoupled
  from sending, exactly as today. This mode is a lift-and-shift of existing
  code with no behavioral change, to avoid regressing the already-working
  reply flow.
- **`mode: "new"`** — adds editable **To** (validated email address, with a
  `<datalist>` of recent contacts drawn from already-loaded thread senders
  for convenience) and **Subject** fields. The scheduling section behaves
  identically for NL detection / conflict-check / alternative slots
  (debounced 700ms on body changes, same as today), but instead of a
  separate booking button there is an "Attach a calendar invite for this
  time" checkbox — checked by default once an unambiguous slot is
  available, requiring the existing ambiguity-confirmation checkbox first
  when the parsed time is ambiguous. Meeting title defaults to the compose
  Subject field, and attendees default to the typed "To" recipient
  (both editable), mirroring how reply-mode defaults meeting title to the
  thread subject and attendees to the thread sender. The final "Review and send"
  confirmation dialog shows the message **and** the meeting details
  together in one screen. Clicking "Confirm and send" is a single action
  that calls `POST /api/gmail/send` with the optional `meeting` payload —
  sending the email and creating the calendar event together, satisfying
  "confirm the meeting before sending" and "save automatically once sent."
  There is no persisted draft for new-compose (the `suggestedReplies` table
  requires a non-null `threadId`, which doesn't exist pre-send); the draft
  lives only in the dialog's local state until sent or discarded.

`crm.tsx` keeps track of which mode is open and which thread (if any) is
selected, and renders `<ComposerDialog mode={...} thread={...} ... />`.
`/m/crm.tsx` gets this for free since it renders the same `CrmDashboard`.

### 3. Query invalidation

On success: invalidate `["crm","threads"]`, `["crm","stats"]` (new thread
appears, may get reclassified), and `queryKeys.events.all` when a booking
was created (main Calendar page picks it up) — same pattern the app
already uses elsewhere.

## Error handling

- Send failure: nothing else happens; error surfaces in the confirmation
  dialog, same UX as the existing reply-send error handling.
- Send succeeds, booking fails: message stays sent; a distinct notice tells
  the user the calendar event could not be created and why, so they can add
  it manually from the Calendar page instead of assuming the whole action
  failed.

## Testing

- Backend: extend `apps/api/test/crm.test.ts` (already covers gmail /
  calendar-crm routes) with cases for `POST /api/gmail/send` — happy path
  with and without a `meeting` payload, and a conflicting-time case
  asserting the booking is rejected (and the email is still reported as
  sent).
- Frontend: manual verification via the dev server — Compose → type a
  message containing a natural-language time → verify conflict
  check/alternative slots appear → confirm and send → verify the new
  thread appears in the inbox and the event appears on the main Calendar
  page, with no duplicate event on a second identical attempt.
