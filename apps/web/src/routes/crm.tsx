import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  Check,
  ChevronRight,
  Database,
  ExternalLink,
  Inbox,
  Info,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unplug,
  Video,
} from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import {
  type AuditLog,
  type AvailabilityResult,
  type CalendarBooking,
  type CalendarData,
  type EmailCategory,
  type EmailPriority,
  type EmailStatus,
  type EmailThread,
  type GmailStats,
  type MeetingRequestListItem,
  type ParsedSchedule,
  type PrivacySummary,
  type SessionData,
  type SuggestedReply,
  type SuggestedSlot,
  type ThreadDetailData,
  googleSignInUrl,
  loadSession,
} from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/crm")({
  beforeLoad: async () => {
    let session: SessionData;
    try {
      session = await loadSession();
    } catch {
      throw redirect({ to: "/login", search: { error: undefined } });
    }
    if (!session.google.connected) {
      throw redirect({ to: "/login", search: { error: undefined } });
    }
    return { session };
  },
  component: CrmDashboard,
});

type DashboardView = "inbox" | "schedule" | "meetings" | "privacy";
type AccountAction = "disconnect" | "delete" | "logout" | null;

const CATEGORIES: EmailCategory[] = [
  "general",
  "urgent",
  "scheduling",
  "billing",
  "support",
  "newsletter",
];
const PRIORITIES: EmailPriority[] = ["critical", "high", "normal", "low"];
const STATUSES: EmailStatus[] = [
  "unread",
  "read",
  "replied",
  "scheduled",
  "archived",
  "dismissed",
];

function CrmDashboard() {
  const { session: initialSession } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [view, setView] = useState<DashboardView>("inbox");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");
  const [sender, setSender] = useState("");
  const [responseOnly, setResponseOnly] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [replyBody, setReplyBody] = useState("");
  const [replyDraftId, setReplyDraftId] = useState<string | null>(null);
  const [sendConfirmationOpen, setSendConfirmationOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ["crm", "session"],
    queryFn: loadSession,
    initialData: initialSession,
  });
  const session = sessionQuery.data;

  const filters = { category, priority, status, sender, responseOnly };
  const threadsQuery = useQuery({
    queryKey: ["crm", "threads", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (priority) params.set("priority", priority);
      if (status) params.set("status", status);
      if (sender.trim()) params.set("sender", sender.trim());
      if (responseOnly) params.set("requiresResponse", "true");
      return api.get<{ threads: EmailThread[]; cached: boolean }>(
        `/api/gmail?${params}`,
      );
    },
  });
  const statsQuery = useQuery({
    queryKey: ["crm", "stats"],
    queryFn: () => api.get<{ stats: GmailStats }>("/api/gmail/stats"),
  });
  const calendarQuery = useQuery({
    queryKey: ["crm", "calendar"],
    queryFn: () => api.get<CalendarData>("/api/calendar-crm/events"),
  });
  const meetingRequestsQuery = useQuery({
    queryKey: ["crm", "meeting-requests"],
    queryFn: () =>
      api.get<{ meetingRequests: MeetingRequestListItem[] }>(
        "/api/gmail/meeting-requests",
      ),
  });
  const threadDetailQuery = useQuery({
    queryKey: ["crm", "thread", selectedThreadId],
    queryFn: () =>
      api.get<ThreadDetailData>(`/api/gmail/${selectedThreadId}`),
    enabled: Boolean(selectedThreadId),
  });

  const threads = threadsQuery.data?.threads ?? [];
  const selectedThread = threads.find(
    (thread) => thread.gmailThreadId === selectedThreadId,
  );

  useEffect(() => {
    const latestDraft = threadDetailQuery.data?.replies.find(
      (reply) => reply.status !== "sent",
    );
    setReplyBody(latestDraft?.body ?? "");
    setReplyDraftId(latestDraft?.id ?? null);
  }, [selectedThreadId, threadDetailQuery.data?.replies]);

  const invalidateInbox = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["crm", "threads"] }),
      queryClient.invalidateQueries({ queryKey: ["crm", "stats"] }),
      queryClient.invalidateQueries({ queryKey: ["crm", "thread"] }),
      queryClient.invalidateQueries({ queryKey: ["crm", "meeting-requests"] }),
    ]);
  };

  const syncMutation = useMutation({
    mutationFn: () =>
      api.get<{ threads: EmailThread[] }>("/api/gmail?refresh=true"),
    onSuccess: async () => {
      setNotice("Gmail is up to date.");
      await invalidateInbox();
    },
  });
  const updateThreadMutation = useMutation({
    mutationFn: (input: {
      threadId: string;
      updates: Partial<Pick<EmailThread, "category" | "priority" | "status">>;
    }) => api.patch(`/api/gmail/${input.threadId}`, input.updates),
    onSuccess: invalidateInbox,
  });
  const generateReplyMutation = useMutation({
    mutationFn: (regenerate: boolean) =>
      api.post<{ reply: SuggestedReply }>(
        `/api/gmail/${selectedThreadId}/reply`,
        { regenerate, currentBody: replyBody },
      ),
    onSuccess: (data) => {
      setReplyBody(data.reply.body);
      setReplyDraftId(data.reply.id);
      setNotice("A reviewable draft was generated. Nothing has been sent.");
    },
  });
  const sendReplyMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/gmail/${selectedThreadId}/reply/send`, {
        body: replyBody,
        to: selectedThread?.fromEmail ?? undefined,
        draftId: replyDraftId ?? undefined,
        confirmed: true,
      }),
    onSuccess: async () => {
      setSendConfirmationOpen(false);
      setNotice("Reply sent through Gmail.");
      await invalidateInbox();
    },
  });
  const bulkClassifyMutation = useMutation({
    mutationFn: () => api.post("/api/gmail/bulk/classify", {}),
    onSuccess: async () => {
      setNotice("Cached threads were reclassified.");
      await invalidateInbox();
    },
  });
  const bulkUpdateMutation = useMutation({
    mutationFn: (updates: { status: EmailStatus }) =>
      api.post("/api/gmail/bulk/update", {
        threadIds: [...selectedThreadIds],
        updates,
      }),
    onSuccess: async () => {
      setSelectedThreadIds(new Set());
      await invalidateInbox();
    },
  });
  const bulkDraftMutation = useMutation({
    mutationFn: () =>
      api.post<{ generated: number }>("/api/gmail/bulk/replies", {
        threadIds: [...selectedThreadIds],
      }),
    onSuccess: async (data) => {
      setNotice(`${data.generated} reviewable drafts generated. No emails were sent.`);
      setSelectedThreadIds(new Set());
      await invalidateInbox();
    },
  });

  const [scheduleText, setScheduleText] = useState("");
  const [parsedSchedule, setParsedSchedule] = useState<ParsedSchedule | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [suggestedSlots, setSuggestedSlots] = useState<SuggestedSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SuggestedSlot | null>(null);
  const [ambiguityConfirmed, setAmbiguityConfirmed] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDescription, setMeetingDescription] = useState("");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [attendeeText, setAttendeeText] = useState("");
  const [addMeetLink, setAddMeetLink] = useState(false);
  const [sourceThreadId, setSourceThreadId] = useState<string | null>(null);
  const [editingBooking, setEditingBooking] = useState<CalendarBooking | null>(null);
  const [bookingConfirmationOpen, setBookingConfirmationOpen] = useState(false);

  const attendeeEmails = useMemo(
    () =>
      attendeeText
        .split(/[;,]/)
        .map((email) => email.trim())
        .filter(Boolean),
    [attendeeText],
  );

  const parseScheduleMutation = useMutation({
    mutationFn: async () => {
      const parsed = await api.post<{
        detected: boolean;
        parsed: ParsedSchedule | null;
        message?: string;
      }>("/api/calendar-crm/parse-schedule", { text: scheduleText });
      if (!parsed.parsed) return { parsed, availability: null, slots: [] };
      const participants = attendeeEmails;
      const [checked, slots] = await Promise.all([
        api.post<AvailabilityResult>("/api/calendar-crm/check-availability", {
          start: parsed.parsed.start,
          end: parsed.parsed.end,
          participantEmails: participants,
        }),
        api.post<{ slots: SuggestedSlot[] }>("/api/calendar-crm/suggest-slots", {
          start: parsed.parsed.start,
          durationMinutes: parsed.parsed.durationMinutes,
          participantEmails: participants,
        }),
      ]);
      return { parsed, availability: checked, slots: slots.slots };
    },
    onSuccess: ({ parsed, availability: checked, slots }) => {
      setParsedSchedule(parsed.parsed);
      setAvailability(checked);
      setAmbiguityConfirmed(false);
      const requested =
        parsed.parsed && checked?.available
          ? [
              {
                start: parsed.parsed.start,
                end: parsed.parsed.end,
                label: parsed.parsed.interpretation,
              },
            ]
          : [];
      const unique = [...requested, ...slots].filter(
        (slot, index, all) =>
          all.findIndex((candidate) => candidate.start === slot.start) === index,
      );
      setSuggestedSlots(unique);
      setSelectedSlot(unique[0] ?? null);
      if (!parsed.parsed) setNotice(parsed.message ?? "No specific date and time found.");
    },
  });

  const bookingMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error("Select a time slot first");
      const common = {
        title: meetingTitle.trim() || "Meeting",
        start: selectedSlot.start,
        end: selectedSlot.end,
        attendees: attendeeEmails.map((email) => ({ email })),
        description: meetingDescription.trim() || undefined,
        location: meetingLocation.trim() || undefined,
        confirmed: true as const,
      };
      if (editingBooking) {
        return api.patch(`/api/calendar-crm/events/${editingBooking.id}`, common);
      }
      return api.post("/api/calendar-crm/events", {
        ...common,
        addMeetLink,
        sourceThreadId: sourceThreadId ?? undefined,
      });
    },
    onSuccess: async () => {
      setBookingConfirmationOpen(false);
      setNotice(editingBooking ? "Calendar event updated." : "Calendar event created and invitations sent.");
      setEditingBooking(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["crm", "calendar"] }),
        invalidateInbox(),
      ]);
      setView("meetings");
    },
  });
  const [cancelBooking, setCancelBooking] = useState<CalendarBooking | null>(null);
  const cancelBookingMutation = useMutation({
    mutationFn: () =>
      api.delete(`/api/calendar-crm/events/${cancelBooking!.id}`, {
        confirmed: true,
      }),
    onSuccess: async () => {
      setCancelBooking(null);
      setNotice("Calendar event cancelled and attendees notified.");
      await queryClient.invalidateQueries({ queryKey: ["crm", "calendar"] });
    },
  });

  const openScheduleForThread = (thread: EmailThread) => {
    setView("schedule");
    setScheduleText(`${thread.subject ?? "Meeting request"}. ${thread.snippet ?? ""}`);
    setMeetingTitle(thread.subject ?? "Meeting");
    setMeetingDescription(
      `Scheduled from Gmail thread: ${thread.subject ?? "Untitled conversation"}\n\nEmail context: ${thread.snippet ?? ""}`,
    );
    setAttendeeText(thread.fromEmail ?? "");
    setSourceThreadId(thread.id);
    setEditingBooking(null);
    resetScheduleResults();
  };
  const openScheduleForRequest = (item: MeetingRequestListItem) => {
    if (item.thread) openScheduleForThread(item.thread);
    else {
      setView("schedule");
      setScheduleText(item.request.rawText ?? "");
      resetScheduleResults();
    }
  };
  const openReschedule = (booking: CalendarBooking) => {
    setEditingBooking(booking);
    setView("schedule");
    setMeetingTitle(booking.title);
    setMeetingDescription(booking.description ?? "");
    setMeetingLocation(booking.location ?? "");
    setAttendeeText(booking.attendees?.map((item) => item.email).join(", ") ?? "");
    setScheduleText(`Reschedule ${booking.title} near ${formatDateTime(booking.startAt, session.user.timezone)}`);
    resetScheduleResults();
  };
  const resetScheduleResults = () => {
    setParsedSchedule(null);
    setAvailability(null);
    setSuggestedSlots([]);
    setSelectedSlot(null);
    setAmbiguityConfirmed(false);
  };

  const [accountAction, setAccountAction] = useState<AccountAction>(null);
  const accountMutation = useMutation({
    mutationFn: async (action: Exclude<AccountAction, null>) => {
      if (action === "logout") return api.post("/api/auth/logout", {});
      if (action === "disconnect") return api.post("/api/auth/disconnect", {});
      return api.delete("/api/privacy/data", {});
    },
    onSuccess: () => {
      window.location.assign("/login");
    },
  });
  const profileMutation = useMutation({
    mutationFn: (profile: {
      timezone: string;
      workingHoursStart: string;
      workingHoursEnd: string;
    }) => api.patch("/api/auth/me", profile),
    onSuccess: async () => {
      setNotice("Scheduling preferences saved.");
      await queryClient.invalidateQueries({ queryKey: ["crm", "session"] });
    },
  });

  const topError = firstError(
    threadsQuery.error,
    statsQuery.error,
    calendarQuery.error,
    meetingRequestsQuery.error,
    syncMutation.error,
    updateThreadMutation.error,
    generateReplyMutation.error,
    sendReplyMutation.error,
    parseScheduleMutation.error,
    bookingMutation.error,
    cancelBookingMutation.error,
    accountMutation.error,
  );
  const reauthRequired =
    topError instanceof ApiClientError &&
    ["GOOGLE_REAUTH_REQUIRED", "GOOGLE_PERMISSION_REQUIRED"].includes(topError.code);

  return (
    <div className="min-h-screen bg-[#f5f7f6] text-[#17221d]">
      <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#183d2c] text-sm font-bold text-white">S</span>
            <div>
              <p className="text-sm font-semibold leading-none">SCCCI CRM</p>
              <p className="mt-1 text-[11px] text-black/40">Gmail + Calendar workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full bg-[#e8f5ec] px-3 py-1.5 text-xs font-medium text-[#24633d] sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3a9b62]" />
              {session.google.email} connected
            </span>
            {session.user.avatarUrl ? (
              <img src={session.user.avatarUrl} alt="" className="h-9 w-9 rounded-full border border-black/10" referrerPolicy="no-referrer" />
            ) : (
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#e7ece9] text-xs font-semibold">{session.user.name.slice(0, 1).toUpperCase()}</span>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-black/[0.06] bg-white p-3 lg:sticky lg:top-[84px] lg:h-[calc(100vh-104px)]">
          <nav className="grid grid-cols-4 gap-1 lg:grid-cols-1">
            <NavButton active={view === "inbox"} icon={Inbox} label="Inbox" count={statsQuery.data?.stats.requiresResponse} onClick={() => setView("inbox")} />
            <NavButton active={view === "schedule"} icon={Sparkles} label="Schedule" onClick={() => setView("schedule")} />
            <NavButton active={view === "meetings"} icon={CalendarDays} label="Meetings" count={calendarQuery.data?.bookings.filter((item) => item.status === "confirmed").length} onClick={() => setView("meetings")} />
            <NavButton active={view === "privacy"} icon={ShieldCheck} label="Privacy" onClick={() => setView("privacy")} />
          </nav>
          <div className="mt-4 hidden rounded-xl bg-[#f3f6f4] p-4 lg:block">
            <p className="text-xs font-semibold">Safety controls</p>
            <p className="mt-2 text-xs leading-5 text-black/45">Replies and calendar changes always stop for your confirmation.</p>
          </div>
          <button type="button" onClick={() => setAccountAction("logout")} className="mt-3 hidden w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-black/50 hover:bg-black/[0.04] lg:flex">
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </aside>

        <main className="min-w-0">
          {notice && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-[#bfe3ca] bg-[#edf8f0] px-4 py-3 text-sm text-[#215a38]">
              <span className="flex items-center gap-2"><Check className="h-4 w-4" />{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
            </div>
          )}
          {Boolean(topError) && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{errorMessage(topError)}</span>
              {reauthRequired && <a href={googleSignInUrl()} className="font-semibold underline">Reconnect Google</a>}
            </div>
          )}

          {view === "inbox" && (
            <InboxView
              threads={threads}
              loading={threadsQuery.isLoading}
              stats={statsQuery.data?.stats}
              category={category}
              priority={priority}
              status={status}
              sender={sender}
              responseOnly={responseOnly}
              onCategory={setCategory}
              onPriority={setPriority}
              onStatus={setStatus}
              onSender={setSender}
              onResponseOnly={setResponseOnly}
              selectedThreadId={selectedThreadId}
              onSelectThread={setSelectedThreadId}
              selectedIds={selectedThreadIds}
              onToggleSelected={(id) => setSelectedThreadIds((current) => toggleSet(current, id))}
              onSync={() => syncMutation.mutate()}
              syncing={syncMutation.isPending}
              onBulkClassify={() => bulkClassifyMutation.mutate()}
              onBulkArchive={() => bulkUpdateMutation.mutate({ status: "archived" })}
              onBulkDraft={() => bulkDraftMutation.mutate()}
              bulkPending={bulkUpdateMutation.isPending || bulkDraftMutation.isPending || bulkClassifyMutation.isPending}
              detail={threadDetailQuery.data}
              detailLoading={threadDetailQuery.isLoading}
              selectedThread={selectedThread}
              onUpdate={(updates) => selectedThreadId && updateThreadMutation.mutate({ threadId: selectedThreadId, updates })}
              onSchedule={() => selectedThread && openScheduleForThread(selectedThread)}
              replyBody={replyBody}
              onReplyBody={setReplyBody}
              onGenerate={(regenerate) => generateReplyMutation.mutate(regenerate)}
              generating={generateReplyMutation.isPending}
              onReviewSend={() => setSendConfirmationOpen(true)}
            />
          )}

          {view === "schedule" && (
            <ScheduleView
              user={session.user}
              scheduleText={scheduleText}
              onScheduleText={(value) => { setScheduleText(value); resetScheduleResults(); }}
              title={meetingTitle}
              onTitle={setMeetingTitle}
              description={meetingDescription}
              onDescription={setMeetingDescription}
              location={meetingLocation}
              onLocation={setMeetingLocation}
              attendees={attendeeText}
              onAttendees={(value) => { setAttendeeText(value); resetScheduleResults(); }}
              addMeetLink={addMeetLink}
              onAddMeetLink={setAddMeetLink}
              parsed={parsedSchedule}
              availability={availability}
              slots={suggestedSlots}
              selectedSlot={selectedSlot}
              onSelectSlot={setSelectedSlot}
              ambiguityConfirmed={ambiguityConfirmed}
              onAmbiguityConfirmed={setAmbiguityConfirmed}
              onAnalyse={() => parseScheduleMutation.mutate()}
              analysing={parseScheduleMutation.isPending}
              onReviewBooking={() => setBookingConfirmationOpen(true)}
              editingBooking={editingBooking}
              onCancelEdit={() => setEditingBooking(null)}
            />
          )}

          {view === "meetings" && (
            <MeetingsView
              calendar={calendarQuery.data}
              meetingRequests={meetingRequestsQuery.data?.meetingRequests ?? []}
              timezone={session.user.timezone}
              loading={calendarQuery.isLoading}
              onScheduleRequest={openScheduleForRequest}
              onReschedule={openReschedule}
              onCancel={setCancelBooking}
            />
          )}

          {view === "privacy" && (
            <PrivacyView
              session={session}
              profilePending={profileMutation.isPending}
              onSaveProfile={(profile) => profileMutation.mutate(profile)}
              onAccountAction={setAccountAction}
            />
          )}
        </main>
      </div>

      <Dialog open={sendConfirmationOpen} onOpenChange={setSendConfirmationOpen}>
        <DialogContent className="max-w-xl p-6">
          <DialogHeader>
            <DialogTitle>Send this reply?</DialogTitle>
            <DialogDescription>Review the final recipient and message. This is the only step that sends email.</DialogDescription>
          </DialogHeader>
          <div className="my-5 rounded-xl bg-[#f5f7f6] p-4 text-sm">
            <p className="font-medium">To: {selectedThread?.fromEmail}</p>
            <p className="mt-3 max-h-60 whitespace-pre-wrap overflow-auto text-black/60">{replyBody}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendConfirmationOpen(false)}>Keep editing</Button>
            <Button onClick={() => sendReplyMutation.mutate()} disabled={!replyBody.trim() || sendReplyMutation.isPending}>
              {sendReplyMutation.isPending ? <Loader2 className="animate-spin" /> : <Send />} Confirm and send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bookingConfirmationOpen} onOpenChange={setBookingConfirmationOpen}>
        <DialogContent className="max-w-lg p-6">
          <DialogHeader>
            <DialogTitle>{editingBooking ? "Update this calendar event?" : "Create this calendar event?"}</DialogTitle>
            <DialogDescription>No Calendar change occurs until you confirm below.</DialogDescription>
          </DialogHeader>
          {selectedSlot && (
            <div className="my-5 space-y-2 rounded-xl bg-[#f5f7f6] p-4 text-sm">
              <p className="font-semibold">{meetingTitle || "Meeting"}</p>
              <p>{formatDateRange(selectedSlot.start, selectedSlot.end, session.user.timezone)}</p>
              {attendeeEmails.length > 0 && <p className="text-black/55">Guests: {attendeeEmails.join(", ")}</p>}
              {addMeetLink && !editingBooking && <p className="text-black/55">Google Meet link requested</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingConfirmationOpen(false)}>Go back</Button>
            <Button onClick={() => bookingMutation.mutate()} disabled={bookingMutation.isPending}>
              {bookingMutation.isPending ? <Loader2 className="animate-spin" /> : <CalendarDays />} Confirm {editingBooking ? "update" : "booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancelBooking)} onOpenChange={(open) => !open && setCancelBooking(null)}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader><DialogTitle>Cancel {cancelBooking?.title}?</DialogTitle><DialogDescription>The Google Calendar event will be cancelled and guests will receive an update.</DialogDescription></DialogHeader>
          <DialogFooter className="mt-6"><Button variant="outline" onClick={() => setCancelBooking(null)}>Keep event</Button><Button variant="destructive" onClick={() => cancelBookingMutation.mutate()} disabled={cancelBookingMutation.isPending}>Confirm cancellation</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(accountAction)} onOpenChange={(open) => !open && setAccountAction(null)}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <DialogTitle>{accountAction === "delete" ? "Delete all stored data?" : accountAction === "disconnect" ? "Disconnect Google?" : "Log out?"}</DialogTitle>
            <DialogDescription>{accountAction === "delete" ? "This revokes Google access and permanently deletes your profile, sessions, encrypted tokens, cached CRM records, bookings, and audit logs." : accountAction === "disconnect" ? "Google access will be revoked, CRM cache cleared, and this session ended." : "Your Google account stays connected; only this session ends."}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6"><Button variant="outline" onClick={() => setAccountAction(null)}>Cancel</Button><Button variant={accountAction === "delete" ? "destructive" : "default"} onClick={() => accountAction && accountMutation.mutate(accountAction)} disabled={accountMutation.isPending}>Confirm</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InboxView(props: {
  threads: EmailThread[];
  loading: boolean;
  stats?: GmailStats;
  category: string;
  priority: string;
  status: string;
  sender: string;
  responseOnly: boolean;
  onCategory: (value: string) => void;
  onPriority: (value: string) => void;
  onStatus: (value: string) => void;
  onSender: (value: string) => void;
  onResponseOnly: (value: boolean) => void;
  selectedThreadId: string | null;
  onSelectThread: (value: string) => void;
  selectedIds: Set<string>;
  onToggleSelected: (value: string) => void;
  onSync: () => void;
  syncing: boolean;
  onBulkClassify: () => void;
  onBulkArchive: () => void;
  onBulkDraft: () => void;
  bulkPending: boolean;
  detail?: ThreadDetailData;
  detailLoading: boolean;
  selectedThread?: EmailThread;
  onUpdate: (updates: Partial<Pick<EmailThread, "category" | "priority" | "status">>) => void;
  onSchedule: () => void;
  replyBody: string;
  onReplyBody: (value: string) => void;
  onGenerate: (regenerate: boolean) => void;
  generating: boolean;
  onReviewSend: () => void;
}) {
  return (
    <section>
      <PageHeading eyebrow="Conversation intelligence" title="Inbox" description="Prioritised Gmail threads with explainable classifications and review-first replies." action={<Button onClick={props.onSync} disabled={props.syncing}>{props.syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync Gmail</Button>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total threads" value={props.stats?.total} icon={Mail} />
        <Metric label="Unread" value={props.stats?.unread} icon={Inbox} />
        <Metric label="Important" value={props.stats?.urgent} icon={AlertTriangle} />
        <Metric label="Needs response" value={props.stats?.requiresResponse} icon={MessageSquare} />
      </div>
      <div className="mt-5 rounded-2xl border border-black/[0.06] bg-white p-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[1fr_160px_140px_150px_auto]">
          <label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-black/35" /><Input value={props.sender} onChange={(event) => props.onSender(event.target.value)} placeholder="Filter sender" className="h-9 pl-9" /></label>
          <FilterSelect label="All categories" value={props.category} values={CATEGORIES} onChange={props.onCategory} />
          <FilterSelect label="All priorities" value={props.priority} values={PRIORITIES} onChange={props.onPriority} />
          <FilterSelect label="All statuses" value={props.status} values={STATUSES} onChange={props.onStatus} />
          <label className="flex h-9 items-center gap-2 rounded-lg border border-black/10 px-3 text-xs"><input type="checkbox" checked={props.responseOnly} onChange={(event) => props.onResponseOnly(event.target.checked)} /> Needs response</label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/[0.06] pt-3">
          <span className="mr-1 text-xs text-black/40">{props.selectedIds.size} selected</span>
          <Button size="sm" variant="outline" onClick={props.onBulkClassify} disabled={props.bulkPending}>Reclassify all</Button>
          <Button size="sm" variant="outline" onClick={props.onBulkDraft} disabled={props.selectedIds.size === 0 || props.bulkPending}><Sparkles /> Generate drafts</Button>
          <Button size="sm" variant="outline" onClick={props.onBulkArchive} disabled={props.selectedIds.size === 0 || props.bulkPending}><Archive /> Archive</Button>
          <span className="text-xs text-black/35">Bulk drafts are never sent automatically.</span>
        </div>
      </div>
      <div className="mt-5 grid min-h-[620px] overflow-hidden rounded-2xl border border-black/[0.06] bg-white xl:grid-cols-[390px_minmax(0,1fr)]">
        <div className="border-b border-black/[0.06] xl:border-b-0 xl:border-r">
          {props.loading ? <LoadingBlock label="Loading Gmail threads…" /> : props.threads.length === 0 ? <EmptyBlock title="No threads match" description="Sync Gmail or clear a filter to see conversations." /> : props.threads.map((thread) => <ThreadRow key={thread.gmailThreadId} thread={thread} active={props.selectedThreadId === thread.gmailThreadId} checked={props.selectedIds.has(thread.gmailThreadId)} onCheck={() => props.onToggleSelected(thread.gmailThreadId)} onOpen={() => props.onSelectThread(thread.gmailThreadId)} />)}
        </div>
        <ThreadDetailPanel {...props} />
      </div>
    </section>
  );
}

function ThreadDetailPanel(props: Parameters<typeof InboxView>[0]) {
  if (!props.selectedThreadId) return <EmptyBlock title="Select a conversation" description="Open a thread to inspect the full context, classification reasons, and reply workspace." />;
  if (props.detailLoading) return <LoadingBlock label="Loading conversation…" />;
  if (!props.detail) return <EmptyBlock title="Conversation unavailable" description="Try syncing Gmail and opening it again." />;
  const classification = props.detail.classification;
  return (
    <div className="min-w-0 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-medium text-black/40">{props.selectedThread?.fromName || props.selectedThread?.fromEmail}</p><h2 className="mt-1 text-xl font-semibold tracking-[-0.025em]">{props.detail.thread.subject || "(No subject)"}</h2></div>
        <Button variant="outline" onClick={props.onSchedule}><CalendarDays /> Schedule</Button>
      </div>
      {classification && <div className="mt-5 grid gap-3 rounded-xl bg-[#f5f7f6] p-4 sm:grid-cols-[1fr_1fr_2fr]">
        <EditableLabel label="Category"><FilterSelect label="Category" value={classification.category} values={CATEGORIES} onChange={(value) => props.onUpdate({ category: value as EmailCategory })} /></EditableLabel>
        <EditableLabel label="Priority"><FilterSelect label="Priority" value={classification.priority} values={PRIORITIES} onChange={(value) => props.onUpdate({ priority: value as EmailPriority })} /></EditableLabel>
        <div><p className="text-[10px] font-semibold uppercase tracking-wider text-black/35">Why it matters</p><ul className="mt-2 space-y-1 text-xs text-black/55">{classification.importanceReasons.length ? classification.importanceReasons.map((reason) => <li key={reason} className="flex gap-2"><Info className="mt-0.5 h-3 w-3 shrink-0" />{reason}</li>) : <li>No elevated importance signals found.</li>}</ul></div>
      </div>}
      <div className="mt-6 max-h-[380px] space-y-3 overflow-y-auto pr-1">{props.detail.thread.messages.map((message) => <article key={message.id} className="rounded-xl border border-black/[0.06] p-4"><div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-semibold">{message.fromName || message.fromEmail}</span><time className="text-black/35">{formatDate(message.internalDate)}</time></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-black/65">{message.bodyText || message.snippet}</p></article>)}</div>
      <div className="mt-7 border-t border-black/[0.07] pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Suggested reply</h3><p className="mt-1 text-xs text-black/40">Generated locally from thread context and editable before confirmation.</p></div><Button size="sm" variant="outline" onClick={() => props.onGenerate(Boolean(props.replyBody))} disabled={props.generating}>{props.generating ? <Loader2 className="animate-spin" /> : <Sparkles />}{props.replyBody ? "Regenerate" : "Generate draft"}</Button></div>
        <Textarea value={props.replyBody} onChange={(event) => props.onReplyBody(event.target.value)} placeholder="Generate a draft or write your reply…" className="mt-4 min-h-44 leading-6" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><FilterSelect label="Update status" value={classification?.status ?? ""} values={STATUSES} onChange={(value) => props.onUpdate({ status: value as EmailStatus })} /><Button onClick={props.onReviewSend} disabled={!props.replyBody.trim()}><Send /> Review and send</Button></div>
      </div>
    </div>
  );
}

function ScheduleView(props: {
  user: SessionData["user"];
  scheduleText: string; onScheduleText: (value: string) => void;
  title: string; onTitle: (value: string) => void;
  description: string; onDescription: (value: string) => void;
  location: string; onLocation: (value: string) => void;
  attendees: string; onAttendees: (value: string) => void;
  addMeetLink: boolean; onAddMeetLink: (value: boolean) => void;
  parsed: ParsedSchedule | null; availability: AvailabilityResult | null;
  slots: SuggestedSlot[]; selectedSlot: SuggestedSlot | null; onSelectSlot: (slot: SuggestedSlot) => void;
  ambiguityConfirmed: boolean; onAmbiguityConfirmed: (value: boolean) => void;
  onAnalyse: () => void; analysing: boolean; onReviewBooking: () => void;
  editingBooking: CalendarBooking | null; onCancelEdit: () => void;
}) {
  const canBook = props.selectedSlot && (!props.parsed?.isAmbiguous || props.ambiguityConfirmed);
  return <section>
    <PageHeading eyebrow="Natural-language scheduling" title={props.editingBooking ? `Reschedule ${props.editingBooking.title}` : "Find a meeting time"} description={`Times are interpreted in ${props.user.timezone}; working hours are ${props.user.workingHoursStart}–${props.user.workingHoursEnd}.`} action={props.editingBooking ? <Button variant="outline" onClick={props.onCancelEdit}>Cancel reschedule</Button> : undefined} />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
      <div className="space-y-5">
        <div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-6"><label className="text-sm font-semibold">What did they say?</label><Textarea value={props.scheduleText} onChange={(event) => props.onScheduleText(event.target.value)} placeholder='Example: “I am free at 8:00 PM on Monday for a 45 minute call.”' className="mt-3 min-h-32 text-base leading-7" /><Button className="mt-4" onClick={props.onAnalyse} disabled={!props.scheduleText.trim() || props.analysing}>{props.analysing ? <Loader2 className="animate-spin" /> : <Sparkles />} Detect and check Calendar</Button></div>
        {props.parsed && <div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-6"><p className="text-xs font-semibold uppercase tracking-wider text-black/35">Interpreted as</p><p className="mt-2 text-xl font-semibold">{props.parsed.interpretation}</p><div className={`mt-4 rounded-xl p-4 text-sm ${props.availability?.available ? "bg-[#eaf7ee] text-[#245d39]" : "bg-amber-50 text-amber-800"}`}><p className="font-semibold">{props.availability?.available ? "Requested time is available" : props.availability?.reason}</p>{!props.availability?.withinWorkingHours && <p className="mt-1 text-xs">This falls outside your working hours, so nearby in-hours times are suggested.</p>}</div>{props.parsed.isAmbiguous && <label className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><input className="mt-1" type="checkbox" checked={props.ambiguityConfirmed} onChange={(event) => props.onAmbiguityConfirmed(event.target.checked)} /><span><strong>Confirm this interpretation.</strong><br /><span className="text-amber-800/75">{props.parsed.ambiguityReason} The CRM will use {props.parsed.interpretation}.</span></span></label>}</div>}
        {props.slots.length > 0 && <div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-6"><h2 className="text-sm font-semibold">Recommended slots</h2><div className="mt-4 grid gap-2 sm:grid-cols-2">{props.slots.map((slot) => <button type="button" key={slot.start} onClick={() => props.onSelectSlot(slot)} className={`rounded-xl border p-4 text-left text-sm transition ${props.selectedSlot?.start === slot.start ? "border-[#2c7650] bg-[#edf8f0] ring-1 ring-[#2c7650]" : "border-black/[0.08] hover:bg-black/[0.02]"}`}><span className="font-semibold">{formatDateTime(slot.start, props.user.timezone)}</span><span className="mt-1 block text-xs text-black/40">{formatTime(slot.start, props.user.timezone)}–{formatTime(slot.end, props.user.timezone)}</span></button>)}</div>{props.availability?.participantAvailability.filter((item) => item.calendarId !== "primary").map((item) => <p key={item.calendarId} className="mt-3 text-xs text-black/45">{item.calendarId}: {item.available === null ? `availability unavailable (${item.error})` : item.available ? "available" : "busy"}</p>)}</div>}
      </div>
      <div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-6 xl:sticky xl:top-[84px] xl:h-fit"><h2 className="text-sm font-semibold">Event details</h2><div className="mt-5 space-y-4"><Field label="Title"><Input value={props.title} onChange={(event) => props.onTitle(event.target.value)} placeholder="Client catch-up" /></Field><Field label="Participants"><Input value={props.attendees} onChange={(event) => props.onAttendees(event.target.value)} placeholder="alex@example.com, sam@example.com" /></Field><Field label="Location"><Input value={props.location} onChange={(event) => props.onLocation(event.target.value)} placeholder="Office or address" /></Field><Field label="Description and thread context"><Textarea value={props.description} onChange={(event) => props.onDescription(event.target.value)} className="min-h-28" /></Field>{!props.editingBooking && <label className="flex items-center gap-3 rounded-xl bg-[#f5f7f6] p-4 text-sm"><input type="checkbox" checked={props.addMeetLink} onChange={(event) => props.onAddMeetLink(event.target.checked)} /><Video className="h-4 w-4" /> Add Google Meet link</label>}<Button className="h-10 w-full" disabled={!canBook} onClick={props.onReviewBooking}><CalendarDays /> Review {props.editingBooking ? "update" : "booking"}</Button><p className="text-center text-[11px] leading-4 text-black/35">Reviewing does not change your calendar. A final confirmation follows.</p></div></div>
    </div>
  </section>;
}

function MeetingsView(props: { calendar?: CalendarData; meetingRequests: MeetingRequestListItem[]; timezone: string; loading: boolean; onScheduleRequest: (item: MeetingRequestListItem) => void; onReschedule: (booking: CalendarBooking) => void; onCancel: (booking: CalendarBooking) => void; }) {
  const bookings = props.calendar?.bookings.filter((item) => item.status === "confirmed") ?? [];
  return <section><PageHeading eyebrow="Calendar operations" title="Meetings" description="Upcoming Google Calendar events and meeting requests detected from Gmail." />
    <div className="grid gap-5 xl:grid-cols-2"><div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-6"><h2 className="text-sm font-semibold">Upcoming calendar</h2>{props.loading ? <LoadingBlock label="Loading Calendar…" /> : (props.calendar?.events.length ?? 0) === 0 ? <EmptyBlock title="No upcoming events" description="Confirmed bookings will appear here." /> : <div className="mt-4 space-y-3">{props.calendar!.events.map((event) => <article key={event.id} className="rounded-xl border border-black/[0.06] p-4"><div className="flex justify-between gap-3"><div><p className="font-semibold">{event.summary || "Untitled event"}</p><p className="mt-1 text-xs text-black/45">{formatDateTime(event.start.dateTime ?? event.start.date ?? "", props.timezone)}</p></div>{event.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer" aria-label="Open in Google Calendar"><ExternalLink className="h-4 w-4 text-black/35" /></a>}</div>{event.location && <p className="mt-3 flex items-center gap-2 text-xs text-black/45"><MapPin className="h-3 w-3" />{event.location}</p>}</article>)}</div>}</div>
      <div className="space-y-5"><div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-6"><h2 className="text-sm font-semibold">CRM bookings</h2>{bookings.length === 0 ? <EmptyBlock title="No CRM bookings" description="Use the scheduling assistant to confirm one." /> : <div className="mt-4 space-y-3">{bookings.map((booking) => <article key={booking.id} className="rounded-xl bg-[#f5f7f6] p-4"><p className="font-semibold">{booking.title}</p><p className="mt-1 text-xs text-black/45">{formatDateRange(booking.startAt, booking.endAt, props.timezone)}</p><div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => props.onReschedule(booking)}>Reschedule</Button><Button size="sm" variant="ghost" onClick={() => props.onCancel(booking)}>Cancel</Button></div></article>)}</div>}</div>
      <div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-6"><h2 className="text-sm font-semibold">Detected meeting requests</h2>{props.meetingRequests.length === 0 ? <EmptyBlock title="No requests detected" description="Scheduling language in synced emails will appear here." /> : <div className="mt-4 space-y-2">{props.meetingRequests.map((item) => <button type="button" key={item.request.id} onClick={() => props.onScheduleRequest(item)} className="flex w-full items-center justify-between rounded-xl border border-black/[0.06] p-4 text-left hover:bg-black/[0.02]"><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.thread?.subject ?? "Meeting request"}</p><p className="mt-1 truncate text-xs text-black/45">{item.request.rawText}</p></div><ChevronRight className="h-4 w-4 shrink-0 text-black/30" /></button>)}</div>}</div></div></div>
  </section>;
}

function PrivacyView(props: { session: SessionData; profilePending: boolean; onSaveProfile: (profile: { timezone: string; workingHoursStart: string; workingHoursEnd: string }) => void; onAccountAction: (action: AccountAction) => void; }) {
  const [timezone, setTimezone] = useState(props.session.user.timezone);
  const [workingHoursStart, setWorkingHoursStart] = useState(props.session.user.workingHoursStart);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(props.session.user.workingHoursEnd);
  const privacyQuery = useQuery({ queryKey: ["crm", "privacy-summary"], queryFn: () => api.get<PrivacySummary>("/api/privacy/data-access") });
  const auditQuery = useQuery({ queryKey: ["crm", "audit"], queryFn: () => api.get<{ logs: AuditLog[] }>("/api/privacy/audit-logs?limit=20") });
  return <section><PageHeading eyebrow="Security and control" title="Privacy & settings" description="See what is stored, tune scheduling preferences, revoke access, or delete your data." />
    <div className="grid gap-5 xl:grid-cols-2"><div className="space-y-5"><div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-6"><h2 className="flex items-center gap-2 text-sm font-semibold"><Settings className="h-4 w-4" /> Scheduling preferences</h2><div className="mt-5 space-y-4"><Field label="IANA timezone"><Input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Singapore" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Working day starts"><Input type="time" value={workingHoursStart} onChange={(event) => setWorkingHoursStart(event.target.value)} /></Field><Field label="Working day ends"><Input type="time" value={workingHoursEnd} onChange={(event) => setWorkingHoursEnd(event.target.value)} /></Field></div><Button onClick={() => props.onSaveProfile({ timezone, workingHoursStart, workingHoursEnd })} disabled={props.profilePending}>Save preferences</Button></div></div>
      <div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-6"><h2 className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4" /> Stored data</h2>{privacyQuery.data && <><div className="mt-4 grid grid-cols-2 gap-2">{Object.entries(privacyQuery.data.summary).map(([label, value]) => <div key={label} className="rounded-xl bg-[#f5f7f6] p-3"><p className="text-xl font-semibold">{value}</p><p className="mt-1 break-words text-[11px] text-black/40">{label}</p></div>)}</div><p className="mt-4 text-xs leading-5 text-black/45">{privacyQuery.data.description}</p></>}</div></div>
      <div className="space-y-5"><div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-6"><h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" /> Data handling</h2><ul className="mt-4 space-y-3 text-sm text-black/55"><SafeLine text="OAuth tokens are AES-GCM encrypted at rest." /><SafeLine text="Session tokens are HMAC-hashed; raw tokens stay in HttpOnly cookies." /><SafeLine text="Email bodies are fetched on demand and not persisted." /><SafeLine text="No connected data is sent to external AI or used for model training." /><SafeLine text="Sends and calendar changes are recorded in a PII-masked audit log." /></ul></div>
      <div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-6"><h2 className="text-sm font-semibold">Recent audit activity</h2><div className="mt-4 space-y-2">{auditQuery.data?.logs.map((log) => <div key={log.id} className="flex items-center justify-between gap-3 rounded-lg bg-[#f5f7f6] px-3 py-2 text-xs"><span>{log.action}</span><time className="text-black/35">{formatDate(log.createdAt)}</time></div>) ?? <p className="text-xs text-black/40">No audit activity yet.</p>}</div></div>
      <div className="rounded-2xl border border-red-100 bg-white p-5 sm:p-6"><h2 className="text-sm font-semibold">Account controls</h2><div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => props.onAccountAction("logout")}><LogOut /> Log out</Button><Button variant="outline" onClick={() => props.onAccountAction("disconnect")}><Unplug /> Disconnect Google</Button><Button variant="destructive" onClick={() => props.onAccountAction("delete")}><Trash2 /> Delete all data</Button></div></div></div></div>
  </section>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#397454]">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-black/45">{description}</p></div>{action}</div>; }
function NavButton({ active, icon: Icon, label, count, onClick }: { active: boolean; icon: React.ComponentType<{ className?: string }>; label: string; count?: number; onClick: () => void; }) { return <button type="button" onClick={onClick} className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition lg:justify-start ${active ? "bg-[#183d2c] text-white" : "text-black/50 hover:bg-black/[0.04]"}`}><Icon className="h-4 w-4 shrink-0" /><span className="hidden lg:inline">{label}</span>{count !== undefined && count > 0 && <span className={`ml-auto hidden rounded-full px-2 py-0.5 text-[10px] lg:inline ${active ? "bg-white/15" : "bg-black/[0.06]"}`}>{count}</span>}</button>; }
function Metric({ label, value, icon: Icon }: { label: string; value?: number; icon: React.ComponentType<{ className?: string }> }) { return <div className="rounded-2xl border border-black/[0.06] bg-white p-5"><div className="flex items-center justify-between"><p className="text-xs font-medium text-black/40">{label}</p><Icon className="h-4 w-4 text-[#4d8062]" /></div><p className="mt-4 text-3xl font-semibold tracking-[-0.04em]">{value ?? "—"}</p></div>; }
function FilterSelect<T extends string>({ label, value, values, onChange }: { label: string; value: string; values: readonly T[]; onChange: (value: string) => void; }) { return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-lg border border-black/10 bg-white px-3 text-xs capitalize outline-none focus:ring-1 focus:ring-[#397454]"><option value="">{label}</option>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select>; }
function ThreadRow({ thread, active, checked, onCheck, onOpen }: { thread: EmailThread; active: boolean; checked: boolean; onCheck: () => void; onOpen: () => void; }) { return <div className={`flex border-b border-black/[0.05] p-4 transition ${active ? "bg-[#edf6f0]" : "hover:bg-black/[0.02]"}`}><input type="checkbox" checked={checked} onChange={onCheck} onClick={(event) => event.stopPropagation()} className="mt-1 h-4 w-4 shrink-0" aria-label={`Select ${thread.subject}`} /><button type="button" onClick={onOpen} className="min-w-0 flex-1 pl-3 text-left"><div className="flex items-center gap-2"><span className={`truncate text-sm ${thread.hasUnread ? "font-semibold" : "font-medium"}`}>{thread.fromName || thread.fromEmail || "Unknown sender"}</span><span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${priorityClass(thread.priority)}`}>{thread.priority}</span></div><p className="mt-1 truncate text-sm font-medium">{thread.subject || "(No subject)"}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-black/40">{thread.snippet}</p><div className="mt-2 flex items-center gap-2 text-[10px] text-black/35"><span className="capitalize">{thread.category}</span>{thread.requiresResponse && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Reply needed</span>}<span className="ml-auto">{thread.lastMessageDate ? formatDate(thread.lastMessageDate) : ""}</span></div></button></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-medium text-black/45">{label}</span>{children}</label>; }
function EditableLabel({ label, children }: { label: string; children: React.ReactNode }) { return <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-black/35">{label}</p>{children}</div>; }
function LoadingBlock({ label }: { label: string }) { return <div className="flex min-h-44 items-center justify-center gap-2 p-8 text-sm text-black/40"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>; }
function EmptyBlock({ title, description }: { title: string; description: string }) { return <div className="flex min-h-44 flex-col items-center justify-center p-8 text-center"><div className="grid h-10 w-10 place-items-center rounded-full bg-[#eef2ef]"><Mail className="h-4 w-4 text-black/35" /></div><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 max-w-xs text-xs leading-5 text-black/40">{description}</p></div>; }
function SafeLine({ text }: { text: string }) { return <li className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#397454]" />{text}</li>; }
function toggleSet(current: Set<string>, value: string) { const next = new Set(current); if (next.has(value)) next.delete(value); else next.add(value); return next; }
function priorityClass(priority: EmailPriority) { if (priority === "critical") return "bg-red-100 text-red-700"; if (priority === "high") return "bg-amber-100 text-amber-800"; if (priority === "low") return "bg-black/[0.05] text-black/45"; return "bg-[#e8f5ec] text-[#2d6844]"; }
function formatDate(value: string) { const numberValue = Number(value); const date = new Date(Number.isFinite(numberValue) && numberValue > 1e12 ? numberValue : value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date); }
function formatDateTime(value: string, timezone: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-SG", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
function formatTime(value: string, timezone: string) { return new Intl.DateTimeFormat("en-SG", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function formatDateRange(start: string, end: string, timezone: string) { return `${formatDateTime(start, timezone)} – ${formatTime(end, timezone)}`; }
function firstError(...errors: unknown[]) { return errors.find(Boolean); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
