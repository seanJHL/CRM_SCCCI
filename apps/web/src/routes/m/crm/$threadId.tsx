import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Info, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import {
  type EmailCategory,
  type EmailPriority,
  type EmailStatus,
  type EmailThread,
  type ThreadDetailData,
} from "@/lib/crm";
import { CATEGORIES, MobileFilterSelect, PRIORITIES, STATUSES } from "@/components/crm/mobile/mobile-filter-select";
import { MobileErrorState } from "@/components/mobile/error-state";
import { notify } from "@/components/mobile/notification-banner";
import { MobileCrmHeader } from "@/components/crm/mobile/mobile-crm-header";
import { ComposerDialog } from "@/components/crm/composer-dialog";

export const Route = createFileRoute("/m/crm/$threadId")({
  component: MobileCrmThreadDetail,
});

const crmLayoutRoute = getRouteApi("/m/crm");

function MobileCrmThreadDetail() {
  const { threadId } = Route.useParams();
  const { session } = crmLayoutRoute.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["crm", "thread", threadId],
    queryFn: () => api.get<ThreadDetailData>(`/api/gmail/${threadId}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // The thread-detail response doesn't include the cached `emailThreads.id`
  // (only the Gmail thread id and classification), but ComposerDialog's
  // booking path needs that real DB row id for `sourceThreadId`. The
  // Inbox's `["crm","threads",...]` query already has full EmailThread rows
  // (including `.id`) for every cached thread, so prefer that over
  // reconstructing a shim from the detail response.
  const cachedThread = queryClient
    .getQueriesData<{ threads: EmailThread[] }>({ queryKey: ["crm", "threads"] })
    .flatMap(([, data]) => data?.threads ?? [])
    .find((item) => item.gmailThreadId === threadId);

  const invalidateInbox = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["crm", "threads"] }),
      queryClient.invalidateQueries({ queryKey: ["crm", "stats"] }),
      queryClient.invalidateQueries({ queryKey: ["crm", "thread"] }),
    ]);
  };

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<Pick<EmailThread, "category" | "priority" | "status">>) =>
      api.patch(`/api/gmail/${threadId}`, updates),
    onSuccess: invalidateInbox,
    onError: () => notify({ title: "Couldn't update thread", body: "Try again in a moment." }),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="m-controller-page flex flex-col gap-4">
        <MobileCrmHeader title="Loading…" backTo="/m/crm" />
        <div className="m-skeleton h-40 rounded-2xl" />
        <div className="m-skeleton h-24 rounded-2xl" />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="m-controller-page flex flex-col gap-4">
        <MobileCrmHeader title="Conversation" backTo="/m/crm" />
        <MobileErrorState
          title="Conversation unavailable"
          message="Try syncing Gmail from the Inbox and opening it again."
          onRetry={() => void detailQuery.refetch()}
        />
      </div>
    );
  }

  const { thread, classification } = detailQuery.data;
  const threadShim: EmailThread =
    cachedThread ?? {
      id: threadId,
      userId: "",
      gmailThreadId: threadId,
      subject: thread.subject,
      snippet: thread.snippet,
      fromEmail: thread.fromEmail,
      fromName: thread.fromName,
      lastMessageDate: thread.lastMessageDate,
      category: classification?.category ?? "general",
      categoryManuallySet: false,
      priority: classification?.priority ?? "normal",
      priorityManuallySet: false,
      requiresResponse: classification?.requiresResponse ?? false,
      status: classification?.status ?? "unread",
      importanceReason: null,
      hasUnread: thread.hasUnread,
      createdAt: "",
      updatedAt: "",
    };

  return (
    <div className="m-controller-page flex flex-col gap-4">
      <MobileCrmHeader
        title={thread.subject || "(No subject)"}
        subtitle={thread.fromName || thread.fromEmail || "Conversation"}
        backTo="/m/crm"
        actionsRight={
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="m-press flex h-11 items-center gap-1.5 rounded-full bg-[var(--m-primary)] px-3.5 text-[12px] font-semibold text-[var(--m-primary-fg)]"
          >
            <Sparkles width={15} height={15} /> Draft
          </button>
        }
      />

      {classification && (
        <div className="m-card space-y-3 p-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <MobileFilterSelect
              label="Category"
              value={classification.category}
              values={CATEGORIES}
              onChange={(value) => updateMutation.mutate({ category: value as EmailCategory })}
            />
            <MobileFilterSelect
              label="Priority"
              value={classification.priority}
              values={PRIORITIES}
              onChange={(value) => updateMutation.mutate({ priority: value as EmailPriority })}
            />
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--m-text-3)]">Why it matters</p>
            <ul className="mt-1.5 space-y-1">
              {classification.importanceReasons.length ? (
                classification.importanceReasons.map((reason) => (
                  <li key={reason} className="flex gap-1.5 text-[11px] text-[var(--m-text-2)]">
                    <Info width={12} height={12} className="mt-0.5 shrink-0" />
                    {reason}
                  </li>
                ))
              ) : (
                <li className="text-[11px] text-[var(--m-text-2)]">No elevated importance signals found.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {detailQuery.data.stale && (
        <div className="m-inset px-3 py-2 text-[11px] text-[var(--m-text-2)]">
          Showing the latest cached preview while Gmail reconnects.
        </div>
      )}

      <div className="space-y-2">
        {thread.messages.map((message) => (
          <article key={message.id} className="m-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--m-border)] bg-[var(--m-surface-2)] px-3.5 py-2.5">
              <span className="truncate text-[12px] font-semibold text-[var(--m-text)]">
                {message.fromName || message.fromEmail}
              </span>
              <time className="shrink-0 text-[10px] text-[var(--m-text-3)]">{formatMessageDate(message.internalDate)}</time>
            </div>
            <p className="whitespace-pre-wrap break-words px-3.5 py-3 text-[13px] leading-6 text-[var(--m-text-2)]">
              {message.bodyText || message.snippet}
            </p>
          </article>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--m-border)] pt-3">
        <MobileFilterSelect
          label="Status"
          value={classification?.status ?? ""}
          values={STATUSES}
          onChange={(value) => updateMutation.mutate({ status: value as EmailStatus })}
        />
      </div>

      <ComposerDialog
        mode="reply"
        open={composerOpen}
        onOpenChange={setComposerOpen}
        thread={threadShim}
        detail={detailQuery.data}
        session={session}
        invalidateInbox={invalidateInbox}
        onNotice={(message) => {
          notify({ title: message });
          if (message === "Reply sent through Gmail.") void navigate({ to: "/m/crm" });
        }}
      />
    </div>
  );
}

function formatMessageDate(value: string) {
  const numberValue = Number(value);
  const date = new Date(Number.isFinite(numberValue) && numberValue > 1e12 ? numberValue : value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
}
