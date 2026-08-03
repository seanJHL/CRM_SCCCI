import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Filter, Mail, RefreshCw, SquarePen } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { type EmailThread, type GmailStats } from "@/lib/crm";
import { MobileErrorState } from "@/components/mobile/error-state";
import { MobileCrmHeader } from "@/components/crm/mobile/mobile-crm-header";
import { ComposerDialog } from "@/components/crm/composer-dialog";
import { notify } from "@/components/mobile/notification-banner";
import { TogglePill } from "@/components/mobile/toggle-pill";
import { CATEGORIES, MobileFilterSelect, PRIORITIES, STATUSES } from "@/components/crm/mobile/mobile-filter-select";

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
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");
  const [sender, setSender] = useState("");
  const [responseOnly, setResponseOnly] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
      return api.get<{ threads: EmailThread[]; cached: boolean }>(`/api/gmail?${params}`);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const activeFilterCount = [category, priority, status, sender.trim(), responseOnly ? "on" : ""].filter(Boolean).length;
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

  const bulkClassifyMutation = useMutation({
    mutationFn: () => api.post("/api/gmail/bulk/classify", {}),
    onSuccess: async () => {
      notify({ title: "Threads reclassified" });
      await invalidateInbox();
    },
  });
  const bulkUpdateMutation = useMutation({
    mutationFn: (updates: { status: "archived" }) =>
      api.post("/api/gmail/bulk/update", { threadIds: [...selectedIds], updates }),
    onSuccess: async () => {
      setSelectedIds(new Set());
      setSelectMode(false);
      notify({ title: "Threads archived" });
      await invalidateInbox();
    },
  });
  const bulkDraftMutation = useMutation({
    mutationFn: () => api.post<{ generated: number }>("/api/gmail/bulk/replies", { threadIds: [...selectedIds] }),
    onSuccess: async (data) => {
      setSelectedIds(new Set());
      setSelectMode(false);
      notify({ title: `${data.generated} drafts generated`, body: "No emails were sent." });
      await invalidateInbox();
    },
  });
  const bulkPending = bulkClassifyMutation.isPending || bulkUpdateMutation.isPending || bulkDraftMutation.isPending;

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
        <button
          type="button"
          onClick={() => setFilterSheetOpen(true)}
          className="m-icon-button m-press relative"
          aria-label="Filter threads"
        >
          <Filter width={17} height={17} />
          {activeFilterCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--m-primary)] text-[8px] font-bold text-[var(--m-primary-fg)]">
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => bulkClassifyMutation.mutate()}
          disabled={bulkClassifyMutation.isPending}
          className="m-press flex h-11 items-center rounded-full border border-[var(--m-border)] px-2.5 text-[11px] font-semibold text-[var(--m-text-2)] disabled:opacity-40"
        >
          Reclassify
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectMode((current) => !current);
            setSelectedIds(new Set());
          }}
          className={`m-press ml-auto flex h-11 items-center rounded-full px-3 text-[12px] font-semibold ${
            selectMode ? "bg-[var(--m-primary)] text-[var(--m-primary-fg)]" : "border border-[var(--m-border)] text-[var(--m-text-2)]"
          }`}
        >
          Select
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
              selectMode={selectMode}
              checked={selectedIds.has(thread.gmailThreadId)}
              onToggleCheck={() =>
                setSelectedIds((current) => {
                  const next = new Set(current);
                  if (next.has(thread.gmailThreadId)) next.delete(thread.gmailThreadId);
                  else next.add(thread.gmailThreadId);
                  return next;
                })
              }
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

      {selectMode && (
        <div className="m-card flex items-center gap-2 p-3">
          <span className="text-[11px] font-medium text-[var(--m-text-2)]">{selectedIds.size} selected</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => bulkDraftMutation.mutate()}
              disabled={selectedIds.size === 0 || bulkPending}
              className="m-secondary-button m-press px-3 text-[12px] disabled:opacity-40"
            >
              Generate drafts
            </button>
            <button
              type="button"
              onClick={() => bulkUpdateMutation.mutate({ status: "archived" })}
              disabled={selectedIds.size === 0 || bulkPending}
              className="m-secondary-button m-press px-3 text-[12px] disabled:opacity-40"
            >
              Archive
            </button>
          </div>
        </div>
      )}

      {composerOpen && (
        <ComposerDialog
          mode="new"
          open={composerOpen}
          onOpenChange={setComposerOpen}
          session={session}
          recentContacts={recentContacts}
          invalidateInbox={invalidateInbox}
          onNotice={(message) => notify({ title: message })}
        />
      )}

      <DialogPrimitive.Root open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm" />
          <DialogPrimitive.Content className="m-controller-surface fixed bottom-0 left-1/2 z-[71] w-full max-w-lg -translate-x-1/2 rounded-t-[26px] border border-b-0 border-[var(--m-border)] bg-[#20282d] p-4 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <div className="flex items-center justify-between gap-3">
              <DialogPrimitive.Title className="text-[18px] font-semibold tracking-tight text-[var(--m-text)]">
                Filters
              </DialogPrimitive.Title>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCategory("");
                    setPriority("");
                    setStatus("");
                    setSender("");
                    setResponseOnly(false);
                  }}
                  className="m-press text-[12px] font-semibold text-[var(--m-text-3)]"
                >
                  Clear all
                </button>
              )}
            </div>

            <div className="mt-4 space-y-3">
              <MobileFilterSelect label="Category" value={category} values={CATEGORIES} onChange={setCategory} />
              <MobileFilterSelect label="Priority" value={priority} values={PRIORITIES} onChange={setPriority} />
              <MobileFilterSelect label="Status" value={status} values={STATUSES} onChange={setStatus} />
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">Sender</span>
                <input
                  value={sender}
                  onChange={(event) => setSender(event.target.value)}
                  placeholder="Filter by sender"
                  className="m-field w-full"
                />
              </label>
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="text-[13px] font-medium text-[var(--m-text)]">Needs response only</span>
                <TogglePill checked={responseOnly} onChange={setResponseOnly} label="Needs response only" />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setFilterSheetOpen(false)}
              className="m-primary-button m-press mt-5 w-full"
            >
              Apply filters
            </button>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
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

function MobileThreadRow({
  thread,
  selectMode,
  checked,
  onToggleCheck,
  onOpen,
}: {
  thread: EmailThread;
  selectMode: boolean;
  checked: boolean;
  onToggleCheck: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex min-h-[76px] w-full items-center">
      {selectMode && (
        <label className="flex h-full shrink-0 items-center px-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleCheck}
            className="h-5 w-5 rounded border-[var(--m-border)]"
            aria-label={`Select ${thread.subject ?? "thread"}`}
          />
        </label>
      )}
      <button type="button" onClick={selectMode ? onToggleCheck : onOpen} className="m-press flex min-h-[76px] flex-1 flex-col items-start gap-1 py-3 pr-3.5 text-left">
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
    </div>
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
