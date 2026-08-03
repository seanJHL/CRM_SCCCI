import { api, getApiUrl } from "@/lib/api";

export type EmailCategory =
  | "billing"
  | "scheduling"
  | "urgent"
  | "support"
  | "newsletter"
  | "general";
export type EmailPriority = "critical" | "high" | "normal" | "low";
export type EmailStatus =
  | "unread"
  | "read"
  | "replied"
  | "scheduled"
  | "archived"
  | "dismissed";

export interface CrmUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  workingHoursStart: string;
  workingHoursEnd: string;
}

export interface GoogleConnection {
  connected: boolean;
  email?: string;
  scopes?: string;
  capabilities: {
    gmailRead: boolean;
    gmailSend: boolean;
    calendarEvents: boolean;
    calendarAvailability: boolean;
  };
}

export interface SessionData {
  user: CrmUser;
  google: GoogleConnection;
}

export interface EmailThread {
  id: string;
  userId: string;
  gmailThreadId: string;
  subject: string | null;
  snippet: string | null;
  fromEmail: string | null;
  fromName: string | null;
  lastMessageDate: string | null;
  category: EmailCategory;
  categoryManuallySet: boolean;
  priority: EmailPriority;
  priorityManuallySet: boolean;
  requiresResponse: boolean;
  status: EmailStatus;
  importanceReason: string | null;
  hasUnread: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  labelIds: string[];
  bodyText: string;
  from: string;
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  date: string;
  internalDate: string;
}

export interface SuggestedReply {
  id: string;
  body: string;
  status: "draft" | "approved" | "sent";
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
}

export interface ThreadDetailData {
  thread: {
    id: string;
    messages: GmailMessage[];
    subject: string;
    fromName: string;
    fromEmail: string;
    snippet: string;
    lastMessageDate: string;
    hasUnread: boolean;
  };
  classification: {
    category: EmailCategory;
    priority: EmailPriority;
    requiresResponse: boolean;
    importanceReasons: string[];
    hasUnread: boolean;
    status: EmailStatus;
  } | null;
  replies: SuggestedReply[];
  meetingRequests: MeetingRequest[];
  stale?: boolean;
}

export interface GmailStats {
  total: number;
  unread: number;
  urgent: number;
  requiresResponse: number;
  byCategory: Record<EmailCategory, number>;
  byStatus: Record<EmailStatus, number>;
}

export interface MeetingRequest {
  id: string;
  threadId: string | null;
  rawText: string | null;
  parsedStart: string | null;
  parsedEnd: string | null;
  timezone: string | null;
  durationMinutes: number | null;
  status: string;
  suggestedSlots: unknown;
  createdAt: string;
}

export interface MeetingRequestListItem {
  request: MeetingRequest;
  thread: EmailThread | null;
}

export interface ParsedSchedule {
  start: string;
  end: string;
  durationMinutes: number;
  isAmbiguous: boolean;
  ambiguityReason: string | null;
  interpretation: string;
  matchedText: string;
}

export interface BusySlot {
  start: string;
  end: string;
  calendarId?: string;
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

export interface GoogleCalendarEvent {
  id: string;
  htmlLink: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: { dateTime: string | null; date: string | null };
  end: { dateTime: string | null; date: string | null };
  attendees: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }> | null;
  hangoutLink: string | null;
  status: string;
}

export interface CalendarBooking {
  id: string;
  googleEventId: string | null;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  attendees: Array<{ email: string }> | null;
  meetLink: string | null;
  location: string | null;
  sourceThreadId: string | null;
  status: "confirmed" | "cancelled";
  createdAt: string;
}

export interface CalendarData {
  events: GoogleCalendarEvent[];
  bookings: CalendarBooking[];
}

export interface PrivacySummary {
  summary: {
    emailThreads: number;
    suggestedReplies: number;
    meetingRequests: number;
    calendarBookings: number;
    auditLogs: number;
  };
  description: string;
}

export interface AuditLog {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: unknown;
  createdAt: string;
}

export function loadSession(): Promise<SessionData> {
  return api.get<SessionData>("/api/auth/me");
}

export function googleSignInUrl(): string {
  return getApiUrl("/api/auth/google");
}
