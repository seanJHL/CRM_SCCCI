/**
 * Gmail and Google Calendar API wrappers using fetch().
 * All functions accept a pre-validated access token (from getValidAccessToken).
 */

import { ApiError } from "@/lib/utils";

// --- Types ---

export interface GmailThreadSummary {
  id: string;
  snippet: string;
  historyId: string;
}

export interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  labelIds: string[];
  headers: GmailMessageHeader[];
  bodyText: string;
  bodyHtml: string | null;
  from: string;
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
  inReplyTo: string | null;
  references: string | null;
  internalDate: string;
}

export interface GmailThreadDetail {
  id: string;
  messages: GmailMessage[];
  lastMessage: GmailMessage;
  subject: string;
  from: string;
  fromName: string;
  fromEmail: string;
  snippet: string;
  lastMessageDate: Date;
  hasUnread: boolean;
}

export interface GCalEvent {
  id: string;
  htmlLink: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: { dateTime: string | null; date: string | null };
  end: { dateTime: string | null; date: string | null };
  attendees: { email: string; displayName?: string; responseStatus?: string }[] | null;
  hangoutLink: string | null;
  conferenceData?: { entryPoints: { uri: string; label?: string }[] } | null;
  status: string;
}

export interface BusySlot {
  start: string;
  end: string;
  calendarId?: string;
}

export interface CalendarBusyResult {
  calendarId: string;
  busy: BusySlot[];
  available: boolean;
  error?: string;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO datetime
  end: string; // ISO datetime
  attendees?: { email: string }[];
  addMeetLink?: boolean;
  sourceThreadId?: string;
}

export interface CreateEventResult {
  id: string;
  htmlLink: string;
  hangoutLink: string | null;
}

interface GmailPayloadPart {
  body?: { data?: string };
  mimeType?: string;
  parts?: GmailPayloadPart[];
}

// --- Gmail API ---

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * List recent Gmail threads.
 */
export async function gmailListThreads(
  accessToken: string,
  maxResults = 50,
): Promise<GmailThreadSummary[]> {
  const res = await fetchGoogleRead(
    `${GMAIL_BASE}/threads?maxResults=${maxResults}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!res.ok) {
    await throwGoogleApiError(res, "Gmail", "list threads");
  }

  const data = await res.json() as { threads?: GmailThreadSummary[] };
  return data.threads ?? [];
}

/**
 * Get a full thread with all messages, parsed headers and body.
 */
export async function gmailGetThread(
  accessToken: string,
  threadId: string,
): Promise<GmailThreadDetail> {
  const res = await fetchGoogleRead(
    `${GMAIL_BASE}/threads/${encodeURIComponent(threadId)}?format=full`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!res.ok) {
    await throwGoogleApiError(res, "Gmail", "load thread");
  }

  const raw = await res.json() as {
    id: string;
    messages: {
      id: string;
      threadId: string;
      snippet: string;
      labelIds: string[];
      payload: {
        headers: { name: string; value: string }[];
        body?: { data?: string };
        parts?: GmailPayloadPart[];
        mimeType?: string;
      };
      internalDate: string;
    }[];
  };

  const messages: GmailMessage[] = raw.messages.map((msg) => {
    const headers = msg.payload?.headers ?? [];
    const get = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

    const bodyText = cleanEmailText(extractMessageBody(msg.payload));
    const bodyHtml = extractMessageHtml(msg.payload);

    const from = get("From");
    const { name, email } = parseFromHeader(from);

    return {
      id: msg.id,
      threadId: msg.threadId,
      snippet: msg.snippet,
      labelIds: msg.labelIds ?? [],
      headers,
      bodyText,
      bodyHtml,
      from,
      fromName: name,
      fromEmail: email,
      to: get("To"),
      subject: get("Subject"),
      date: get("Date"),
      messageId: get("Message-ID"),
      inReplyTo: get("In-Reply-To") || null,
      references: get("References") || null,
      internalDate: msg.internalDate,
    };
  });

  const lastMessage = messages[messages.length - 1] ?? messages[0];
  const { name, email } = parseFromHeader(lastMessage?.from ?? "");
  const hasUnread = messages.some((m) => m.labelIds.includes("UNREAD"));

  return {
    id: raw.id,
    messages,
    lastMessage: lastMessage!,
    subject: lastMessage?.subject ?? "",
    from: lastMessage?.from ?? "",
    fromName: name,
    fromEmail: email,
    snippet: lastMessage?.snippet ?? "",
    lastMessageDate: new Date(Number(lastMessage?.internalDate ?? Date.now())),
    hasUnread,
  };
}

export interface GmailSendResult {
  id: string;
  threadId: string;
}

/**
 * Send a reply email via Gmail.
 * Builds an RFC 2822 message with threading headers.
 */
export async function gmailSendReply(
  accessToken: string,
  params: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
    inReplyTo?: string | null;
    references?: string | null;
  },
): Promise<GmailSendResult> {
  const { to, subject, body, threadId, inReplyTo, references } = params;
  const safeTo = sanitiseMailHeader(to);
  const safeSubject = sanitiseMailHeader(subject);
  const safeInReplyTo = inReplyTo ? sanitiseMailHeader(inReplyTo) : null;
  const safeReferences = references ? sanitiseMailHeader(references) : null;

  const headers: string[] = [
    `To: ${safeTo}`,
    `Subject: ${safeSubject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ];

  if (safeInReplyTo) headers.push(`In-Reply-To: ${safeInReplyTo}`);
  if (safeReferences) headers.push(`References: ${safeReferences}`);

  const rawMessage = `${headers.join("\r\n")}\r\n\r\n${body}`;
  const encoded = Buffer.from(rawMessage, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const payload: Record<string, unknown> = { raw: encoded };
  if (threadId) payload.threadId = threadId;

  const res = await fetch(`${GMAIL_BASE}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    await throwGoogleApiError(res, "Gmail", "send reply");
  }

  return res.json();
}

// --- Google Calendar API ---

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

/**
 * List events from the user's primary calendar.
 */
export async function calendarListEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  calendarId = "primary",
): Promise<GCalEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });

  const res = await fetch(
    `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) {
    await throwGoogleApiError(res, "Google Calendar", "list events");
  }

  const data = await res.json() as { items?: GCalEvent[] };
  return (data.items ?? []).filter((e) => e.status !== "cancelled");
}

/**
 * Query free/busy information for a time range.
 */
export async function calendarFreeBusy(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  calendarIds: string[] = ["primary"],
  timeZone?: string,
): Promise<CalendarBusyResult[]> {
  const res = await fetch(`${CAL_BASE}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      ...(timeZone ? { timeZone } : {}),
      items: calendarIds.map((id) => ({ id })),
    }),
  });

  if (!res.ok) {
    await throwGoogleApiError(res, "Google Calendar", "check availability");
  }

  const data = await res.json() as {
    calendars?: Record<
      string,
      { busy?: BusySlot[]; errors?: Array<{ reason?: string; domain?: string }> }
    >;
  };

  return calendarIds.map((calendarId) => {
    const calendar = data.calendars?.[calendarId];
    const error = calendar?.errors?.map((item) => item.reason).filter(Boolean).join(", ");
    const busy = (calendar?.busy ?? []).map((slot) => ({
      ...slot,
      calendarId,
    }));
    return {
      calendarId,
      busy,
      available: !error && busy.length === 0,
      ...(error ? { error } : {}),
    };
  });
}

/**
 * Create a calendar event.
 */
export async function calendarCreateEvent(
  accessToken: string,
  input: CreateEventInput,
): Promise<CreateEventResult> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? "",
    location: input.location ?? "",
    start: { dateTime: input.start },
    end: { dateTime: input.end },
    attendees: input.attendees ?? [],
  };

  if (input.addMeetLink) {
    body.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const params = new URLSearchParams({ sendUpdates: "all" });
  if (input.addMeetLink) params.set("conferenceDataVersion", "1");

  const res = await fetch(
    `${CAL_BASE}/calendars/primary/events?${params}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    await throwGoogleApiError(res, "Google Calendar", "create event");
  }

  const data = await res.json() as Partial<GCalEvent>;
  return {
    id: data.id ?? "",
    htmlLink: data.htmlLink ?? "",
    hangoutLink: data.hangoutLink ?? null,
  };
}

/**
 * Update an existing calendar event.
 */
export async function calendarUpdateEvent(
  accessToken: string,
  eventId: string,
  updates: {
    summary?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    attendees?: { email: string }[];
  },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (updates.summary) body.summary = updates.summary;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.location !== undefined) body.location = updates.location;
  if (updates.start) body.start = { dateTime: updates.start };
  if (updates.end) body.end = { dateTime: updates.end };
  if (updates.attendees) body.attendees = updates.attendees;

  const res = await fetch(
    `${CAL_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    await throwGoogleApiError(res, "Google Calendar", "update event");
  }
}

/**
 * Delete (cancel) a calendar event.
 */
export async function calendarDeleteEvent(
  accessToken: string,
  eventId: string,
): Promise<void> {
  const res = await fetch(
    `${CAL_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  // Deletion is idempotent: an already removed Google event is the desired
  // final state and must not block local CRM/Ember cleanup.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    await throwGoogleApiError(res, "Google Calendar", "cancel event");
  }
}

// --- Helpers ---

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const paddedCorrect = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  return Buffer.from(paddedCorrect, "base64").toString("utf-8");
}

function extractMessageBody(payload: GmailPayloadPart): string {
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    return payload.mimeType === "text/html" ? htmlToText(decoded) : decoded.trim();
  }

  const parts = payload.parts ?? [];
  const plainBodies = flattenParts(parts)
    .filter((part) => part.mimeType === "text/plain" && part.body?.data)
    .map((part) => decodeBase64Url(part.body!.data!).trim())
    .filter(Boolean);
  if (plainBodies.length > 0) return plainBodies.join("\n\n");

  const htmlBodies = flattenParts(parts)
    .filter((part) => part.mimeType === "text/html" && part.body?.data)
    .map((part) => htmlToText(decodeBase64Url(part.body!.data!)))
    .filter(Boolean);
  return htmlBodies.join("\n\n");
}

/**
 * Extract the raw `text/html` part of a message, undecoded beyond base64 —
 * unlike extractMessageBody, this is real markup meant for sanitized HTML
 * rendering (not a plain-text approximation), so no tag-stripping happens.
 */
function extractMessageHtml(payload: GmailPayloadPart): string | null {
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  const htmlPart = flattenParts(payload.parts ?? []).find(
    (part) => part.mimeType === "text/html" && part.body?.data,
  );
  return htmlPart ? decodeBase64Url(htmlPart.body!.data!) : null;
}

function flattenParts(parts: GmailPayloadPart[]): GmailPayloadPart[] {
  return parts.flatMap((part) => [part, ...flattenParts(part.parts ?? [])]);
}

function htmlToText(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

/** Remove remote-image placeholders and tracking URLs from plain-text bodies. */
function cleanEmailText(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const visible: string[] = [];
  let skippingRemoteAsset = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const next = lines[index + 1]?.trim() ?? "";

    if (skippingRemoteAsset) {
      if (trimmed.endsWith(")")) skippingRemoteAsset = false;
      continue;
    }
    if (/\($/.test(trimmed) && /^https?:\/\//i.test(next)) {
      skippingRemoteAsset = true;
      continue;
    }
    if (
      /^https?:\/\//i.test(trimmed) &&
      (trimmed.length > 90 || /(?:ablink|click|track|utm_|mc_[ce]id|trk)/i.test(trimmed))
    ) {
      continue;
    }

    const cleanedLine = line
      .replace(/https?:\/\/\S*(?:ablink|click|track|utm_|mc_[ce]id|trk)\S*/gi, "")
      .replace(/https?:\/\/\S{120,}/gi, "")
      .trimEnd();
    if (cleanedLine.trim() || visible.at(-1)?.trim()) visible.push(cleanedLine);
  }

  return visible.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitiseMailHeader(value: string): string {
  return value.replace(/[\r\n\0]+/g, " ").trim();
}

async function throwGoogleApiError(
  response: Response,
  service: string,
  operation: string,
): Promise<never> {
  const raw = await readLimitedText(response, 64 * 1024);
  let reason = response.statusText;
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    reason =
      parsed.error?.errors?.[0]?.reason ??
      parsed.error?.message ??
      response.statusText;
  } catch {
    // Keep the status text when Google returns a non-JSON error page.
  }

  if (response.status === 401) {
    throw new ApiError(
      401,
      "GOOGLE_REAUTH_REQUIRED",
      `${service} access expired or was revoked. Please reconnect Google.`,
    );
  }
  if (response.status === 403) {
    throw new ApiError(
      403,
      "GOOGLE_PERMISSION_REQUIRED",
      `${service} permission is missing for this action. Please reconnect Google and approve access.`,
      { operation, reason },
    );
  }
  if (response.status === 404) {
    throw ApiError.notFound(`${service} resource was not found`);
  }
  if (response.status === 429) {
    throw new ApiError(
      429,
      "GOOGLE_RATE_LIMITED",
      `${service} is temporarily rate limited. Please try again shortly.`,
    );
  }
  throw new ApiError(
    502,
    "GOOGLE_API_ERROR",
    `${service} could not ${operation}. Please try again.`,
    { status: response.status, reason },
  );
}

/** Retry idempotent Google reads for rate limits and transient upstream errors. */
async function fetchGoogleRead(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const delays = [200, 600];
  let response = await fetch(input, init);

  for (const delay of delays) {
    if (!isTransientGoogleStatus(response.status)) return response;
    await response.body?.cancel();
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    response = await fetch(input, init);
  }

  return response;
}

function isTransientGoogleStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function readLimitedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - received;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      received += chunk.byteLength;
      text += decoder.decode(chunk, { stream: received < maxBytes });
      if (value.byteLength > remaining) break;
    }
    text += decoder.decode();
    return text;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function parseFromHeader(from: string): { name: string; email: string } {
  const match = from.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].replace(/"/g, "").trim() || match[2],
      email: match[2],
    };
  }
  // Just an email address
  const emailMatch = from.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return {
    name: "",
    email: emailMatch?.[0] ?? from,
  };
}
