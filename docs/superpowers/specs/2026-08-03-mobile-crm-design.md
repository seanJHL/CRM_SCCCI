# Mobile-native `/m/crm` — Design

Date: 2026-08-03

## Problem

`/m/crm` currently renders the exact same desktop `CrmDashboard` component as
`/crm`. It doesn't use any of the mobile design system the rest of the app's
mobile pages rely on (`.m-controller-page` chassis, `m-field`/
`m-primary-button` touch-sized controls, `MobileErrorState`, `m-skeleton`
loaders, `notify()` toasts, safe-area handling) — it's desktop `<select>`
filters, small icon buttons, and a desktop toolbar header dropped into the
mobile shell, opting out of the shell's default styling via a one-off
`.is-crm` CSS escape hatch.

PWA plumbing itself (manifest, service worker, the viewport auto-redirect
table, the bottom-nav tab) already correctly includes and routes to CRM —
there is no infrastructure gap there, and this design doesn't touch any of
it. The work is entirely: build a real mobile-native CRM page.

## Existing conventions this design follows

Confirmed by reading `m/workouts/index.tsx`, `m/habits.tsx`, `m/calendar.tsx`,
and the `m.tsx` + `m/*` route relationship:

- **Mobile routes are self-contained.** They call the same backend endpoints
  as their desktop counterparts but own their own queries/mutations and JSX
  — no shared page-level hook. This design keeps the backend untouched and
  builds new mobile-native frontend routes that call the same existing
  endpoints desktop `crm.tsx` already uses.
- **List → detail navigation is a real nested route**, not in-component view
  state (e.g. `workouts/index.tsx` + `workouts/$sessionId.tsx`). This design
  gives Thread Detail and Settings their own routes rather than toggling
  state inside one big component.
- **Parent-layout-plus-children is already the pattern one level up**:
  `m.tsx` is a layout route (auth-independent shell, `<Outlet/>`) with
  `m/index.tsx`, `m/crm.tsx`, `m/calendar.tsx`, etc. as its children. This
  design replicates that same relationship one level deeper: `m/crm.tsx`
  becomes a thin layout (session/auth guard, `<Outlet/>`) with
  `m/crm/index.tsx`, `m/crm/$threadId.tsx`, `m/crm/settings.tsx` as its
  children — each inheriting the session via route context exactly like
  `m/crm.tsx`'s current `beforeLoad` already does for the single page today.
- **Shared, reusable pieces are small presentational components**, not whole
  pages (e.g. `ExerciseImage` reused by both desktop and mobile workouts).
  `<ComposerDialog>` (from the prior Compose-button work) is exactly this
  kind of piece — prop-driven, mode-aware, already has responsive bottom-sheet
  behavior — so it's reused as-is for both reply and new-compose. Its
  internals are not touched by this design.

## Route structure

- `apps/web/src/routes/m/crm.tsx` — becomes a thin layout: keeps the
  existing `beforeLoad` (session load + Google-connected guard + redirect to
  `/login`), renders `<Outlet/>`. No CRM UI lives here anymore.
- `apps/web/src/routes/m/crm/index.tsx` (new) — Inbox list + filters + bulk
  actions. This is what `/m/crm` now resolves to.
- `apps/web/src/routes/m/crm/$threadId.tsx` (new) — Thread detail, full
  screen (mobile has no room for desktop's side-by-side split).
- `apps/web/src/routes/m/crm/settings.tsx` (new) — Settings/Privacy, reached
  via a header icon on the Inbox (mobile's bottom nav has no room for a
  CRM-internal sub-tab).

The bottom-nav's existing match rule (`p.startsWith("/m/crm")`) already
covers all three new routes correctly — no change needed there.

### Cleanup: retiring the `.is-crm` shell escape hatch

`m.tsx`'s `isCrm = pathname === "/m/crm"` flag and `mobile.css`'s
`.m-page-shell.is-crm` rule exist solely to strip the shell's default
padding/max-width/dark-background so the old desktop-shaped `CrmDashboard`
pass-through could render full-bleed white instead of boxed inside the
standard dark shell. The new mobile-native CRM page follows the same shell
conventions as every other mobile route (dark background, safe-area
padding), so this escape hatch becomes dead code. Both the `isCrm` flag in
`m.tsx` and the `.is-crm` rule in `mobile.css` are removed as part of this
work — this is a small, directly-in-the-way cleanup, not an unrelated
refactor.

## Views

### Inbox (`m/crm/index.tsx`)

- **Header**: "CRM" title, unread-count badge, and action icons — Sync
  (tap-to-refresh; **no pull-to-refresh** — that's a new gesture-handling
  surface this app doesn't use anywhere else and risks conflicting with the
  browser's native pull-to-reload, so it's out of scope here), Filter
  (badge showing active filter count when >0), Select (toggles selection
  mode), and a prominent Compose button.
- **Stats strip**: total / unread / urgent / needs-reply counts, condensed
  into a 2×2 or horizontally-scrolling chip row (compared to desktop's
  4-across row, which doesn't fit this width) — plus a standalone
  "Reclassify all" action near the sync button. (Desktop's "Reclassify all"
  isn't actually selection-dependent — it always reclassifies every cached
  thread regardless of what's selected — so it doesn't belong in the
  selection-dependent bulk-action bar below; it stays a standalone action.)
- **Filter sheet**: a bottom sheet (reusing the existing `Dialog` component
  styled the same bottom-sheet way `ComposerDialog` already is — no new
  sheet/drawer primitive needed) containing category/priority/status as
  single-select chip rows, a sender text field, and a "Needs response"
  toggle, with Apply/Clear actions. Same filter semantics as desktop's four
  `<select>`s plus sender search plus checkbox — just touch-appropriate
  presentation.
- **Thread rows**: redesigned as touch-friendly cards — 44px+ tap target,
  unread dot, sender (bold if unread), subject, truncated snippet, relative
  timestamp, category/priority chips, "Reply needed" chip. Tapping navigates
  to `/m/crm/$threadId`. A selection checkbox appears only in select mode
  (an explicit toggle, not always-on tiny checkboxes cluttering every row).
- **Selection bar**: when select mode is active, a bottom action bar (above
  the safe area / bottom nav) shows "N selected", **Generate drafts** and
  **Archive** (both disabled until ≥1 selected, matching desktop), and
  Cancel.
- **Loading/error/empty states**: `m-skeleton` shimmer rows while loading,
  `MobileErrorState` (with retry wired to refetch) on failure, empty-state
  copy matching desktop's intent.
- Rows themselves are read-only (matching desktop's `ThreadRow`, which has
  no inline editing) — category/priority/status editing only happens in
  Thread Detail, same division of responsibility as desktop.
- **Data**: `threadsQuery` (`GET /api/gmail`, filtered), `statsQuery`
  (`GET /api/gmail/stats`), `gmailSyncQuery` (`GET /api/gmail?refresh=true`,
  background), `bulkClassifyMutation`
  (`POST /api/gmail/bulk/update`), `bulkDraftMutation`
  (`POST /api/gmail/bulk/replies`) — all identical endpoints/contracts to
  desktop, just re-implemented as this route's own queries per the
  established mobile-route convention.

### Thread Detail (`m/crm/$threadId.tsx`)

- Header: back button (navigates to `/m/crm`), subject as title.
- Sender, classification (category/priority, editable), "why it matters"
  reasons, full message thread, status control, and a "Create Draft" button
  that opens `<ComposerDialog mode="reply" .../>` — identical props/behavior
  to how desktop opens it today.
- **Data**: `threadDetailQuery` (`GET /api/gmail/:id`),
  `updateThreadMutation` (same endpoint as Inbox's inline edits).
- Loading/error states: `m-skeleton`/`MobileErrorState`, same as Inbox.

### Settings (`m/crm/settings.tsx`)

- Header: back button (navigates to `/m/crm`), "Settings" title.
- Scheduling preferences (timezone, working hours) form using
  `m-field`/`m-primary-button`, stored-data summary, data-handling
  explanation list, recent audit activity, and account controls
  (logout/disconnect/delete) — same content and confirmation-before-action
  behavior as desktop's `PrivacyView`, touch-sized controls.
- **Data**: `profileMutation` (`PATCH /api/auth/me`), `privacyQuery`
  (`GET /api/privacy/data-access`), `auditQuery`
  (`GET /api/privacy/audit-logs?limit=20`), `accountMutation`
  (logout/disconnect/delete-data endpoints) — identical contracts to
  desktop.

## Shared mobile-CRM pieces

To avoid duplicating chrome across the three route files:

- `apps/web/src/components/crm/mobile/mobile-crm-header.tsx` — a small
  presentational header component (title, optional back button, optional
  right-side action icons slot) used by all three routes for visual
  consistency, without forcing identical structure.
- The filter bottom sheet and thread-row card can stay inline within
  `m/crm/index.tsx` (matching how desktop `crm.tsx` keeps `ThreadRow`
  inline rather than in a separate file) unless implementation finds the
  file growing unwieldy, in which case extracting a
  `mobile-filter-sheet.tsx` is a reasonable follow-up — not mandated here.

## Error handling

- Inline desktop-style error/notice banners are replaced by
  `MobileErrorState` (errors, with retry) and `notify()` toasts (success
  messages) — `notify()` requires no extra wiring since `NotificationBanner`
  is already mounted globally in `m.tsx`.
- Reauth/session-expired states (`GOOGLE_REAUTH_REQUIRED`,
  `GOOGLE_PERMISSION_REQUIRED`, `UNAUTHORIZED`) use the same error codes
  desktop already reacts to; the mobile presentation surfaces the
  reconnect/sign-in action through `MobileErrorState`'s retry affordance or
  a toast action, rather than the desktop banner's inline link.

## Explicitly out of scope

- No backend/API changes — every endpoint used here already exists and is
  already used by desktop `crm.tsx`.
- No changes to `ComposerDialog`'s internals — reused exactly as built.
- No changes to desktop `crm.tsx`.
- No new touch gestures (no swipe-to-archive, no pull-to-refresh) — taps and
  an explicit select-mode toggle instead, matching the "adapt the design
  system to this content, don't force-match Habits' gesture set" direction.
- No changes to the manifest, service worker, or viewport-redirect table —
  already correctly wired to CRM.

## Testing

This repo has no frontend test runner (`apps/web`'s `test` script is a
no-op) — consistent with how the prior Compose-button work was verified,
this is checked via `pnpm --filter web typecheck`, `pnpm --filter web lint`,
and a manual walkthrough in a mobile-width browser viewport (devtools
device emulation) covering: Inbox load/filter/select/bulk-actions/sync,
navigating into and back out of Thread Detail, composing a reply from
Thread Detail, opening Settings and saving a preference, and the
account-action confirmations (logout/disconnect/delete).
