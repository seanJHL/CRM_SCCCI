# Mobile-native `/m/crm` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/m/crm`'s desktop-pass-through with a real mobile-native
CRM experience (Inbox, Thread Detail, Settings as nested routes) that uses
the same mobile design system every other `/m/*` page already uses.

**Architecture:** `apps/web/src/routes/m/crm.tsx` becomes a thin layout
route (auth guard + `<Outlet/>`), mirroring how `m.tsx` already relates to
`m/*` — with three new self-contained child routes
(`m/crm/index.tsx`, `m/crm/$threadId.tsx`, `m/crm/settings.tsx`) each owning
their own queries/mutations against the *same* backend endpoints desktop
`crm.tsx` already calls. `<ComposerDialog>` (already prop-driven and
mode-aware) is reused as-is for both reply and new-compose — no changes to
it or to the backend.

**Tech Stack:** TanStack Router (file-based, nested layout routes) +
TanStack Query, React, the app's hand-rolled `.m-*` mobile CSS design
system (`apps/web/src/styles/mobile.css`), lucide-react icons.

## Global Constraints

- No backend/API changes — every endpoint used here already exists and is
  already used by desktop `crm.tsx`.
- No changes to `ComposerDialog`'s internals (`apps/web/src/components/crm/composer-dialog.tsx`)
  — reused exactly as built, passed the same props desktop already passes.
- No changes to desktop `apps/web/src/routes/crm.tsx`.
- No new touch gestures (no swipe-to-archive, no pull-to-refresh) — taps
  and an explicit select-mode toggle instead.
- Follow the established mobile-route convention: each `/m/*` route owns
  its own data-fetching (confirmed in `m/workouts/index.tsx`,
  `m/workouts/$sessionId.tsx`) rather than sharing a hook with desktop;
  list→detail navigation is a real nested route
  (`workouts/index.tsx` + `workouts/$sessionId.tsx`), not in-component view
  state; a parent layout route with `<Outlet/>` plus child routes is
  already the established pattern one level up (`m.tsx` + `m/*`).
- This repo has no frontend test runner (`apps/web`'s `test` script is a
  no-op) and no automated tests for DB-backed Hono routes either (not
  relevant here since no backend changes). Verification is
  `pnpm --filter web typecheck`, `pnpm --filter web lint`, and a manual
  walkthrough in a mobile-width browser viewport.
- Reuse the shared mobile primitives exactly as their existing call sites
  do — do not invent new variants: `MobileErrorState` (`apps/web/src/components/mobile/error-state.tsx`,
  props `title?`, `message?`, `onRetry?`), `notify()` (`apps/web/src/components/mobile/notification-banner.tsx`,
  call as `notify({ title, body? })` — no extra wiring needed, `NotificationBanner`
  is already mounted globally in `m.tsx`), `TogglePill` (`apps/web/src/components/mobile/toggle-pill.tsx`,
  props `checked`, `onChange`, `disabled?`, `label?`).
- `.m-skeleton` for loading placeholders, `m-press` for tactile button
  feedback, `m-icon-button` for 44×44 icon buttons, `m-field`/`m-primary-button`/`m-secondary-button`
  for touch-sized form controls, `m-controller-page` for the page's root
  chassis — all defined in `apps/web/src/styles/mobile.css`, already used
  by every other mobile route.

---

## Task 1: Layout conversion + basic mobile Inbox

**Files:**
- Modify: `apps/web/src/routes/m/crm.tsx` (becomes a thin layout route)
- Create: `apps/web/src/routes/m/crm/index.tsx` (Inbox: header, stats,
  thread list, sync, Compose)
- Create: `apps/web/src/components/crm/mobile/mobile-crm-header.tsx`
  (shared header used by all three mobile CRM routes)
- Modify: `apps/web/src/routes/m.tsx` (remove the now-dead `.is-crm`
  escape hatch)
- Modify: `apps/web/src/styles/mobile.css` (remove the now-dead
  `.m-page-shell.is-crm` rule)

**Interfaces:**
- Consumes: `SessionData`, `EmailThread`, `GmailStats` types and
  `loadSession` from `@/lib/crm`; `api`/`ApiClientError` from `@/lib/api`;
  `ComposerDialog` from `@/components/crm/composer-dialog` (already built —
  props are `{ mode: "new"; open; onOpenChange; session; recentContacts;
  invalidateInbox; onNotice }` for new-compose, see that file for the full
  discriminated-union type); `MobileErrorState`, `notify` from
  `@/components/mobile/*`.
- Produces: `<MobileCrmHeader title actionsRight? onBack? />` (used by
  Tasks 3-4 too — props documented in Step 1 below). Route `/m/crm` now
  resolves through the layout to `/m/crm/index.tsx`; thread rows navigate
  to `/m/crm/$threadId` (built in Task 3 — until that task lands, tapping a
  row will hit TanStack Router's not-found page, which is expected and not
  a defect in *this* task).

This task has no automated tests (matches repo convention for frontend
work — see Global Constraints). Verification is `pnpm typecheck`/`pnpm lint`
plus a manual check in a mobile-width browser viewport.

- [ ] **Step 1: Create the shared mobile CRM header component**

Create `apps/web/src/components/crm/mobile/mobile-crm-header.tsx`:

```tsx
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

interface MobileCrmHeaderProps {
  title: string;
  subtitle?: string;
  /** When set, renders a back button that navigates here on tap. */
  backTo?: string;
  /** Icon buttons rendered on the right side of the header, in order. */
  actionsRight?: React.ReactNode;
}

/**
 * Shared header chrome for the three mobile CRM routes (Inbox, Thread
 * Detail, Settings) — consistent back-button/title placement without
 * forcing identical structure between them.
 */
export function MobileCrmHeader({ title, subtitle, backTo, actionsRight }: MobileCrmHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="m-anim-slide-up">
      <div className="flex items-center gap-2">
        {backTo && (
          <button
            type="button"
            onClick={() => void navigate({ to: backTo })}
            className="m-icon-button m-press shrink-0"
            aria-label="Back"
          >
            <ChevronLeft width={18} height={18} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="m-eyebrow truncate">{subtitle ?? "CRM"}</p>
          <h1 className="truncate text-[20px] font-semibold tracking-tight text-[var(--m-text)]">
            {title}
          </h1>
        </div>
        {actionsRight && (
          <div className="flex shrink-0 items-center gap-1.5">{actionsRight}</div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Convert `m/crm.tsx` into a thin layout route**

Replace the entire content of `apps/web/src/routes/m/crm.tsx` with:

```tsx
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { loadSession, type SessionData } from "@/lib/crm";

export const Route = createFileRoute("/m/crm")({
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
  component: () => <Outlet />,
});
```

(This is the exact same auth guard the old pass-through had — only what
`component` renders changes. Every child route under `m/crm/` inherits
`{ session }` via `Route.useRouteContext()`, the same way the old
component read it.)

- [ ] **Step 3: Create the Inbox route**

Create `apps/web/src/routes/m/crm/index.tsx`:

```tsx
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            <div className="m-skeleton m-inset m-8 h-[76px]" />
            <div className="m-skeleton m-inset m-8 h-[76px]" />
            <div className="m-skeleton m-inset m-8 h-[76px]" />
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
```

Notes on this step:
- `getRouteApi("/m/crm")` (from `@tanstack/react-router`) is how a route
  file reads an *ancestor* route's context without importing that route's
  `Route` export directly (avoiding a circular/awkward cross-file import
  between the layout and its children) — this is the standard TanStack
  Router idiom for exactly this parent-context-in-child-route case.
- `onNotice={(message) => void message}` is a placeholder no-op for this
  step only — Task 2 replaces it with a real `notify()` call once the
  toast wiring for this page is in place. Do not skip building it now
  correctly typed; just leave the body inert.
- This Inbox intentionally does **not** yet have filters, select mode, or
  bulk actions — that's Task 2. It also has no way to reach Settings yet
  — that's Task 4. Do not add either here.

- [ ] **Step 4: Retire the `.is-crm` shell escape hatch**

In `apps/web/src/routes/m.tsx`, remove the `isCrm` flag entirely:

```tsx
  const isLiveWorkout = /^\/m\/workouts\/[^/]+$/.test(pathname);
```

(delete the `const isCrm = pathname === "/m/crm";` line that followed it),
and change:

```tsx
      <main
        className={`m-page-shell mx-auto w-full max-w-lg flex-1${isLiveWorkout ? " is-live-workout" : ""}${isCrm ? " is-crm" : ""}`}
      >
```

to:

```tsx
      <main
        className={`m-page-shell mx-auto w-full max-w-lg flex-1${isLiveWorkout ? " is-live-workout" : ""}`}
      >
```

In `apps/web/src/styles/mobile.css`, delete this rule entirely (it directly
follows `.m-page-shell.is-live-workout`):

```css
.m-page-shell.is-crm {
  max-width: 100%;
  padding: 0 0 calc(var(--m-safe-bottom) + 76px);
  background: hsl(0 0% 100%);
}
```

- [ ] **Step 5: Verify with typecheck, lint, and a manual check**

Run: `pnpm --filter web typecheck`
Expected: PASS. If it fails with "Cannot find module './routeTree.gen'",
regenerate it once: `cd apps/web && npx vite build && rm -rf dist` (a
pre-existing environment quirk — the generated route tree file is
gitignored and needs to exist locally for `tsc` to resolve route types).

Run: `pnpm --filter web lint`
Expected: PASS (0 errors; pre-existing `no-explicit-any` warnings in
`apps/web/src/lib/api.ts` are unrelated and fine).

Manual check: start `pnpm --filter api dev` and `pnpm --filter web dev`,
open a mobile-width viewport (browser devtools device emulation) at
`/m/crm`. Confirm: the page now renders with the dark `m-controller-page`
chassis (not the old white desktop layout), the stats row and thread list
load real data, the sync button spins and refetches, tapping a thread row
navigates to a URL like `/m/crm/<id>` (a 404/not-found page is expected
here until Task 3), and Compose opens the same dialog desktop uses. Also
confirm every *other* `/m/*` page (Today, Calendar, Habits, Workouts,
Reminders) still looks and behaves exactly as before — the `.is-crm`
removal must not affect them (they never referenced that class).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/m/crm.tsx apps/web/src/routes/m/crm/index.tsx apps/web/src/components/crm/mobile/mobile-crm-header.tsx apps/web/src/routes/m.tsx apps/web/src/styles/mobile.css
git commit -m "feat(web): rebuild /m/crm as a mobile-native layout + Inbox"
```

---

## Task 2: Inbox filters, select mode, and bulk actions

**Files:**
- Modify: `apps/web/src/routes/m/crm/index.tsx`
- Create: `apps/web/src/components/crm/mobile/mobile-filter-select.tsx`
  (shared `CATEGORIES`/`PRIORITIES`/`STATUSES` constants and a
  `MobileFilterSelect` component — Task 3 also imports this rather than
  redefining it, matching how desktop `crm.tsx` reuses one `FilterSelect`
  for both filtering and editing)

**Interfaces:**
- Consumes: `TogglePill` (`@/components/mobile/toggle-pill`), `notify`
  (`@/components/mobile/notification-banner`), and everything Task 1's
  `MobileCrmInbox` already has in scope.
- Produces: `CATEGORIES`, `PRIORITIES`, `STATUSES` (readonly string-tuple
  constants) and `MobileFilterSelect({ label, value, values, onChange })`
  from `@/components/crm/mobile/mobile-filter-select` — Task 3 imports all
  four.

No automated tests (see Global Constraints) — verify via
typecheck/lint/manual check.

- [ ] **Step 1: Add filter state and thread the filters into the query**

In `MobileCrmInbox`, add state and replace the `threadsQuery` block:

```tsx
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
```

(This replaces the no-filter version from Task 1 — same query shape
desktop's `threadsQuery` uses, just filters sourced from this route's own
state instead.)

Add near the other `useState` calls:

```tsx
  const activeFilterCount = [category, priority, status, sender.trim(), responseOnly ? "on" : ""].filter(Boolean).length;
```

- [ ] **Step 2: Add bulk mutations**

Add alongside the existing queries:

```tsx
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
```

Add `useMutation` to the existing `import { useQuery, useQueryClient } from "@tanstack/react-query";` line (making it `import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";`).

Import `notify` at the top: `import { notify } from "@/components/mobile/notification-banner";`

Replace the earlier placeholder `onNotice={(message) => void message}` on
`<ComposerDialog>` with `onNotice={(message) => notify({ title: message })}`.

- [ ] **Step 3: Add the Filter and Select buttons to the toolbar row**

Add `Filter` to the `lucide-react` import list at the top of the file
(making it `import { Filter, Mail, RefreshCw, SquarePen } from "lucide-react";`).

These go in the toolbar row Task 1 created (the `<div className="flex items-center gap-2">`
right after `<MobileCrmHeader>`, currently holding only the sync button) —
**not** the header itself, which stays limited to the title and Compose
(Task 4 adds a Settings icon there too, so the header's own budget is
already accounted for). Add a Filter button after the sync button, and a
Select toggle pushed to the right edge of the same row:

```tsx
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
```

(This replaces the toolbar row's current content, which was just the sync
button on its own.)

- [ ] **Step 4: Wire selection into thread rows**

Change `MobileThreadRow` to accept and show a selection checkbox in select
mode:

```tsx
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
```

(This replaces Task 1's simpler `MobileThreadRow` — same visual content,
plus the conditional checkbox and select-mode tap behavior.)

Update the call site in the thread list to pass the new props:

```tsx
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
```

- [ ] **Step 5: Add the selection action bar**

Right after the thread-list `<div className="m-card divide-y ...">` block,
add:

```tsx
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
```

- [ ] **Step 6: Add the "Reclassify all" standalone action and the filter sheet**

Add a "Reclassify all" text button to the toolbar row, between Filter and
the (right-aligned) Select button — standalone, since desktop's
equivalent reclassifies every cached thread regardless of selection, so it
does not belong in the selection bar added in Step 5:

```tsx
        <button
          type="button"
          onClick={() => bulkClassifyMutation.mutate()}
          disabled={bulkClassifyMutation.isPending}
          className="m-press flex h-11 items-center rounded-full border border-[var(--m-border)] px-2.5 text-[11px] font-semibold text-[var(--m-text-2)] disabled:opacity-40"
        >
          Reclassify
        </button>
```

(Insert this between the Filter button and the Select button from Step 3
— Select keeps its `ml-auto` so it still sits at the row's right edge with
Reclassify to its left. This repo's Tailwind config only customizes the
`2xl` breakpoint — there is no `xs:` variant, so don't reach for one here
or elsewhere in this route; every toolbar button stays always-visible
rather than conditionally hidden by viewport width.)

Add the filter bottom sheet, following the same `DialogPrimitive`-based
sheet pattern `MobileCreateExercise` in `m/workouts/index.tsx` already
uses (not the shadcn `Dialog` wrapper — that one is reserved for
`ComposerDialog`, which is shared with desktop). Add this import:

```tsx
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { TogglePill } from "@/components/mobile/toggle-pill";
```

Add the sheet markup right after the `<ComposerDialog>` block, at the end
of the component's returned JSX (still inside the outer
`<div className="m-controller-page ...">`):

```tsx
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
```

`MobileFilterSelect` and the category/priority/status option lists are
also needed by Task 3 (to edit an already-classified thread's
category/priority/status in Thread Detail) — rather than defining them
twice, create a shared module now. This mirrors desktop `crm.tsx`, which
already reuses one `FilterSelect` component for both its Inbox filters
(where the empty "All categories" option is a real, selectable state) and
its Thread Detail classification editing (where a real value is always
selected, so the browser simply never shows the empty option — the
`<select>` displays whichever `<option>` matches the current `value`).

Create `apps/web/src/components/crm/mobile/mobile-filter-select.tsx`:

```tsx
export const CATEGORIES = ["general", "urgent", "scheduling", "billing", "support", "newsletter"] as const;
export const PRIORITIES = ["critical", "high", "normal", "low"] as const;
export const STATUSES = ["unread", "read", "replied", "scheduled", "archived", "dismissed"] as const;

export function MobileFilterSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="m-field w-full appearance-none pr-9 capitalize"
        >
          <option value="">All {label.toLowerCase()}s</option>
          {values.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
```

Add this import to `apps/web/src/routes/m/crm/index.tsx` (in place of any
local `CATEGORIES`/`PRIORITIES`/`STATUSES`/`MobileFilterSelect` definition
— there should be none in this file, since this is the first task to need
them):

```tsx
import { CATEGORIES, MobileFilterSelect, PRIORITIES, STATUSES } from "@/components/crm/mobile/mobile-filter-select";
```

- [ ] **Step 7: Verify with typecheck, lint, and a manual check**

Run: `pnpm --filter web typecheck` — PASS.
Run: `pnpm --filter web lint` — PASS.

Manual check: open `/m/crm` at mobile width. Confirm: tapping Filter opens
the bottom sheet, changing a filter and tapping Apply filters the list
(and shows the count badge on the Filter icon), Clear all resets
everything, tapping Select toggles checkboxes on every row and shows the
selection bar, selecting threads and tapping Generate drafts / Archive
works (and disables when nothing's selected), Reclassify works regardless
of selection, and toasts (`notify()`) appear for each bulk action.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/routes/m/crm/index.tsx apps/web/src/components/crm/mobile/mobile-filter-select.tsx
git commit -m "feat(web): add filters, select mode, and bulk actions to mobile Inbox"
```

---

## Task 3: Mobile Thread Detail route

**Files:**
- Create: `apps/web/src/routes/m/crm/$threadId.tsx`

**Interfaces:**
- Consumes: `MobileCrmHeader` (Task 1), `ComposerDialog` mode="reply"
  (unchanged, already built), `ThreadDetailData`/`EmailThread`/
  `EmailCategory`/`EmailPriority`/`EmailStatus` types from `@/lib/crm`,
  and `CATEGORIES`/`PRIORITIES`/`STATUSES`/`MobileFilterSelect` from
  `@/components/crm/mobile/mobile-filter-select` (Task 2 — do not redefine
  these locally).
- Produces: nothing consumed by later tasks.

No automated tests — verify via typecheck/lint/manual check.

- [ ] **Step 1: Create the route**

Create `apps/web/src/routes/m/crm/$threadId.tsx`:

```tsx
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
  const threadShim: EmailThread = {
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
          if (message.toLowerCase().includes("sent")) void navigate({ to: "/m/crm" });
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
```

Notes on this step:
- `ComposerDialog`'s `mode: "reply"` requires a `thread: EmailThread` prop
  — the full record, not just the thread-detail response's slimmer
  `thread` shape. `GET /api/gmail/:threadId` doesn't return every
  `EmailThread` column (it returns `thread`/`classification` separately,
  not the cached DB row), so `threadShim` reconstructs an `EmailThread`
  from the fields the detail response *does* have, filling the handful of
  fields `ComposerDialog` never actually reads (`id`, `userId`,
  `createdAt`, `updatedAt`) with harmless placeholders. `ComposerDialog`
  only reads `fromEmail`, `subject`, `snippet`, `gmailThreadId`, and `id`
  (the last one only inside `bookingMutation`, for `sourceThreadId` — using
  `threadId` there is correct, since that field expects the Gmail thread
  id in this call path... **wait** — check this against the plan's
  Global Constraints and `composer-dialog.tsx`: `bookingMutation` sends
  `sourceThreadId: thread!.id`, and the backend's
  `createCalendarBooking` expects `sourceThreadId` to be the **cached
  `emailThreads.id`** (a DB row id), not the raw Gmail thread id — desktop
  `crm.tsx` passes the full cached `EmailThread` row (with its real `.id`)
  into `ComposerDialog`, which is why this works today. Since
  `threadShim.id` here is set to the Gmail thread id string instead of a
  real DB row id, booking-from-a-reply-here would send the wrong id and
  the backend would 400 with "source thread not found." **Do not leave
  this as-is** — see Step 2, which fixes it before this task is done.

- [ ] **Step 2: Fix `sourceThreadId` — fetch the real cached thread id**

The `GET /api/gmail/:threadId` response doesn't include the cached
`emailThreads.id` (only the Gmail thread id and the classification), so
`threadShim.id` from Step 1 is wrong for booking purposes. The cheapest
fix that doesn't require a backend change: the Inbox's own
`GET /api/gmail` response *does* return full `EmailThread` rows (including
`.id`) for every cached thread. Add a second, lightweight query in this
route that reads the matching row out of the already-cached `["crm",
"threads", ...]` query data instead of refetching:

Add near the top of `MobileCrmThreadDetail`, right after `detailQuery`:

```tsx
  const cachedThread = queryClient
    .getQueriesData<{ threads: EmailThread[] }>({ queryKey: ["crm", "threads"] })
    .flatMap(([, data]) => data?.threads ?? [])
    .find((item) => item.gmailThreadId === threadId);
```

Then replace `threadShim`'s definition to prefer the real cached row when
available, falling back to the detail-response reconstruction only if the
user deep-linked here without visiting the Inbox first in this session:

```tsx
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
```

This means booking a meeting from a reply works correctly whenever the
user navigated here from the Inbox (the common path, and the same session
that populated `["crm","threads",...]`); a cold deep-link straight to
`/m/crm/$threadId` without ever having loaded the Inbox in that session
falls back to the placeholder id, where booking would still 400 exactly as
described in Step 1 — note this as a known, narrow edge case in the
commit message rather than silently leaving it unmentioned. (Sending a
reply itself, and everything else `ComposerDialog` does in reply mode,
does not depend on `thread.id` being correct — only the "Create Calendar
event" booking path does — so this edge case is scoped narrowly to that
one action.)

- [ ] **Step 3: Verify with typecheck, lint, and a manual check**

Run: `pnpm --filter web typecheck` — PASS.
Run: `pnpm --filter web lint` — PASS.

Manual check: from the Inbox, tap a thread. Confirm: the detail screen
loads with header (back button working), classification editing works
(category/priority/status all `PATCH` correctly and reflect back in the
Inbox after navigating back), messages render, and tapping "Draft" opens
the same reply composer desktop uses, including its scheduling section. If
a thread has a proposed meeting time in its content, confirm booking a
calendar event from here succeeds (this exercises the Step 2 fix). Also
manually verify the narrow edge case doesn't crash anything: reload the
browser directly at a `/m/crm/<id>` URL (skipping the Inbox), open the
composer, and confirm the page doesn't error — only that a booking attempt
in that specific scenario would fail with a normal in-dialog error message
from the backend, not a crash.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/m/crm/\$threadId.tsx
git commit -m "feat(web): add mobile CRM thread detail route"
```

---

## Task 4: Mobile Settings route

**Files:**
- Create: `apps/web/src/routes/m/crm/settings.tsx`
- Modify: `apps/web/src/routes/m/crm/index.tsx` (add a way to reach
  Settings)

**Interfaces:**
- Consumes: `MobileCrmHeader` (Task 1), `SessionData`/`PrivacySummary`/
  `AuditLog` types from `@/lib/crm`, `TogglePill` (already imported by
  Task 2's Inbox — this task adds its own import in the new file).
- Produces: nothing consumed by later tasks — this is the last task.

No automated tests — verify via typecheck/lint/manual check.

- [ ] **Step 1: Create the route**

Create `apps/web/src/routes/m/crm/settings.tsx`:

```tsx
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Database, LogOut, ShieldCheck, Trash2, Unplug } from "lucide-react";
import { api } from "@/lib/api";
import { type AuditLog, type PrivacySummary } from "@/lib/crm";
import { notify } from "@/components/mobile/notification-banner";
import { MobileCrmHeader } from "@/components/crm/mobile/mobile-crm-header";

export const Route = createFileRoute("/m/crm/settings")({
  component: MobileCrmSettings,
});

const crmLayoutRoute = getRouteApi("/m/crm");

type AccountAction = "logout" | "disconnect" | "delete" | null;

function MobileCrmSettings() {
  const { session } = crmLayoutRoute.useRouteContext();
  const [timezone, setTimezone] = useState(session.user.timezone);
  const [workingHoursStart, setWorkingHoursStart] = useState(session.user.workingHoursStart);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(session.user.workingHoursEnd);
  const [accountAction, setAccountAction] = useState<AccountAction>(null);

  const privacyQuery = useQuery({
    queryKey: ["crm", "privacy-summary"],
    queryFn: () => api.get<PrivacySummary>("/api/privacy/data-access"),
  });
  const auditQuery = useQuery({
    queryKey: ["crm", "audit"],
    queryFn: () => api.get<{ logs: AuditLog[] }>("/api/privacy/audit-logs?limit=20"),
  });

  const profileMutation = useMutation({
    mutationFn: (profile: { timezone: string; workingHoursStart: string; workingHoursEnd: string }) =>
      api.patch("/api/auth/me", profile),
    onSuccess: () => {
      notify({ title: "Preferences saved" });
    },
  });
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

  return (
    <div className="m-controller-page flex flex-col gap-4">
      <MobileCrmHeader title="Settings" backTo="/m/crm" />

      <section className="m-card space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--m-text)]">
          <ShieldCheck width={15} height={15} /> Scheduling preferences
        </h2>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">IANA timezone</span>
          <input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Singapore" className="m-field w-full" />
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">Day starts</span>
            <input type="time" value={workingHoursStart} onChange={(event) => setWorkingHoursStart(event.target.value)} className="m-field w-full" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">Day ends</span>
            <input type="time" value={workingHoursEnd} onChange={(event) => setWorkingHoursEnd(event.target.value)} className="m-field w-full" />
          </label>
        </div>
        <button
          type="button"
          onClick={() => profileMutation.mutate({ timezone, workingHoursStart, workingHoursEnd })}
          disabled={profileMutation.isPending}
          className="m-primary-button m-press w-full"
        >
          {profileMutation.isPending ? "Saving…" : "Save preferences"}
        </button>
      </section>

      <section className="m-card space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--m-text)]">
          <Database width={15} height={15} /> Stored data
        </h2>
        {privacyQuery.data && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(privacyQuery.data.summary).map(([label, value]) => (
                <div key={label} className="m-inset p-2.5">
                  <p className="text-[16px] font-semibold text-[var(--m-text)]">{value}</p>
                  <p className="mt-0.5 text-[9px] text-[var(--m-text-3)]">{label}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-5 text-[var(--m-text-2)]">{privacyQuery.data.description}</p>
          </>
        )}
      </section>

      <section className="m-card space-y-2.5 p-4">
        <h2 className="text-[13px] font-semibold text-[var(--m-text)]">Recent audit activity</h2>
        {auditQuery.data?.logs.length ? (
          <div className="space-y-1.5">
            {auditQuery.data.logs.map((log) => (
              <div key={log.id} className="m-inset flex items-center justify-between gap-2 px-2.5 py-2 text-[11px]">
                <span className="text-[var(--m-text-2)]">{log.action}</span>
                <time className="shrink-0 text-[var(--m-text-3)]">{formatDate(log.createdAt)}</time>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-[var(--m-text-3)]">No audit activity yet.</p>
        )}
      </section>

      <section className="m-card space-y-2.5 p-4">
        <h2 className="text-[13px] font-semibold text-[var(--m-text)]">Account controls</h2>
        <div className="grid gap-2">
          <button type="button" onClick={() => setAccountAction("logout")} className="m-secondary-button m-press justify-start gap-2 px-3">
            <LogOut width={15} height={15} /> Log out
          </button>
          <button type="button" onClick={() => setAccountAction("disconnect")} className="m-secondary-button m-press justify-start gap-2 px-3">
            <Unplug width={15} height={15} /> Disconnect Google
          </button>
          <button
            type="button"
            onClick={() => setAccountAction("delete")}
            className="m-press flex min-h-[50px] items-center justify-start gap-2 rounded-[14px] border border-[#ff765f]/40 bg-[#ff765f]/10 px-3 text-[13px] font-medium text-[#ff9a78]"
          >
            <Trash2 width={15} height={15} /> Delete all data
          </button>
        </div>
      </section>

      {accountAction && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={() => setAccountAction(null)}>
          <div
            className="m-controller-surface w-full max-w-lg rounded-t-[26px] border border-b-0 border-[var(--m-border)] bg-[#20282d] p-5 pb-[max(20px,env(safe-area-inset-bottom))]"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-[18px] font-semibold text-[var(--m-text)]">
              {accountAction === "delete" ? "Delete all stored data?" : accountAction === "disconnect" ? "Disconnect Google?" : "Log out?"}
            </h3>
            <p className="mt-2 text-[12px] leading-5 text-[var(--m-text-2)]">
              {accountAction === "delete"
                ? "This revokes Google access and permanently deletes your profile, sessions, encrypted tokens, cached CRM records, bookings, and audit logs."
                : accountAction === "disconnect"
                  ? "Google access will be revoked, CRM cache cleared, and this session ended."
                  : "Your Google account stays connected; only this session ends."}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button type="button" onClick={() => setAccountAction(null)} className="m-secondary-button m-press">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => accountAction && accountMutation.mutate(accountAction)}
                disabled={accountMutation.isPending}
                className={
                  accountAction === "delete"
                    ? "m-press min-h-[50px] rounded-[14px] bg-[#ff765f] text-[13px] font-bold text-[#17110f] disabled:opacity-60"
                    : "m-primary-button m-press disabled:opacity-60"
                }
              >
                {accountMutation.isPending ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
}
```

- [ ] **Step 2: Add a way to reach Settings from the Inbox**

In `apps/web/src/routes/m/crm/index.tsx`, the header's `actionsRight`
currently holds only the Compose button (Filter/Sync/Select/Reclassify
all live in the separate toolbar row added in Tasks 1-2 — see the note in
Task 1 Step 3 about why they're kept out of the header). Add a `Settings`
icon button there too, before Compose, using
`navigate({ to: "/m/crm/settings" })` for consistency with the toolbar
row's buttons (no need for a second navigation primitive like `Link` in
this file):

```tsx
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
```

(This replaces `actionsRight`'s current single-button value with a
fragment containing both.)

Add `Settings` to the `lucide-react` import list at the top of
`index.tsx`.

- [ ] **Step 3: Verify with typecheck, lint, and a manual check**

Run: `pnpm --filter web typecheck` — PASS.
Run: `pnpm --filter web lint` — PASS.

Manual check: from the Inbox, tap the Settings icon. Confirm: the page
loads with back navigation working, saving scheduling preferences works
and shows a toast, stored-data summary and audit log render, and each
account-control confirmation sheet shows the correct copy and (for
logout/disconnect at least — delete is destructive, so only verify this
one non-destructively) redirects to `/login` on confirm.

- [ ] **Step 4: Full end-to-end walkthrough**

With all four tasks landed, do one final pass covering everything in the
design spec's Testing section: Inbox load/filter/select/bulk-actions/sync,
navigate into and back out of Thread Detail, compose a reply from Thread
Detail, open Settings and save a preference, and the account-action
confirmations. Also spot-check that desktop `/crm` is completely unchanged
(open it in a normal-width browser window) and that every other `/m/*`
page still renders correctly (the `.is-crm` removal from Task 1 must not
have affected them).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/m/crm/settings.tsx apps/web/src/routes/m/crm/index.tsx
git commit -m "feat(web): add mobile CRM settings route"
```
