import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Mail, RefreshCw, SquarePen } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { type EmailThread, type GmailStats } from "@/lib/crm";
import { MobileErrorState } from "@/components/mobile/error-state";
import { MobileCrmHeader } from "@/components/crm/mobile/mobile-crm-header";
import { ComposerDialog } from "@/components/crm/composer-dialog";

export const Route = createFileRoute("/m/crm/")({
  component: MobileCrmInbox,
});

const crmLayoutRoute = getRouteApi("/m/crm");

function isActionRequired(error: unknown) {
  return (
    error instanceof ApiClientError &&
    ["GOOGLE_REAUTH_REQUIRED", "GOOGLE_PERMISSION_REQUIRED", "UNAUTHORIZED"].includes(error.code)
  );
}

function MobileCrmInbox() {
  const { session } = crmLayoutRoute.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);

  const threadsQuery = useQuery({
    queryKey: ["crm", "threads", {}],
    queryFn: () => api.get<{ threads: EmailThread[]; cached: boolean }>("/api/gmail"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const statsQuery = useQuery({
    queryKey: ["crm", "stats"],
    queryFn: () => api.get<{ stats: GmailStats }>("/api/gmail/stats"),
  });
  const gmailSyncQuery = useQuery({
    queryKey: ["crm", "gmail-sync"],
    queryFn: () => api.get<{ threads: EmailThread[] }>("/api/gmail?refresh=true"),
    staleTime: 90_000,
    refetchInterval: (query) => (isActionRequired(query.state.error) ? false : 120_000),
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => !isActionRequired(error) && failureCount < 2,
  });

  const threads = threadsQuery.data?.threads ?? [];

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

  const recentContacts = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const thread of threads) {
      if (thread.fromEmail && !seen.has(thread.fromEmail)) {
        seen.set(thread.fromEmail, thread.fromName);
      }
    }
    return [...seen.entries()].map(([email, name]) => ({ email, name }));
  }, [threads]);

  const topError = threadsQuery.error ?? statsQuery.error;

  return (
    <div className="m-controller-page flex flex-col gap-4">
      <MobileCrmHeader
        title="Inbox"
        actionsRight={
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="m-press flex h-11 items-center gap-1.5 rounded-full bg-[var(--m-primary)] px-3.5 text-[12px] font-semibold text-[var(--m-primary-fg)]"
          >
            <SquarePen width={15} height={15} /> Compose
          </button>
        }
      />

      {/*
        A second, lightweight row for view controls (sync now; Task 2 adds
        Filter/Reclassify/Select here too). Keeping these out of the header
        itself matters: MobileCrmHeader's row already carries the title and
        Compose, and Task 4 adds a Settings icon there too — cramming every
        action into one row would overflow a narrow phone's width. This
        toolbar row has its own budget instead.
      */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void gmailSyncQuery.refetch()}
          disabled={gmailSyncQuery.isFetching}
          className="m-icon-button m-press"
          aria-label="Sync Gmail now"
        >
          <RefreshCw width={17} height={17} className={gmailSyncQuery.isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="m-card grid grid-cols-4 divide-x divide-[var(--m-border)] overflow-hidden">
        <Stat label="Total" value={statsQuery.data?.stats.total} />
        <Stat label="Unread" value={statsQuery.data?.stats.unread} />
        <Stat label="Urgent" value={statsQuery.data?.stats.urgent} />
        <Stat label="Reply" value={statsQuery.data?.stats.requiresResponse} />
      </div>

      {topError && (
        <MobileErrorState
          title="Couldn't load your inbox"
          message="Check your connection and try again."
          onRetry={() => {
            void threadsQuery.refetch();
            void statsQuery.refetch();
          }}
        />
      )}

      <div className="m-card divide-y divide-[var(--m-border)] overflow-hidden">
        {threadsQuery.isLoading ? (
          <>
            <div className="m-skeleton h-[76px]" />
            <div className="m-skeleton h-[76px]" />
            <div className="m-skeleton h-[76px]" />
          </>
        ) : threads.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center">
            <Mail width={20} height={20} className="text-[var(--m-text-3)]" />
            <p className="text-[12px] font-semibold text-[var(--m-text-2)]">No threads match</p>
            <p className="text-[10px] text-[var(--m-text-3)]">Gmail will retry automatically.</p>
          </div>
        ) : (
          threads.map((thread) => (
            <MobileThreadRow
              key={thread.gmailThreadId}
              thread={thread}
              onOpen={() =>
                // @ts-expect-error -- /m/crm/$threadId doesn't exist until Task 3 creates
                // it; TanStack Router's typed routes reject this forward reference until
                // then. Remove this suppression once that route file lands (it will start
                // failing as unused, which is the intended signal to remove it).
                void navigate({ to: "/m/crm/$threadId", params: { threadId: thread.gmailThreadId } })
              }
            />
          ))
        )}
      </div>

      {composerOpen && (
        <ComposerDialog
          mode="new"
          open={composerOpen}
          onOpenChange={setComposerOpen}
          session={session}
          recentContacts={recentContacts}
          invalidateInbox={invalidateInbox}
          onNotice={(message) => void message}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="min-w-0 px-2 py-2.5 text-center">
      <p className="font-mono text-[16px] font-black tabular-nums text-[var(--m-text)]">{value ?? "—"}</p>
      <p className="mt-0.5 truncate text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--m-text-3)]">{label}</p>
    </div>
  );
}

function MobileThreadRow({ thread, onOpen }: { thread: EmailThread; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="m-press flex min-h-[76px] w-full flex-col items-start gap-1 px-3.5 py-3 text-left">
      <div className="flex w-full min-w-0 items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${thread.hasUnread ? "bg-[var(--m-primary)]" : "bg-transparent"}`} aria-hidden="true" />
        <span className={`truncate text-[13px] ${thread.hasUnread ? "font-semibold text-[var(--m-text)]" : "font-medium text-[var(--m-text-2)]"}`}>
          {thread.fromName || thread.fromEmail || "Unknown sender"}
        </span>
        <time className="ml-auto shrink-0 text-[10px] text-[var(--m-text-3)]">
          {thread.lastMessageDate ? formatInboxDate(thread.lastMessageDate) : ""}
        </time>
      </div>
      <p className={`w-full truncate text-[13px] ${thread.hasUnread ? "font-semibold text-[var(--m-text)]" : "font-medium text-[var(--m-text-2)]"}`}>
        {thread.subject || "(No subject)"}
      </p>
      <p className="w-full truncate text-[11px] text-[var(--m-text-3)]">{thread.snippet || "No message preview"}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded border border-[var(--m-border)] px-1.5 py-0.5 text-[9px] font-medium capitalize text-[var(--m-text-3)]">
          {thread.category}
        </span>
        {thread.requiresResponse && (
          <span className="rounded bg-[var(--m-primary)]/20 px-1.5 py-0.5 text-[9px] font-medium text-[var(--m-primary)]">
            Reply needed
          </span>
        )}
      </div>
    </button>
  );
}

function formatInboxDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("en-SG", { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(
    "en-SG",
    date.getFullYear() === now.getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "2-digit" },
  ).format(date);
}
