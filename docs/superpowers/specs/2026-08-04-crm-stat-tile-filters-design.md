# Clickable stat-tile quick filters (mobile CRM) — Design

Date: 2026-08-04

## Problem

The mobile CRM inbox (`/m/crm`) shows a 4-tile stat strip (Total / Unread /
Urgent / Reply) at `apps/web/src/routes/m/crm/index.tsx:221-226`. The tiles
are plain, non-interactive `<div>`s (`Stat` component, lines 379-391) — they
only display counts from an independent `GET /api/gmail/stats` query. There
is no way to tap a tile to see just those threads; the user must instead
open the separate Filter bottom sheet and reconstruct the equivalent filter
manually (and for Urgent, there currently is no equivalent — see below).

## Interaction model

`Stat` becomes a `<button type="button" aria-pressed={active}>`. A new piece
of state, `quickFilter: "unread" | "urgent" | "reply" | null`, tracks which
tile (if any) is active:

- Tapping **Unread**, **Urgent**, or **Reply** sets `quickFilter` to that
  value, unless it's already active, in which case tapping again clears it
  (`null`).
- Tapping **Total** always clears `quickFilter` to `null` (an explicit "show
  everything" action, not a toggle).
- Activating a quick filter resets the advanced filter sheet's manual state
  (`category`, `priority`, `status`, `sender`, `responseOnly`) to blank.
  Conversely, changing any value in the filter sheet (or opening it and
  applying) clears `quickFilter`. Quick filters (tiles) and the advanced
  sheet are two mutually exclusive modes — never combined — so the user
  never has to reason about what "Urgent tile + Category=billing" means
  together.

This satisfies "single active tile" from the approved design: only one tile
is ever highlighted, and it behaves like a segmented control layered on top
of (but exclusive with) the existing filter sheet.

## Why new backend params, not reusing existing filter values

Reply maps exactly to the existing `responseOnly` boolean / `requiresResponse`
param — reused as-is, no backend change needed.

Unread and Urgent do not have an exact existing match:

- The **Unread** tile's count is computed server-side from the `hasUnread`
  boolean column (`apps/api/src/routes/gmail.ts` stats handler), which is a
  distinct field from the `status` enum's `"unread"` value. Reusing
  `status=unread` would risk showing a different set of threads than the
  number on the tile promised.
- The **Urgent** tile's count is `priority IN (critical, high)` — an OR the
  current single-value `priority` query param can't express.

So two new boolean query params are added to `GET /api/gmail`
(`apps/api/src/routes/gmail.ts:107-176`), mirroring the existing
`requiresResponse` pattern exactly:

- `unreadOnly=true` → filters on `hasUnread = true`
- `urgentOnly=true` → filters on `priority IN ('critical', 'high')`

Both the cached/DB-query path (lines 122-127) and the live in-memory filter
path (lines 168-173) get the same two conditions added, exactly like
`requiresResponse` already appears in both places today.

## Frontend wiring

In `apps/web/src/routes/m/crm/index.tsx`:

- Add `const [quickFilter, setQuickFilter] = useState<"unread" | "urgent" | "reply" | null>(null)`.
- `filters` (line 42) and the `threadsQuery` query key/params (lines 43-56)
  include `quickFilter`, adding `unreadOnly=true` / `urgentOnly=true` /
  `requiresResponse=true` to the request depending on its value.
- `activeFilterCount` (line 57) adds `quickFilter ? 1 : 0` so the Filter
  icon's badge reflects it too.
- The filter sheet's "Clear all" handler (lines 332-338) and its Apply flow
  also clear `quickFilter` — consistent with the mutual-exclusivity rule
  above.
- Tile click handlers implement the toggle/reset rules described above.

## Visual state

The active tile gets a tinted background/border using its existing per-tile
`color` prop (already the green/red/blue used for the value text today) plus
the `m-press` tap-feedback class, consistent with the `aria-pressed` +
`is-selected`-style pattern used in `m/calendar.tsx` and
`m/workouts/index.tsx`.

## Tile counts stay fixed totals

Tapping a tile does not change the numbers shown on the stat strip — they
stay grand totals from the independent `statsQuery`, not recalculated to the
filtered result count. This matches the current architecture (stats query
has no dependency on `filters`) and common tab-badge convention (e.g.
Gmail's own unread count doesn't shrink while viewing the Unread tab).

## Explicitly out of scope

- Desktop `apps/web/src/routes/crm.tsx` — its summary numbers are plain text
  in a different layout, not a tile grid; not touched by this design.
- No changes to `GET /api/gmail/stats` — its counts are already computed the
  way the new filters need to match.
- No multi-select / combinable tiles — single active tile only, per the
  approved design.

## Testing

No frontend test runner in this repo (consistent with prior mobile-CRM
work) — verified via `pnpm --filter web typecheck`, `pnpm --filter api
typecheck`, `pnpm --filter web lint`, and a manual walkthrough in a
mobile-width browser viewport: tap each tile and confirm the list narrows to
the expected threads and the tile highlights; tap it again (and tap Total)
to confirm it clears; open the filter sheet, set a manual filter, and
confirm the active tile clears; select a tile, then confirm the filter
sheet shows no manual selection.
