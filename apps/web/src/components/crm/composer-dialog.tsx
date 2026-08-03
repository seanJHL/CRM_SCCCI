import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Loader2,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import {
  type AvailabilityResult,
  type EmailThread,
  errorMessage,
  googleSignInUrl,
  type ParsedSchedule,
  type SendMessageResult,
  type SessionData,
  type SuggestedReply,
  type SuggestedSlot,
  type ThreadDetailData,
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
import { Field } from "@/components/ui/field";

interface ComposerDialogCommonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: SessionData;
  invalidateInbox: () => Promise<void>;
  onNotice: (message: string) => void;
}

interface RecentContact {
  email: string;
  name: string | null;
}

type ComposerDialogProps =
  | (ComposerDialogCommonProps & {
      mode: "reply";
      thread: EmailThread;
      detail: ThreadDetailData | undefined;
    })
  | (ComposerDialogCommonProps & {
      mode: "new";
      recentContacts: RecentContact[];
    });

export function ComposerDialog(props: ComposerDialogProps) {
  const queryClient = useQueryClient();
  const { session } = props;

  const isReply = props.mode === "reply";
  const thread = isReply ? props.thread : undefined;
  const detail = isReply ? props.detail : undefined;

  const [replyBody, setReplyBody] = useState("");
  const [replyDraftId, setReplyDraftId] = useState<string | null>(null);
  const [draftHydratedFor, setDraftHydratedFor] = useState<string | null>(null);
  const [sendConfirmationOpen, setSendConfirmationOpen] = useState(false);

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
  const [attachMeeting, setAttachMeeting] = useState(true);
  const [bookingConfirmationOpen, setBookingConfirmationOpen] = useState(false);

  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("");

  const recipientEmail = isReply ? (thread!.fromEmail ?? "") : toEmail.trim();
  const messageSubject = isReply ? (detail?.thread.subject || thread!.subject || "") : subject;
  const dialogKey = isReply ? thread!.gmailThreadId : "new";
  const toEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail.trim());
  // Read by mutations that are exclusively defined and invoked in reply
  // mode. generateReplyMutation, saveDraftMutation, discardDraftMutation,
  // and sendReplyMutation use this typed alias for their `thread.xxx`
  // references now that `thread` is optional; bookingMutation instead uses
  // `thread!` directly. Each of these mutations guards against a missing
  // `thread` at the top of its `mutationFn` (see below), since JSX gating
  // alone isn't an invariant the type system can enforce.
  const replyThread = thread as EmailThread;

  const attendeeEmails = useMemo(
    () =>
      attendeeText
        .split(/[;,]/)
        .map((email) => email.trim())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
    [attendeeText],
  );

  // Reset meeting/schedule fields to this thread's defaults every time the
  // dialog opens — matches the previous behavior of openComposerForThread.
  useEffect(() => {
    if (!props.open) return;
    if (isReply) {
      setMeetingTitle(thread!.subject ?? "Meeting");
      setMeetingDescription(
        `Scheduled from Gmail thread: ${thread!.subject ?? "Untitled conversation"}\n\nEmail context: ${thread!.snippet ?? ""}`,
      );
      setAttendeeText(thread!.fromEmail ?? "");
    } else {
      setToEmail("");
      setSubject("");
      setMeetingTitle("");
      setMeetingDescription("");
      setAttendeeText("");
    }
    setMeetingLocation("");
    setAddMeetLink(false);
    setAttachMeeting(true);
    setParsedSchedule(null);
    setAvailability(null);
    setSuggestedSlots([]);
    setSelectedSlot(null);
    setAmbiguityConfirmed(false);
    setScheduleMessage(null);
  }, [props.open, dialogKey]);

  useEffect(() => {
    if (!isReply || !detail || draftHydratedFor === thread!.gmailThreadId) return;
    const latestDraft = detail.replies.find((reply) => reply.status !== "sent");
    setReplyBody(latestDraft?.body ?? "");
    setReplyDraftId(latestDraft?.id ?? null);
    setDraftHydratedFor(thread!.gmailThreadId);
  }, [detail, draftHydratedFor, isReply]);

  const generateReplyMutation = useMutation({
    mutationFn: (regenerate: boolean) => {
      if (!thread) throw new Error("generateReplyMutation is reply-only and was invoked without a thread");
      return api.post<{ reply: SuggestedReply }>(`/api/gmail/${replyThread.gmailThreadId}/reply`, {
        regenerate,
        currentBody: replyBody,
        draftId: replyDraftId ?? undefined,
      });
    },
    onSuccess: (data) => {
      setReplyBody(data.reply.body);
      setReplyDraftId(data.reply.id);
      props.onNotice("A reviewable draft was generated. Nothing has been sent.");
    },
  });
  const saveDraftMutation = useMutation({
    mutationFn: () => {
      if (!thread) throw new Error("saveDraftMutation is reply-only and was invoked without a thread");
      return api.post<{ reply: SuggestedReply }>(`/api/gmail/${replyThread.gmailThreadId}/draft`, {
        body: replyBody,
        draftId: replyDraftId ?? undefined,
      });
    },
    onSuccess: async (data) => {
      setReplyDraftId(data.reply.id);
      props.onNotice("Draft saved. Nothing has been sent.");
      await queryClient.invalidateQueries({
        queryKey: ["crm", "thread", replyThread.gmailThreadId],
      });
    },
  });
  const discardDraftMutation = useMutation({
    mutationFn: async () => {
      if (!thread) throw new Error("discardDraftMutation is reply-only and was invoked without a thread");
      if (!replyDraftId) return { discarded: true };
      return api.delete<{ discarded: boolean }>(
        `/api/gmail/${replyThread.gmailThreadId}/draft/${replyDraftId}`,
      );
    },
    onSuccess: async () => {
      setReplyBody("");
      setReplyDraftId(null);
      props.onOpenChange(false);
      props.onNotice("Draft discarded.");
      await queryClient.invalidateQueries({
        queryKey: ["crm", "thread", replyThread.gmailThreadId],
      });
    },
  });
  const sendReplyMutation = useMutation({
    mutationFn: () => {
      if (!thread) throw new Error("sendReplyMutation is reply-only and was invoked without a thread");
      return api.post(`/api/gmail/${replyThread.gmailThreadId}/reply/send`, {
        body: replyBody,
        to: replyThread.fromEmail ?? undefined,
        draftId: replyDraftId ?? undefined,
        confirmed: true,
      });
    },
    onSuccess: async () => {
      setSendConfirmationOpen(false);
      props.onOpenChange(false);
      setReplyBody("");
      setReplyDraftId(null);
      props.onNotice("Reply sent through Gmail.");
      await props.invalidateInbox();
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: () =>
      api.post<SendMessageResult>("/api/gmail/send", {
        to: toEmail.trim(),
        subject: subject.trim(),
        body: replyBody,
        confirmed: true as const,
        ...(attachMeeting && canReviewBooking && selectedSlot
          ? {
              meeting: {
                title: meetingTitle.trim() || "Meeting",
                start: selectedSlot.start,
                end: selectedSlot.end,
                attendees: attendeeEmails.map((email) => ({ email })),
                description: meetingDescription.trim() || undefined,
                location: meetingLocation.trim() || undefined,
                addMeetLink,
              },
            }
          : {}),
      }),
    onSuccess: async (data) => {
      setSendConfirmationOpen(false);
      props.onOpenChange(false);
      setReplyBody("");
      await props.invalidateInbox();
      if (data.bookingError) {
        // The backend only ever sets one of `booking`/`bookingError`, never
        // both — check bookingError first, independent of `booking`, so a
        // real booking failure is never masked as a bare "Message sent."
        props.onNotice(`Message sent, but the calendar event could not be created: ${data.bookingError}`);
      } else if (data.booking) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
        props.onNotice("Message sent and added to Ember Calendar.");
      } else {
        props.onNotice("Message sent.");
      }
    },
  });

  const schedulingContext = useMemo(() => {
    if (!isReply) return replyBody.slice(0, 50_000);
    const messages =
      [...(detail?.thread.messages ?? [])]
        .reverse()
        .slice(0, 6)
        .map((message) => message.bodyText || message.snippet)
        .join("\n\n") ||
      thread!.snippet ||
      "";
    return `Draft reply:\n${replyBody}\n\nMost recent conversation first:\n${messages}`.slice(
      0,
      50_000,
    );
  }, [detail, isReply, replyBody, thread]);

  const parseScheduleMutation = useMutation({
    mutationFn: async (input: { text: string; participantEmails: string[] }) => {
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
      if (!isReply) {
        if (!meetingTitle.trim() && subject.trim()) setMeetingTitle(subject.trim());
        if (!attendeeText.trim() && toEmail.trim()) setAttendeeText(toEmail.trim());
      }
    },
  });

  useEffect(() => {
    if (!props.open) return;
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
  }, [attendeeEmails, props.open, schedulingContext]);

  function resetScheduleResults() {
    setParsedSchedule(null);
    setAvailability(null);
    setSuggestedSlots([]);
    setSelectedSlot(null);
    setAmbiguityConfirmed(false);
  }

  const bookingMutation = useMutation({
    mutationFn: async () => {
      if (!thread) throw new Error("bookingMutation is reply-only and was invoked without a thread");
      if (!selectedSlot) throw new Error("Select a time slot first");
      return api.post("/api/calendar-crm/events", {
        title: meetingTitle.trim() || "Meeting",
        start: selectedSlot.start,
        end: selectedSlot.end,
        attendees: attendeeEmails.map((email) => ({ email })),
        description: meetingDescription.trim() || undefined,
        location: meetingLocation.trim() || undefined,
        confirmed: true as const,
        addMeetLink,
        sourceThreadId: thread!.id,
      });
    },
    onSuccess: async () => {
      setBookingConfirmationOpen(false);
      props.onNotice("Meeting created and added to Ember Calendar.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.events.all }),
        props.invalidateInbox(),
      ]);
    },
  });

  const composerError = firstError(
    generateReplyMutation.error,
    saveDraftMutation.error,
    discardDraftMutation.error,
    parseScheduleMutation.error,
  );
  const canReviewBooking = Boolean(
    selectedSlot && (!parsedSchedule?.isAmbiguous || ambiguityConfirmed),
  );
  const insertSlotIntoReply = (slot: SuggestedSlot) => {
    const sentence = `Would ${formatDateRange(slot.start, slot.end, session.user.timezone)} (${session.user.timezone}) work for you?`;
    setReplyBody((current) => (current.trim() ? `${current.trim()}\n\n${sentence}` : sentence));
    setSelectedSlot(slot);
  };

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent
          onEscapeKeyDown={(event) => {
            // New-compose mode has no persisted draft, so an accidental
            // Escape/outside-click must not silently discard a non-empty
            // draft. An empty new-mode composer, or reply mode (which
            // hydrates from a persisted draft), dismisses normally.
            if (!isReply && (toEmail.trim() || subject.trim() || replyBody.trim())) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!isReply && (toEmail.trim() || subject.trim() || replyBody.trim())) event.preventDefault();
          }}
          className="bottom-0 left-0 top-auto flex h-[min(94dvh,920px)] w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-b-none rounded-t-2xl p-0 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:h-[min(90dvh,900px)] sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        >
          <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12 sm:px-6">
            <DialogTitle>{isReply ? "Create draft" : "Compose message"}</DialogTitle>
            {isReply && (
              <DialogDescription className="truncate">
                To: {thread!.fromEmail ?? "Thread participant"} · {detail?.thread.subject || thread!.subject || "No subject"}
              </DialogDescription>
            )}
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
                {isReply && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => generateReplyMutation.mutate(Boolean(replyBody.trim()))}
                    disabled={generateReplyMutation.isPending}
                  >
                    {generateReplyMutation.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    Suggest Message Reply
                  </Button>
                )}
              </div>
              {props.mode === "new" && (
                <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2">
                  <Field label="To">
                    <Input
                      type="email"
                      list="composer-recent-contacts"
                      value={toEmail}
                      onChange={(event) => setToEmail(event.target.value)}
                      placeholder="alex@example.com"
                    />
                    <datalist id="composer-recent-contacts">
                      {props.recentContacts.map((contact) => (
                        <option key={contact.email} value={contact.email}>
                          {contact.name ?? contact.email}
                        </option>
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Subject">
                    <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Project kickoff" />
                  </Field>
                </div>
              )}
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
                      {!isReply && (
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={attachMeeting}
                            disabled={!canReviewBooking}
                            onChange={(event) => setAttachMeeting(event.target.checked)}
                          />
                          Attach a calendar invite for this time
                        </label>
                      )}
                      {isReply && (
                        <p className="text-[11px] text-muted-foreground">A confirmation step appears before Calendar is changed.</p>
                      )}
                      {isReply && (
                        <Button onClick={() => setBookingConfirmationOpen(true)} disabled={!canReviewBooking}><CalendarDays /> Create Calendar event</Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <DialogFooter className="shrink-0 flex-wrap border-t border-border bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 sm:px-6 sm:pb-4">
            {isReply ? (
              <>
                <Button variant="ghost" onClick={() => discardDraftMutation.mutate()} disabled={discardDraftMutation.isPending} className="mr-auto text-muted-foreground"><Trash2 /> Discard</Button>
                <Button variant="outline" onClick={() => saveDraftMutation.mutate()} disabled={!replyBody.trim() || saveDraftMutation.isPending}>
                  {saveDraftMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save draft
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => props.onOpenChange(false)} className="mr-auto text-muted-foreground"><Trash2 /> Discard</Button>
            )}
            <Button
              onClick={() => setSendConfirmationOpen(true)}
              disabled={isReply ? !replyBody.trim() : !(toEmailValid && subject.trim() && replyBody.trim())}
            >
              <Send /> Review and send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendConfirmationOpen} onOpenChange={setSendConfirmationOpen}>
        <DialogContent className="max-w-xl p-6">
          <DialogHeader>
            <DialogTitle>{isReply ? "Send this reply?" : "Send this message?"}</DialogTitle>
            <DialogDescription>Review the final recipient and message. This is the only step that sends email.</DialogDescription>
          </DialogHeader>
          <div className="my-5 space-y-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <div>
              <p className="font-medium">To: {isReply ? (thread!.fromEmail ?? "Thread participant") : recipientEmail}</p>
              {!isReply && <p className="font-medium">Subject: {messageSubject}</p>}
              <p className="mt-3 max-h-60 whitespace-pre-wrap overflow-auto text-muted-foreground">{replyBody}</p>
            </div>
            {!isReply && attachMeeting && canReviewBooking && selectedSlot && (
              <div className="border-t border-border pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Also creates a calendar event</p>
                <p className="mt-1 font-semibold">{meetingTitle || "Meeting"}</p>
                <p>{formatDateRange(selectedSlot.start, selectedSlot.end, session.user.timezone)}</p>
                {attendeeEmails.length > 0 && <p className="text-muted-foreground">Guests: {attendeeEmails.join(", ")}</p>}
                {addMeetLink && <p className="text-muted-foreground">Google Meet link requested</p>}
              </div>
            )}
          </div>
          {(isReply ? sendReplyMutation.error : sendMessageMutation.error) && (
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
              {errorMessage(isReply ? sendReplyMutation.error : sendMessageMutation.error)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendConfirmationOpen(false)}>Keep editing</Button>
            <Button
              onClick={() => (isReply ? sendReplyMutation.mutate() : sendMessageMutation.mutate())}
              disabled={
                (isReply ? !replyBody.trim() : !(toEmailValid && subject.trim() && replyBody.trim())) ||
                (isReply ? sendReplyMutation.isPending : sendMessageMutation.isPending)
              }
            >
              {(isReply ? sendReplyMutation.isPending : sendMessageMutation.isPending) ? <Loader2 className="animate-spin" /> : <Send />} Confirm and send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isReply && (
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
      )}
    </>
  );
}

function firstError(...errors: unknown[]) {
  return errors.find(Boolean);
}
function hasSchedulingIntent(value: string) {
  return /\b(meet|meeting|schedule|call|appointment|availability|free at|available on|book a time|time slot|sync up|catch up|catchup|let'?s talk|discussion)\b/i.test(value);
}
function formatDateTime(value: string, timezone: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-SG", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-SG", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function formatDateRange(start: string, end: string, timezone: string) {
  return `${formatDateTime(start, timezone)} – ${formatTime(end, timezone)}`;
}
