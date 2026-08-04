import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Filter, Mail, RefreshCw, Settings, SquarePen } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { type EmailCategory, type EmailThread, type GmailStats, googleSignInUrl } from "@/lib/crm";
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
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filters = { category, priority, status, sender, responseOnly, unreadOnly, urgentOnly };
  const threadsQuery = useQuery({
    queryKey: ["crm", "threads", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (priority) params.set("priority", priority);
      if (status) params.set("status", status);
      if (sender.trim()) params.set("sender", sender.trim());
      if (responseOnly) params.set("requiresResponse", "true");
      if (unreadOnly) params.set("unreadOnly", "true");
      if (urgentOnly) params.set("urgentOnly", "true");
      return api.get<{ threads: EmailThread[]; cached: boolean }>(`/api/gmail?${params}`);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const activeFilterCount = [
    category,
    priority,
    status,
    sender.trim(),
    responseOnly ? "on" : "",
    unreadOnly ? "on" : "",
    urgentOnly ? "on" : "",
  ].filter(Boolean).length;
  const resetManualFilters = () => {
    setCategory("");
    setPriority("");
    setStatus("");
    setSender("");
  };
  const handleTotalTap = () => {
    resetManualFilters();
    setResponseOnly(false);
    setUnreadOnly(false);
    setUrgentOnly(false);
  };
  const handleUnreadTap = () => {
    if (unreadOnly) {
      setUnreadOnly(false);
      return;
    }
    resetManualFilters();
    setResponseOnly(false);
    setUrgentOnly(false);
    setUnreadOnly(true);
  };
  const handleUrgentTap = () => {
    if (urgentOnly) {
      setUrgentOnly(false);
      return;
    }
    resetManualFilters();
    setResponseOnly(false);
    setUnreadOnly(false);
    setUrgentOnly(true);
  };
  const handleReplyTap = () => {
    if (responseOnly) {
      setResponseOnly(false);
      return;
    }
    resetManualFilters();
    setUnreadOnly(false);
    setUrgentOnly(false);
    setResponseOnly(true);
  };
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
    onError: () => notify({ title: "Couldn't reclassify threads", body: "Try again in a moment." }),
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
    onError: () => notify({ title: "Couldn't archive threads", body: "Try again in a moment." }),
  });
  const bulkDraftMutation = useMutation({
    mutationFn: () => api.post<{ generated: number }>("/api/gmail/bulk/replies", { threadIds: [...selectedIds] }),
    onSuccess: async (data) => {
      setSelectedIds(new Set());
      setSelectMode(false);
      notify({ title: `${data.generated} drafts generated`, body: "No emails were sent." });
      await invalidateInbox();
    },
    onError: () =>
      notify({
        title: "Couldn't generate drafts",
        body: "Try again in a moment. Note: drafts can only be generated for 20 threads at a time.",
      }),
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

  // `gmailSyncQuery` is a background refresh (mount + every 2 min + every
  // window focus) that always hits live Gmail — a transient hiccup there
  // must not block the screen when threadsQuery already has cached data to
  // show. A reauth prompt is the exception: it's actionable and worth
  // surfacing even while stale cached data is still on screen.
  const reauthError = [threadsQuery.error, statsQuery.error, gmailSyncQuery.error].find(isActionRequired);
  const blockingError = threadsQuery.data ? undefined : threadsQuery.error ?? statsQuery.error;
  const topError = reauthError ?? blockingError;

  return (
    <div className="m-controller-page flex flex-col gap-4">
      <MobileCrmHeader
        title="Inbox"
        actionsRight={
          <>
            <button
              type="button"
              onClick={() => void navigate({ to: "/m/crm/settings" })}
              className="m-icon-button m-press"
              aria-label="Settings"
            >
              <Settings width={17} height={17} />
            </button>
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="m-press flex h-11 items-center gap-1.5 rounded-full bg-[var(--m-primary)] px-3.5 text-[12px] font-semibold text-[var(--m-primary-fg)]"
            >
              <SquarePen width={15} height={15} /> Compose
            </button>
          </>
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
      <div className="flex items-center gap-1.5">
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
        <span className="mx-0.5 h-5 w-px bg-[var(--m-border)]" aria-hidden="true" />
        <button
          type="button"
          onClick={() => bulkClassifyMutation.mutate()}
          disabled={bulkClassifyMutation.isPending}
          className="m-press flex h-9 items-center rounded-full px-2.5 text-[11.5px] font-medium text-[var(--m-text-3)] disabled:opacity-40"
        >
          Reclassify
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectMode((current) => !current);
            setSelectedIds(new Set());
          }}
          className={`m-press ml-auto flex h-9 items-center rounded-full border px-3 text-[12px] font-semibold ${
            selectMode
              ? "border-[var(--m-primary)]/50 bg-[var(--m-primary)]/15 text-[var(--m-primary)]"
              : "border-[var(--m-border)] text-[var(--m-text-2)]"
          }`}
        >
          Select
        </button>
      </div>

      <div className="m-card grid grid-cols-4 divide-x divide-[var(--m-border)] overflow-hidden">
        <Stat label="Total" value={statsQuery.data?.stats.total} active={activeFilterCount === 0} onClick={handleTotalTap} />
        <Stat
          label="Unread"
          value={statsQuery.data?.stats.unread}
          color="var(--m-primary)"
          active={unreadOnly}
          onClick={handleUnreadTap}
        />
        <Stat
          label="Urgent"
          value={statsQuery.data?.stats.urgent}
          color="#e0524a"
          active={urgentOnly}
          onClick={handleUrgentTap}
        />
        <Stat
          label="Reply"
          value={statsQuery.data?.stats.requiresResponse}
          color="#4472ca"
          active={responseOnly}
          onClick={handleReplyTap}
        />
      </div>

      {topError && (
        <MobileErrorState
          title={isActionRequired(topError) ? "Reconnect Google" : "Couldn't load your inbox"}
          message={
            isActionRequired(topError)
              ? "Your Google connection needs to be refreshed to continue."
              : "Check your connection and try again."
          }
          onRetry={() => {
            if (isActionRequired(topError)) {
              window.location.assign(googleSignInUrl());
              return;
            }
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
          theme="dark"
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
                    setUnreadOnly(false);
                    setUrgentOnly(false);
                  }}
                  className="m-press text-[12px] font-semibold text-[var(--m-text-3)]"
                >
                  Clear all
                </button>
              )}
            </div>

            <div className="mt-4 space-y-3">
              <MobileFilterSelect
                label="Category"
                value={category}
                values={CATEGORIES}
                onChange={(value) => {
                  setCategory(value);
                  setUnreadOnly(false);
                  setUrgentOnly(false);
                }}
                asPanel
              />
              <MobileFilterSelect
                label="Priority"
                value={priority}
                values={PRIORITIES}
                onChange={(value) => {
                  setPriority(value);
                  setUnreadOnly(false);
                  setUrgentOnly(false);
                }}
                asPanel
              />
              <MobileFilterSelect
                label="Status"
                value={status}
                values={STATUSES}
                onChange={(value) => {
                  setStatus(value);
                  setUnreadOnly(false);
                  setUrgentOnly(false);
                }}
                asPanel
              />
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">Sender</span>
                <input
                  value={sender}
                  onChange={(event) => {
                    setSender(event.target.value);
                    setUnreadOnly(false);
                    setUrgentOnly(false);
                  }}
                  placeholder="Filter by sender"
                  className="m-field w-full"
                />
              </label>
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="text-[13px] font-medium text-[var(--m-text)]">Needs response only</span>
                <TogglePill
                  checked={responseOnly}
                  onChange={(next) => {
                    setResponseOnly(next);
                    setUnreadOnly(false);
                    setUrgentOnly(false);
                  }}
                  label="Needs response only"
                />
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

function Stat({
  label,
  value,
  color,
  active,
  onClick,
}: {
  label: string;
  value?: number;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="m-press w-full min-w-0 px-2 py-3 text-center transition-colors"
      style={{ backgroundColor: active ? `${color ?? "var(--m-primary)"}1f` : undefined }}
    >
      <p
        className="font-mono text-[18px] font-black tabular-nums"
        style={{ color: value ? (color ?? "var(--m-text)") : "var(--m-text-3)" }}
      >
        {value ?? "—"}
      </p>
      <p className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--m-text-3)]">{label}</p>
    </button>
  );
}

const CATEGORY_COLOR: Record<EmailCategory, string> = {
  billing: "#d9933c",
  scheduling: "#4472ca",
  urgent: "#e0524a",
  support: "#4d9da8",
  newsletter: "#9065b0",
  general: "#8b919a",
};

const AVATAR_COLORS = ["#4472ca", "#4d9da8", "#6ba35e", "#d9933c", "#d15796", "#9065b0", "#d97706"];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
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
  const displayName = thread.fromName || thread.fromEmail || "Unknown sender";
  const color = avatarColor(displayName);

  return (
    <div className="flex w-full items-start">
      {selectMode && (
        <label className="flex h-full shrink-0 items-center py-3.5 pl-3.5">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleCheck}
            className="h-5 w-5 rounded border-[var(--m-border)]"
            aria-label={`Select ${thread.subject ?? "thread"}`}
          />
        </label>
      )}
      <button
        type="button"
        onClick={selectMode ? onToggleCheck : onOpen}
        className={`m-press flex flex-1 items-start gap-3 py-3.5 pr-3.5 text-left ${selectMode ? "pl-2.5" : "pl-3.5"}`}
      >
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
          style={{
            backgroundColor: thread.hasUnread ? color : `${color}55`,
            boxShadow: thread.hasUnread ? `0 0 0 2px var(--m-surface), 0 0 0 3.5px ${color}` : undefined,
          }}
          aria-hidden="true"
        >
          {initials(displayName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`truncate text-[14px] ${thread.hasUnread ? "font-semibold text-[var(--m-text)]" : "font-medium text-[var(--m-text-3)]"}`}>
              {displayName}
            </span>
            <time className="ml-auto shrink-0 text-[10.5px] text-[var(--m-text-3)]">
              {thread.lastMessageDate ? formatInboxDate(thread.lastMessageDate) : ""}
            </time>
          </span>
          <span className={`mt-0.5 block truncate text-[13.5px] ${thread.hasUnread ? "font-semibold text-[var(--m-text)]" : "font-medium text-[var(--m-text-2)]"}`}>
            {thread.subject || "(No subject)"}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] leading-snug text-[var(--m-text-3)]">
            {thread.snippet || "No message preview"}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1 text-[10px] font-semibold capitalize text-[var(--m-text-3)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[thread.category] }} />
              {thread.category}
            </span>
            {thread.requiresResponse && (
              <span className="rounded-full bg-[var(--m-primary)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--m-primary)]">
                Reply needed
              </span>
            )}
          </span>
        </span>
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
