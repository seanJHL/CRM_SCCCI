import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  Check,
  Database,
  Inbox,
  Info,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  Search,
  Save,
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
  type EmailCategory,
  type EmailPriority,
  type EmailStatus,
  type EmailThread,
  type GmailStats,
  type ParsedSchedule,
  type PrivacySummary,
  type SessionData,
  type SuggestedReply,
  type SuggestedSlot,
  type ThreadDetailData,
  googleSignInUrl,
  loadSession,
} from "@/lib/crm";
import { queryKeys } from "@/lib/query-keys";
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
  component: CrmRoutePage,
});

type DashboardView = "inbox" | "privacy";
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

function CrmRoutePage() {
  const { session } = Route.useRouteContext();
  return <CrmDashboard initialSession={session} />;
}

export function CrmDashboard({ initialSession }: { initialSession: SessionData }) {
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
  const [draftHydratedFor, setDraftHydratedFor] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
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
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const statsQuery = useQuery({
    queryKey: ["crm", "stats"],
    queryFn: () => api.get<{ stats: GmailStats }>("/api/gmail/stats"),
  });
  const gmailSyncQuery = useQuery({
    queryKey: ["crm", "gmail-sync"],
    queryFn: () =>
      api.get<{ threads: EmailThread[] }>("/api/gmail?refresh=true"),
    staleTime: 90_000,
    refetchInterval: (query) =>
      isActionRequired(query.state.error) ? false : 120_000,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) =>
      !isActionRequired(error) && failureCount < 2,
  });
  const threadDetailQuery = useQuery({
    queryKey: ["crm", "thread", selectedThreadId],
    queryFn: () =>
      api.get<ThreadDetailData>(`/api/gmail/${selectedThreadId}`),
    enabled: Boolean(selectedThreadId),
    refetchInterval: (query) =>
      selectedThreadId && !isActionRequired(query.state.error) ? 60_000 : false,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) =>
      !isActionRequired(error) && failureCount < 2,
  });

  const threads = threadsQuery.data?.threads ?? [];
  const selectedThread = threads.find(
    (thread) => thread.gmailThreadId === selectedThreadId,
  );

  useEffect(() => {
    if (!selectedThreadId || !threadDetailQuery.data) return;
    if (draftHydratedFor === selectedThreadId) return;
    const latestDraft = threadDetailQuery.data?.replies.find(
      (reply) => reply.status !== "sent",
    );
    setReplyBody(latestDraft?.body ?? "");
    setReplyDraftId(latestDraft?.id ?? null);
    setDraftHydratedFor(selectedThreadId);
  }, [draftHydratedFor, selectedThreadId, threadDetailQuery.data]);

  const invalidateInbox = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["crm", "threads"] }),
      queryClient.invalidateQueries({ queryKey: ["crm", "stats"] }),
      queryClient.invalidateQueries({ queryKey: ["crm", "thread"] }),
    ]);
  };

  useEffect(() => {
    if (!gmailSyncQuery.dataUpdatedAt) return;
    void invalidateInbox();
  }, [gmailSyncQuery.dataUpdatedAt]);

  const refreshGmail = async () => {
    const result = await gmailSyncQuery.refetch();
    if (!result.error) {
      setNotice("Gmail is up to date.");
      await invalidateInbox();
    }
  };
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
        { regenerate, currentBody: replyBody, draftId: replyDraftId ?? undefined },
      ),
    onSuccess: (data) => {
      setReplyBody(data.reply.body);
      setReplyDraftId(data.reply.id);
      setNotice("A reviewable draft was generated. Nothing has been sent.");
    },
  });
  const saveDraftMutation = useMutation({
    mutationFn: () =>
      api.post<{ reply: SuggestedReply }>(
        `/api/gmail/${selectedThreadId}/draft`,
        { body: replyBody, draftId: replyDraftId ?? undefined },
      ),
    onSuccess: async (data) => {
      setReplyDraftId(data.reply.id);
      setNotice("Draft saved. Nothing has been sent.");
      await queryClient.invalidateQueries({
        queryKey: ["crm", "thread", selectedThreadId],
      });
    },
  });
  const discardDraftMutation = useMutation({
    mutationFn: async () => {
      if (!replyDraftId) return { discarded: true };
      return api.delete<{ discarded: boolean }>(
        `/api/gmail/${selectedThreadId}/draft/${replyDraftId}`,
      );
    },
    onSuccess: async () => {
      setReplyBody("");
      setReplyDraftId(null);
      setComposerOpen(false);
      setNotice("Draft discarded.");
      await queryClient.invalidateQueries({
        queryKey: ["crm", "thread", selectedThreadId],
      });
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
      setComposerOpen(false);
      setReplyBody("");
      setReplyDraftId(null);
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

  const [parsedSchedule, setParsedSchedule] = useState<ParsedSchedule | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [suggestedSlots, setSuggestedSlots] = useState<SuggestedSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SuggestedSlot | null>(null);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const [ambiguityConfirmed, setAmbiguityConfirmed] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDescription, setMeetingDescription] = useState("");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [attendeeText, setAttendeeText] = useState("");
  const [addMeetLink, setAddMeetLink] = useState(false);
  const [sourceThreadId, setSourceThreadId] = useState<string | null>(null);
  const [bookingConfirmationOpen, setBookingConfirmationOpen] = useState(false);

  const attendeeEmails = useMemo(
    () =>
      attendeeText
        .split(/[;,]/)
        .map((email) => email.trim())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
    [attendeeText],
  );

  const parseScheduleMutation = useMutation({
    mutationFn: async (input: {
      text: string;
      participantEmails: string[];
    }) => {
      const parsed = await api.post<{
        detected: boolean;
        parsed: ParsedSchedule | null;
        message?: string;
      }>("/api/calendar-crm/parse-schedule", { text: input.text.slice(0, 50_000) });
      if (!parsed.parsed) return { parsed, availability: null, slots: [] };
      const [checked, slots] = await Promise.all([
        api.post<AvailabilityResult>("/api/calendar-crm/check-availability", {
          start: parsed.parsed.start,
          end: parsed.parsed.end,
          participantEmails: input.participantEmails,
        }),
        api.post<{ slots: SuggestedSlot[] }>("/api/calendar-crm/suggest-slots", {
          start: parsed.parsed.start,
          durationMinutes: parsed.parsed.durationMinutes,
          participantEmails: input.participantEmails,
        }),
      ]);
      return { parsed, availability: checked, slots: slots.slots };
    },
    onSuccess: ({ parsed, availability: checked, slots }) => {
      setParsedSchedule(parsed.parsed);
      setAvailability(checked);
      setScheduleMessage(parsed.message ?? null);
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
    },
  });

  const schedulingContext = useMemo(() => {
    const messages = [...(threadDetailQuery.data?.thread.messages ?? [])]
      .reverse()
      .slice(0, 6)
      .map((message) => message.bodyText || message.snippet)
      .join("\n\n") || selectedThread?.snippet || "";
    return `Draft reply:\n${replyBody}\n\nMost recent conversation first:\n${messages}`.slice(0, 50_000);
  }, [replyBody, selectedThread?.snippet, threadDetailQuery.data]);

  useEffect(() => {
    if (!composerOpen) return;
    if (!hasSchedulingIntent(schedulingContext)) {
      resetScheduleResults();
      setScheduleMessage(null);
      return;
    }
    const timer = window.setTimeout(() => {
      parseScheduleMutation.mutate({
        text: schedulingContext,
        participantEmails: attendeeEmails,
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [attendeeEmails, composerOpen, schedulingContext]);

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
      return api.post("/api/calendar-crm/events", {
        ...common,
        addMeetLink,
        sourceThreadId: sourceThreadId ?? undefined,
      });
    },
    onSuccess: async () => {
      setBookingConfirmationOpen(false);
      setNotice("Meeting created and added to Ember Calendar.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.events.all }),
        invalidateInbox(),
      ]);
    },
  });

  const openComposerForThread = (thread: EmailThread) => {
    setComposerOpen(true);
    setMeetingTitle(thread.subject ?? "Meeting");
    setMeetingDescription(
      `Scheduled from Gmail thread: ${thread.subject ?? "Untitled conversation"}\n\nEmail context: ${thread.snippet ?? ""}`,
    );
    setMeetingLocation("");
    setAttendeeText(thread.fromEmail ?? "");
    setAddMeetLink(false);
    setSourceThreadId(thread.id);
    resetScheduleResults();
    setScheduleMessage(null);
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
    actionRequiredError(threadsQuery.error),
    actionRequiredError(statsQuery.error),
    actionRequiredError(gmailSyncQuery.error),
    actionRequiredError(threadDetailQuery.error),
    updateThreadMutation.error,
    actionRequiredError(generateReplyMutation.error),
    actionRequiredError(saveDraftMutation.error),
    actionRequiredError(discardDraftMutation.error),
    sendReplyMutation.error,
    actionRequiredError(parseScheduleMutation.error),
    bookingMutation.error,
    accountMutation.error,
  );
  const composerError = firstError(
    generateReplyMutation.error,
    saveDraftMutation.error,
    discardDraftMutation.error,
    parseScheduleMutation.error,
  );
  const reauthRequired =
    topError instanceof ApiClientError &&
    ["GOOGLE_REAUTH_REQUIRED", "GOOGLE_PERMISSION_REQUIRED"].includes(topError.code);
  const sessionExpired =
    topError instanceof ApiClientError && topError.code === "UNAUTHORIZED";
  const canReviewBooking = Boolean(
    selectedSlot && (!parsedSchedule?.isAmbiguous || ambiguityConfirmed),
  );
  const insertSlotIntoReply = (slot: SuggestedSlot) => {
    const sentence = `Would ${formatDateRange(slot.start, slot.end, session.user.timezone)} (${session.user.timezone}) work for you?`;
    setReplyBody((current) =>
      current.trim() ? `${current.trim()}\n\n${sentence}` : sentence,
    );
    setSelectedSlot(slot);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex min-h-14 items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <Mail className="h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">CRM</p>
              <p className="truncate text-[11px] text-muted-foreground">Gmail and Calendar</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="truncate">{session.google.email}</span>
            </span>
            {session.user.avatarUrl ? (
              <img src={session.user.avatarUrl} alt="" className="h-7 w-7 rounded-full border border-border" referrerPolicy="no-referrer" />
            ) : (
              <span className="grid h-7 w-7 place-items-center rounded-full bg-foreground text-[10px] font-semibold text-background">{session.user.name.slice(0, 1).toUpperCase()}</span>
            )}
            <button
              type="button"
              onClick={() => setAccountAction("logout")}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        <nav className="flex min-w-0 items-center gap-5 overflow-x-auto px-5 sm:px-8" aria-label="CRM sections">
          <NavButton active={view === "inbox"} icon={Inbox} label="Inbox" count={statsQuery.data?.stats.requiresResponse} onClick={() => setView("inbox")} />
          <NavButton active={view === "privacy"} icon={ShieldCheck} label="Settings" onClick={() => setView("privacy")} />
        </nav>
      </header>

      <main className="min-w-0 px-2 py-2 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] sm:px-4 sm:py-4 sm:pb-4">
          {notice && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <span className="flex items-center gap-2"><Check className="h-4 w-4" />{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
            </div>
          )}
          {Boolean(topError) && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{errorMessage(topError)}</span>
              {reauthRequired && <a href={googleSignInUrl()} className="font-semibold underline">Reconnect Google</a>}
              {sessionExpired && <a href="/login" className="font-semibold underline">Sign in again</a>}
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
              onSync={() => void refreshGmail()}
              syncing={gmailSyncQuery.isFetching}
              onBulkClassify={() => bulkClassifyMutation.mutate()}
              onBulkArchive={() => bulkUpdateMutation.mutate({ status: "archived" })}
              onBulkDraft={() => bulkDraftMutation.mutate()}
              bulkPending={bulkUpdateMutation.isPending || bulkDraftMutation.isPending || bulkClassifyMutation.isPending}
              detail={threadDetailQuery.data}
              detailLoading={threadDetailQuery.isLoading}
              selectedThread={selectedThread}
              onUpdate={(updates) => selectedThreadId && updateThreadMutation.mutate({ threadId: selectedThreadId, updates })}
              onCreateDraft={() => selectedThread && openComposerForThread(selectedThread)}
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

      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent className="bottom-0 left-0 top-auto flex h-[min(94dvh,920px)] w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-b-none rounded-t-2xl p-0 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:h-[min(90dvh,900px)] sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
          <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12 sm:px-6">
            <DialogTitle>Create draft</DialogTitle>
            <DialogDescription className="truncate">
              To: {selectedThread?.fromEmail ?? threadDetailQuery.data?.thread.fromEmail ?? "Thread participant"} · {threadDetailQuery.data?.thread.subject || selectedThread?.subject || "No subject"}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
            {Boolean(composerError) && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900" role="alert">
                <span>{errorMessage(composerError)}</span>
                {composerError instanceof ApiClientError && ["GOOGLE_REAUTH_REQUIRED", "GOOGLE_PERMISSION_REQUIRED"].includes(composerError.code) && <a href={googleSignInUrl()} className="font-semibold underline">Reconnect Google</a>}
                {composerError instanceof ApiClientError && composerError.code === "UNAUTHORIZED" && <a href="/login" className="font-semibold underline">Sign in again</a>}
              </div>
            )}

            <section className="rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold">Message</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">AI suggestions remain editable and are never sent automatically.</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => generateReplyMutation.mutate(Boolean(replyBody.trim()))}
                  disabled={generateReplyMutation.isPending}
                >
                  {generateReplyMutation.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  Suggest Message Reply
                </Button>
              </div>
              <Textarea
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
                placeholder="Write a reply or request an AI suggestion…"
                className="min-h-56 resize-y rounded-none border-0 px-4 py-4 text-sm leading-6 shadow-none focus-visible:ring-0 sm:min-h-64"
              />
              <p className="border-t border-border px-4 py-2 text-[11px] leading-4 text-muted-foreground">
                Suggestions use recent thread context with email addresses, phone numbers, tokens, and links masked where possible.
              </p>
            </section>

            <section className="rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4" /> Scheduling</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{session.user.timezone} · working hours {session.user.workingHoursStart}–{session.user.workingHoursEnd}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => parseScheduleMutation.mutate({ text: schedulingContext, participantEmails: attendeeEmails })}
                  disabled={!schedulingContext.trim() || parseScheduleMutation.isPending}
                >
                  {parseScheduleMutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Check availability
                </Button>
              </div>

              <div className="space-y-4 p-4">
                {parseScheduleMutation.isPending && !parsedSchedule && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Detecting meeting details and checking Calendar…</p>
                )}
                {!parseScheduleMutation.isPending && !parsedSchedule && (
                  <p className="text-sm text-muted-foreground">
                    {scheduleMessage ?? "No specific meeting time detected yet. Add a date or time to your reply and availability will be checked automatically."}
                  </p>
                )}

                {parsedSchedule && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-muted/50 p-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Interpreted as</p>
                        <p className="mt-1 text-sm font-semibold">{parsedSchedule.interpretation}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${availability?.available ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                        {availability?.available ? "Available" : "Conflict found"}
                      </span>
                    </div>
                    {availability && !availability.available && (
                      <p className="text-xs text-amber-800">{availability.reason} Nearby available times are shown below.</p>
                    )}
                    {parsedSchedule.isAmbiguous && (
                      <label className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                        <input className="mt-1" type="checkbox" checked={ambiguityConfirmed} onChange={(event) => setAmbiguityConfirmed(event.target.checked)} />
                        <span><strong>Confirm {parsedSchedule.interpretation}.</strong><br /><span className="text-xs text-amber-800">{parsedSchedule.ambiguityReason}</span></span>
                      </label>
                    )}
                  </div>
                )}

                {suggestedSlots.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold">Recommended times</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {suggestedSlots.map((slot) => (
                        <div key={slot.start} className={`rounded-md border p-3 ${selectedSlot?.start === slot.start ? "border-foreground bg-muted/60 ring-1 ring-foreground" : "border-border"}`}>
                          <button type="button" className="w-full text-left" onClick={() => setSelectedSlot(slot)}>
                            <span className="block text-sm font-semibold">{formatDateTime(slot.start, session.user.timezone)}</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">{formatTime(slot.start, session.user.timezone)}–{formatTime(slot.end, session.user.timezone)} · {session.user.timezone}</span>
                          </button>
                          <Button size="sm" variant="ghost" className="mt-2 h-7 px-2 text-xs" onClick={() => insertSlotIntoReply(slot)}>Insert into reply</Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(parsedSchedule || suggestedSlots.length > 0) && (
                  <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                    <Field label="Meeting title"><Input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} placeholder="Client catch-up" /></Field>
                    <Field label="Participants"><Input value={attendeeText} onChange={(event) => setAttendeeText(event.target.value)} placeholder="alex@example.com" /></Field>
                    <Field label="Location"><Input value={meetingLocation} onChange={(event) => setMeetingLocation(event.target.value)} placeholder="Office or address" /></Field>
                    <label className="flex h-10 items-center gap-2 self-end rounded-md border border-border px-3 text-sm"><input type="checkbox" checked={addMeetLink} onChange={(event) => setAddMeetLink(event.target.checked)} /><Video className="h-4 w-4" /> Add Google Meet</label>
                    <div className="sm:col-span-2"><Field label="Calendar description and email context"><Textarea value={meetingDescription} onChange={(event) => setMeetingDescription(event.target.value)} className="min-h-24" /></Field></div>
                    <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
                      <p className="text-[11px] text-muted-foreground">A confirmation step appears before Calendar is changed.</p>
                      <Button onClick={() => setBookingConfirmationOpen(true)} disabled={!canReviewBooking}><CalendarDays /> Create Calendar event</Button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <DialogFooter className="shrink-0 flex-wrap border-t border-border bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 sm:px-6 sm:pb-4">
            <Button variant="ghost" onClick={() => discardDraftMutation.mutate()} disabled={discardDraftMutation.isPending} className="mr-auto text-muted-foreground"><Trash2 /> Discard</Button>
            <Button variant="outline" onClick={() => saveDraftMutation.mutate()} disabled={!replyBody.trim() || saveDraftMutation.isPending}>
              {saveDraftMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save draft
            </Button>
            <Button onClick={() => setSendConfirmationOpen(true)} disabled={!replyBody.trim()}><Send /> Review and send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendConfirmationOpen} onOpenChange={setSendConfirmationOpen}>
        <DialogContent className="max-w-xl p-6">
          <DialogHeader>
            <DialogTitle>Send this reply?</DialogTitle>
            <DialogDescription>Review the final recipient and message. This is the only step that sends email.</DialogDescription>
          </DialogHeader>
          <div className="my-5 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <p className="font-medium">To: {selectedThread?.fromEmail ?? threadDetailQuery.data?.thread.fromEmail ?? "Thread participant"}</p>
            <p className="mt-3 max-h-60 whitespace-pre-wrap overflow-auto text-muted-foreground">{replyBody}</p>
          </div>
          {sendReplyMutation.error && (
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{errorMessage(sendReplyMutation.error)}</p>
          )}
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
            <DialogTitle>Create this calendar event?</DialogTitle>
            <DialogDescription>No Calendar change occurs until you confirm below.</DialogDescription>
          </DialogHeader>
          {selectedSlot && (
            <div className="my-5 space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
              <p className="font-semibold">{meetingTitle || "Meeting"}</p>
              <p>{formatDateRange(selectedSlot.start, selectedSlot.end, session.user.timezone)}</p>
              {attendeeEmails.length > 0 && <p className="text-muted-foreground">Guests: {attendeeEmails.join(", ")}</p>}
              {addMeetLink && <p className="text-muted-foreground">Google Meet link requested</p>}
            </div>
          )}
          {bookingMutation.error && (
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{errorMessage(bookingMutation.error)}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingConfirmationOpen(false)}>Go back</Button>
            <Button onClick={() => bookingMutation.mutate()} disabled={bookingMutation.isPending}>
              {bookingMutation.isPending ? <Loader2 className="animate-spin" /> : <CalendarDays />} Confirm booking
            </Button>
          </DialogFooter>
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
  onCreateDraft: () => void;
}) {
  return (
    <section className="min-h-0">
      <div className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border px-3 py-2.5 text-xs text-muted-foreground">
          <span><strong className="font-semibold text-foreground">{props.stats?.total ?? "—"}</strong> threads</span>
          <span><strong className="font-semibold text-foreground">{props.stats?.unread ?? "—"}</strong> unread</span>
          <span><strong className="font-semibold text-foreground">{props.stats?.urgent ?? "—"}</strong> important</span>
          <span><strong className="font-semibold text-foreground">{props.stats?.requiresResponse ?? "—"}</strong> need a reply</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Auto-sync on</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={props.onSync} disabled={props.syncing} aria-label="Refresh Gmail now" title="Refresh Gmail now">
              {props.syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
          </div>
        </div>
        <div className="p-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[1fr_160px_140px_150px_auto]">
          <label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={props.sender} onChange={(event) => props.onSender(event.target.value)} placeholder="Filter sender" className="h-9 pl-9" /></label>
          <FilterSelect label="All categories" value={props.category} values={CATEGORIES} onChange={props.onCategory} />
          <FilterSelect label="All priorities" value={props.priority} values={PRIORITIES} onChange={props.onPriority} />
          <FilterSelect label="All statuses" value={props.status} values={STATUSES} onChange={props.onStatus} />
          <label className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-xs"><input type="checkbox" checked={props.responseOnly} onChange={(event) => props.onResponseOnly(event.target.checked)} /> Needs response</label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="mr-1 text-xs text-muted-foreground">{props.selectedIds.size} selected</span>
          <Button size="sm" variant="outline" onClick={props.onBulkClassify} disabled={props.bulkPending}>Reclassify all</Button>
          <Button size="sm" variant="outline" onClick={props.onBulkDraft} disabled={props.selectedIds.size === 0 || props.bulkPending}><Sparkles /> Generate drafts</Button>
          <Button size="sm" variant="outline" onClick={props.onBulkArchive} disabled={props.selectedIds.size === 0 || props.bulkPending}><Archive /> Archive</Button>
          <span className="text-xs text-muted-foreground">Bulk drafts are never sent automatically.</span>
        </div>
        </div>
      </div>
      <div className="mt-3 grid min-h-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm xl:h-[calc(100dvh-214px)] xl:min-h-[560px] xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="min-h-64 max-h-[48dvh] overflow-y-auto overscroll-contain border-b border-border xl:max-h-none xl:min-h-0 xl:border-b-0 xl:border-r">
          {props.loading ? <LoadingBlock label="Loading Gmail threads…" /> : props.threads.length === 0 ? <EmptyBlock title="No threads match" description="Gmail will retry automatically. Clear a filter to see more conversations." /> : props.threads.map((thread) => <ThreadRow key={thread.gmailThreadId} thread={thread} active={props.selectedThreadId === thread.gmailThreadId} checked={props.selectedIds.has(thread.gmailThreadId)} onCheck={() => props.onToggleSelected(thread.gmailThreadId)} onOpen={() => props.onSelectThread(thread.gmailThreadId)} />)}
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
    <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:p-6 xl:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-medium text-muted-foreground">{props.selectedThread?.fromName || props.selectedThread?.fromEmail}</p><h2 className="mt-1 text-xl font-semibold tracking-tight">{props.detail.thread.subject || "(No subject)"}</h2></div>
        <Button onClick={props.onCreateDraft}><Sparkles /> Create Draft</Button>
      </div>
      {classification && <div className="mt-5 grid gap-3 rounded-lg border border-border bg-muted/40 p-4 sm:grid-cols-[1fr_1fr_2fr]">
        <EditableLabel label="Category"><FilterSelect label="Category" value={classification.category} values={CATEGORIES} onChange={(value) => props.onUpdate({ category: value as EmailCategory })} /></EditableLabel>
        <EditableLabel label="Priority"><FilterSelect label="Priority" value={classification.priority} values={PRIORITIES} onChange={(value) => props.onUpdate({ priority: value as EmailPriority })} /></EditableLabel>
        <div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Why it matters</p><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{classification.importanceReasons.length ? classification.importanceReasons.map((reason) => <li key={reason} className="flex gap-2"><Info className="mt-0.5 h-3 w-3 shrink-0" />{reason}</li>) : <li>No elevated importance signals found.</li>}</ul></div>
      </div>}
      {props.detail.stale && <div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Showing the latest cached preview while Gmail reconnects. This thread will retry automatically.</div>}
      <div className="mt-6 space-y-2">{props.detail.thread.messages.map((message) => <article key={message.id} className="overflow-hidden rounded-lg border border-border bg-background"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3 text-xs"><span className="font-semibold">{message.fromName || message.fromEmail}</span><time className="text-muted-foreground">{formatDate(message.internalDate)}</time></div><p className="whitespace-pre-wrap break-words px-4 py-4 text-sm leading-6 text-foreground/80">{cleanEmailBody(message.bodyText || message.snippet)}</p></article>)}</div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <FilterSelect label="Update status" value={classification?.status ?? ""} values={STATUSES} onChange={(value) => props.onUpdate({ status: value as EmailStatus })} />
        <Button onClick={props.onCreateDraft}><Sparkles /> Create Draft</Button>
      </div>
    </div>
  );
}

function PrivacyView(props: { session: SessionData; profilePending: boolean; onSaveProfile: (profile: { timezone: string; workingHoursStart: string; workingHoursEnd: string }) => void; onAccountAction: (action: AccountAction) => void; }) {
  const [timezone, setTimezone] = useState(props.session.user.timezone);
  const [workingHoursStart, setWorkingHoursStart] = useState(props.session.user.workingHoursStart);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(props.session.user.workingHoursEnd);
  const privacyQuery = useQuery({ queryKey: ["crm", "privacy-summary"], queryFn: () => api.get<PrivacySummary>("/api/privacy/data-access") });
  const auditQuery = useQuery({ queryKey: ["crm", "audit"], queryFn: () => api.get<{ logs: AuditLog[] }>("/api/privacy/audit-logs?limit=20") });
  return (
    <section>
      <PageHeading eyebrow="Security and control" title="Settings" description="Manage scheduling preferences, connected data, account access, and audit history." />
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Settings className="h-4 w-4" /> Scheduling preferences</h2>
            <div className="mt-5 space-y-4">
              <Field label="IANA timezone"><Input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Singapore" /></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="Working day starts"><Input type="time" value={workingHoursStart} onChange={(event) => setWorkingHoursStart(event.target.value)} /></Field><Field label="Working day ends"><Input type="time" value={workingHoursEnd} onChange={(event) => setWorkingHoursEnd(event.target.value)} /></Field></div>
              <Button onClick={() => props.onSaveProfile({ timezone, workingHoursStart, workingHoursEnd })} disabled={props.profilePending}>Save preferences</Button>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4" /> Stored data</h2>
            {privacyQuery.data && <><div className="mt-4 grid grid-cols-2 gap-2">{Object.entries(privacyQuery.data.summary).map(([label, value]) => <div key={label} className="rounded-md border border-border bg-muted/40 p-3"><p className="text-xl font-semibold">{value}</p><p className="mt-1 break-words text-[11px] text-muted-foreground">{label}</p></div>)}</div><p className="mt-4 text-xs leading-5 text-muted-foreground">{privacyQuery.data.description}</p></>}
          </div>
        </div>
        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" /> Data handling</h2>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground"><SafeLine text="OAuth tokens are AES-GCM encrypted at rest." /><SafeLine text="Session tokens are HMAC-hashed; raw tokens stay in HttpOnly cookies." /><SafeLine text="Email bodies are fetched on demand and not persisted." /><SafeLine text="Only when you request a reply suggestion, minimized recent context is sent to OpenRouter with contact details, tokens, and links masked where possible and provider data collection denied." /><SafeLine text="Sends and calendar changes are recorded in a PII-masked audit log." /></ul>
          </div>
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="text-sm font-semibold">Recent audit activity</h2>
            <div className="mt-4 space-y-2">{auditQuery.data?.logs.map((log) => <div key={log.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-xs"><span>{log.action}</span><time className="text-muted-foreground">{formatDate(log.createdAt)}</time></div>) ?? <p className="text-xs text-muted-foreground">No audit activity yet.</p>}</div>
          </div>
          <div className="rounded-lg border border-red-200 bg-card p-5 shadow-sm sm:p-6">
            <h2 className="text-sm font-semibold">Account controls</h2>
            <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => props.onAccountAction("logout")}><LogOut /> Log out</Button><Button variant="outline" onClick={() => props.onAccountAction("disconnect")}><Unplug /> Disconnect Google</Button><Button variant="destructive" onClick={() => props.onAccountAction("delete")}><Trash2 /> Delete all data</Button></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p><h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1><p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p></div>{action}</div>; }
function NavButton({ active, icon: Icon, label, count, onClick }: { active: boolean; icon: React.ComponentType<{ className?: string }>; label: string; count?: number; onClick: () => void; }) { return <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={`relative flex h-10 shrink-0 items-center gap-2 border-b-2 px-0 text-[13px] font-medium transition-colors ${active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon className="h-3.5 w-3.5 shrink-0" /><span>{label}</span>{count !== undefined && count > 0 && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{count}</span>}</button>; }
function FilterSelect<T extends string>({ label, value, values, onChange }: { label: string; value: string; values: readonly T[]; onChange: (value: string) => void; }) { return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs capitalize outline-none focus:ring-1 focus:ring-ring"><option value="">{label}</option>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select>; }
function ThreadRow({ thread, active, checked, onCheck, onOpen }: { thread: EmailThread; active: boolean; checked: boolean; onCheck: () => void; onOpen: () => void; }) {
  return (
    <div className={`group flex border-b border-border transition-colors last:border-b-0 ${active ? "bg-muted" : thread.hasUnread ? "bg-background hover:bg-muted/60" : "bg-muted/20 hover:bg-muted/60"}`}>
      <label className="flex w-10 shrink-0 items-start justify-center pt-4">
        <input type="checkbox" checked={checked} onChange={onCheck} onClick={(event) => event.stopPropagation()} className="h-4 w-4 rounded border-input" aria-label={`Select ${thread.subject}`} />
      </label>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-3 pr-3 text-left">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${thread.hasUnread ? "bg-blue-600" : "bg-transparent"}`} aria-hidden="true" />
          <span className={`truncate text-[13px] ${thread.hasUnread ? "font-semibold text-foreground" : "font-medium text-muted-foreground"}`}>{thread.fromName || thread.fromEmail || "Unknown sender"}</span>
          <time className={`ml-auto shrink-0 text-[10px] ${thread.hasUnread ? "font-medium text-foreground" : "text-muted-foreground"}`}>{thread.lastMessageDate ? formatInboxDate(thread.lastMessageDate) : ""}</time>
        </div>
        <p className={`mt-1 truncate text-[13px] ${thread.hasUnread ? "font-semibold" : "font-medium"}`}>{thread.subject || "(No subject)"}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{thread.snippet || "No message preview"}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-medium capitalize text-muted-foreground">{thread.category}</span>
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${priorityClass(thread.priority)}`}>{thread.priority}</span>
          {thread.requiresResponse && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800">Reply needed</span>}
        </div>
      </button>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>; }
function EditableLabel({ label, children }: { label: string; children: React.ReactNode }) { return <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>{children}</div>; }
function LoadingBlock({ label }: { label: string }) { return <div className="flex min-h-44 items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>; }
function EmptyBlock({ title, description }: { title: string; description: string }) { return <div className="flex min-h-44 flex-col items-center justify-center p-8 text-center"><div className="grid h-10 w-10 place-items-center rounded-full bg-muted"><Mail className="h-4 w-4 text-muted-foreground" /></div><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{description}</p></div>; }
function SafeLine({ text }: { text: string }) { return <li className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{text}</li>; }
function toggleSet(current: Set<string>, value: string) { const next = new Set(current); if (next.has(value)) next.delete(value); else next.add(value); return next; }
function priorityClass(priority: EmailPriority) { if (priority === "critical") return "bg-red-100 text-red-700"; if (priority === "high") return "bg-amber-100 text-amber-800"; if (priority === "low") return "bg-muted text-muted-foreground"; return "bg-slate-100 text-slate-600"; }
function formatDate(value: string) { const numberValue = Number(value); const date = new Date(Number.isFinite(numberValue) && numberValue > 1e12 ? numberValue : value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date); }
function formatInboxDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("en-SG", { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("en-SG", date.getFullYear() === now.getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "2-digit" }).format(date);
}
function cleanEmailBody(value: string) {
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

    if (/^https?:\/\//i.test(trimmed)) {
      if (trimmed.length > 90 || /(?:ablink|click|track|utm_|mc_[ce]id|trk)/i.test(trimmed)) {
        continue;
      }
    }

    const withoutTrackingLinks = line
      .replace(/https?:\/\/\S*(?:ablink|click|track|utm_|mc_[ce]id|trk)\S*/gi, "")
      .replace(/https?:\/\/\S{120,}/gi, "")
      .trimEnd();
    if (withoutTrackingLinks.trim() || visible.at(-1)?.trim()) {
      visible.push(withoutTrackingLinks);
    }
  }

  const cleaned = visible.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned || "No readable text content in this message.";
}
function hasSchedulingIntent(value: string) { return /\b(meet|meeting|schedule|call|appointment|availability|free at|available on|book a time|time slot|sync up|catch up|catchup|let'?s talk|discussion)\b/i.test(value); }
function formatDateTime(value: string, timezone: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-SG", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
function formatTime(value: string, timezone: string) { return new Intl.DateTimeFormat("en-SG", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function formatDateRange(start: string, end: string, timezone: string) { return `${formatDateTime(start, timezone)} – ${formatTime(end, timezone)}`; }
function firstError(...errors: unknown[]) { return errors.find(Boolean); }
function isActionRequired(error: unknown) { return error instanceof ApiClientError && ["GOOGLE_REAUTH_REQUIRED", "GOOGLE_PERMISSION_REQUIRED", "UNAUTHORIZED"].includes(error.code); }
function actionRequiredError(error: unknown) { return isActionRequired(error) ? error : undefined; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
