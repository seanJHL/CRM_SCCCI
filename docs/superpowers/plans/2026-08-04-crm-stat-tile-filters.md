# Clickable CRM Stat-Tile Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile CRM inbox's Total/Unread/Urgent/Reply stat tiles tappable, so tapping one filters the thread list to exactly what that tile counts, with only one tile active at a time.

**Architecture:** Two new boolean query params (`unreadOnly`, `urgentOnly`) are added to the existing `GET /api/gmail` endpoint, mirroring the existing `requiresResponse` param exactly. On the frontend, two new `useState` booleans (`unreadOnly`, `urgentOnly`) drive those params and the tile highlight state; the existing `responseOnly` state is reused as-is for the Reply tile. Tapping a tile clears the other manual/quick filters before activating its own; any manual edit in the existing filter sheet clears `unreadOnly`/`urgentOnly` (but leaves `responseOnly` free to combine with category/priority/status/sender exactly as it does today).

**Tech Stack:** Hono + Drizzle ORM (Cloudflare Workers) for the API; React + TanStack Query + Tailwind for the mobile web route.

## Global Constraints

- Mobile CRM inbox only (`apps/web/src/routes/m/crm/index.tsx` and `apps/api/src/routes/gmail.ts`) — do not touch desktop `apps/web/src/routes/crm.tsx`.
- Do not modify `GET /api/gmail/stats` — its counts already match what the new filters need to select.
- No new sheet UI controls for Unread/Urgent — those two are reachable only via tapping their stat tile.
- This repo has no frontend test runner (`apps/web`'s `test` script is a no-op); the API has `vitest` but no existing precedent for testing Hono route handlers (all current API tests are pure-function/library tests — see `apps/api/test/crm.test.ts`). The sibling filters this change parallels (`category`, `priority`, `status`, `requiresResponse` in the same route) are also untested at the route level, so this plan follows that established pattern: verify via `typecheck`/`lint` plus a manual walkthrough, not new route-level test infrastructure.

---

### Task 1: Backend — add `unreadOnly` and `urgentOnly` filters to `GET /api/gmail`

**Files:**
- Modify: `apps/api/src/routes/gmail.ts:107-176`

**Interfaces:**
- Consumes: nothing new — `emailThreads.hasUnread` (boolean column) and `emailThreads.priority` (plain `text` column, values include `"critical"`/`"high"`), already used elsewhere in this file. `inArray` is already imported from `drizzle-orm` at the top of the file (line 8) — no import changes needed.
- Produces: `GET /api/gmail?unreadOnly=true` returns only threads where `hasUnread === true`. `GET /api/gmail?urgentOnly=true` returns only threads where `priority` is `"critical"` or `"high"`. Both params are read the same way as the existing `requiresResponse` param — Task 2 depends on these exact param names.

- [ ] **Step 1: Add query param parsing**

In `apps/api/src/routes/gmail.ts`, in the `gmailRoute.get("/", ...)` handler, find:

```ts
  const requiresResponse = c.req.query("requiresResponse");
  const sender = c.req.query("sender");
  const refresh = c.req.query("refresh") === "true";
```

Replace with:

```ts
  const requiresResponse = c.req.query("requiresResponse");
  const sender = c.req.query("sender");
  const unreadOnly = c.req.query("unreadOnly") === "true";
  const urgentOnly = c.req.query("urgentOnly") === "true";
  const refresh = c.req.query("refresh") === "true";
```

- [ ] **Step 2: Add the two conditions to the cached/DB query path**

Find:

```ts
    if (requiresResponse === "true") conditions.push(eq(emailThreads.requiresResponse, true));
    if (sender) conditions.push(sql`${emailThreads.fromEmail} ILIKE ${`%${sender}%`}`);
```

Replace with:

```ts
    if (requiresResponse === "true") conditions.push(eq(emailThreads.requiresResponse, true));
    if (sender) conditions.push(sql`${emailThreads.fromEmail} ILIKE ${`%${sender}%`}`);
    if (unreadOnly) conditions.push(eq(emailThreads.hasUnread, true));
    if (urgentOnly) conditions.push(inArray(emailThreads.priority, ["critical", "high"]));
```

- [ ] **Step 3: Add the two conditions to the live in-memory filter path**

Find:

```ts
  if (requiresResponse === "true") filtered = filtered.filter((t) => t.requiresResponse);
  if (sender) filtered = filtered.filter((t) => t.fromEmail?.includes(sender));
```

Replace with:

```ts
  if (requiresResponse === "true") filtered = filtered.filter((t) => t.requiresResponse);
  if (sender) filtered = filtered.filter((t) => t.fromEmail?.includes(sender));
  if (unreadOnly) filtered = filtered.filter((t) => t.hasUnread);
  if (urgentOnly) filtered = filtered.filter((t) => t.priority === "critical" || t.priority === "high");
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: no errors.

- [ ] **Step 5: Lint**

Run: `pnpm --filter api lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/gmail.ts
git commit -m "$(cat <<'EOF'
feat(api): add unreadOnly/urgentOnly filters to GET /api/gmail

Mirrors the existing requiresResponse param so the mobile CRM stat
tiles can filter to exactly what they count.
EOF
)"
```

(No route-level test added — see Global Constraints. This endpoint isn't called with the new params by anything yet; Task 2's manual walkthrough exercises it end-to-end.)

---

### Task 2: Frontend — clickable stat tiles wired to the new filters

**Files:**
- Modify: `apps/web/src/routes/m/crm/index.tsx`

**Interfaces:**
- Consumes: `GET /api/gmail?unreadOnly=true` and `GET /api/gmail?urgentOnly=true` from Task 1.
- Produces: n/a (leaf UI change).

- [ ] **Step 1: Add the two new state variables**

Find (line 37):

```tsx
  const [responseOnly, setResponseOnly] = useState(false);
```

Replace with:

```tsx
  const [responseOnly, setResponseOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
```

- [ ] **Step 2: Wire the new state into the query params, query key, and filter count**

Find (lines 42-57):

```tsx
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
```

Replace with:

```tsx
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
```

- [ ] **Step 3: Add the four tap handlers**

Add this right after the `activeFilterCount` block from Step 2 (still before `const statsQuery = ...`):

```tsx
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
```

- [ ] **Step 4: Make the stat tiles clickable**

Find (lines 221-226):

```tsx
      <div className="m-card grid grid-cols-4 divide-x divide-[var(--m-border)] overflow-hidden">
        <Stat label="Total" value={statsQuery.data?.stats.total} />
        <Stat label="Unread" value={statsQuery.data?.stats.unread} color="var(--m-primary)" />
        <Stat label="Urgent" value={statsQuery.data?.stats.urgent} color="#e0524a" />
        <Stat label="Reply" value={statsQuery.data?.stats.requiresResponse} color="#4472ca" />
      </div>
```

Replace with:

```tsx
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
```

- [ ] **Step 5: Turn `Stat` into a clickable button with an active state**

Find (lines 379-391):

```tsx
function Stat({ label, value, color }: { label: string; value?: number; color?: string }) {
  return (
    <div className="min-w-0 px-2 py-3 text-center">
      <p
        className="font-mono text-[18px] font-black tabular-nums"
        style={{ color: value ? (color ?? "var(--m-text)") : "var(--m-text-3)" }}
      >
        {value ?? "—"}
      </p>
      <p className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--m-text-3)]">{label}</p>
    </div>
  );
}
```

Replace with:

```tsx
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
```

- [ ] **Step 6: Clear `unreadOnly`/`urgentOnly` when the user edits any manual sheet filter**

Find (lines 347-349):

```tsx
              <MobileFilterSelect label="Category" value={category} values={CATEGORIES} onChange={setCategory} asPanel />
              <MobileFilterSelect label="Priority" value={priority} values={PRIORITIES} onChange={setPriority} asPanel />
              <MobileFilterSelect label="Status" value={status} values={STATUSES} onChange={setStatus} asPanel />
```

Replace with:

```tsx
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
```

Find (lines 350-358):

```tsx
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">Sender</span>
                <input
                  value={sender}
                  onChange={(event) => setSender(event.target.value)}
                  placeholder="Filter by sender"
                  className="m-field w-full"
                />
              </label>
```

Replace with:

```tsx
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
```

Find (lines 359-362):

```tsx
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="text-[13px] font-medium text-[var(--m-text)]">Needs response only</span>
                <TogglePill checked={responseOnly} onChange={setResponseOnly} label="Needs response only" />
              </div>
```

Replace with:

```tsx
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
```

- [ ] **Step 7: Clear the new state from "Clear all" too**

Find (lines 332-338):

```tsx
                  onClick={() => {
                    setCategory("");
                    setPriority("");
                    setStatus("");
                    setSender("");
                    setResponseOnly(false);
                  }}
```

Replace with:

```tsx
                  onClick={() => {
                    setCategory("");
                    setPriority("");
                    setStatus("");
                    setSender("");
                    setResponseOnly(false);
                    setUnreadOnly(false);
                    setUrgentOnly(false);
                  }}
```

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: no errors.

- [ ] **Step 9: Lint**

Run: `pnpm --filter web lint`
Expected: no errors.

- [ ] **Step 10: Manual walkthrough**

Start both dev servers (`pnpm --filter api dev` and `pnpm --filter web dev`), open `/m/crm` in a mobile-width browser viewport (devtools device emulation), signed in with a Google-connected account that has some unread, urgent, and reply-needed threads. Confirm:
- Tapping **Unread** highlights that tile, the thread list narrows to only unread threads, and the Filter icon's badge count increases by 1.
- Tapping **Unread** again un-highlights it and the list returns to unfiltered.
- Tapping **Urgent** highlights it, narrows the list to critical/high-priority threads, and un-highlights Unread if it was active.
- Tapping **Reply** highlights it and narrows to threads needing a response.
- Tapping **Total** clears whichever tile was active and shows every thread, with **Total** now shown highlighted.
- With a tile active, opening the Filter sheet and picking a Category clears that tile's highlight (confirm by closing the sheet and looking at the stat row) while still applying the category filter.
- With a tile active, opening the Filter sheet and tapping "Clear all" clears both the sheet's fields and the active tile.
- Manually toggling "Needs response only" in the sheet also highlights the Reply tile (since they share the same underlying filter), and can still be combined with a Category selection at the same time.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/routes/m/crm/index.tsx
git commit -m "$(cat <<'EOF'
feat(web): make mobile CRM stat tiles clickable quick filters

Tapping Total/Unread/Urgent/Reply filters the inbox to exactly what
that tile counts, with only one tile active at a time. Manually
editing the filter sheet clears the active tile; the sheet's existing
"Needs response only" toggle stays wired to the same state the Reply
tile uses, so the two stay in sync.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Interaction model → Task 2 Steps 3-4. New backend params → Task 1. Visual active state → Task 2 Step 5. Sheet/tile mutual exclusivity → Task 2 Steps 6-7. Fixed tile totals (no change to `statsQuery`) → untouched by design, confirmed no task modifies `GET /api/gmail/stats`. Desktop out of scope → no desktop files appear in either task.
- **Type consistency:** `Stat`'s new `active`/`onClick` props are required (not optional) and every one of the 4 call sites in Step 4 supplies both — checked. `unreadOnly`/`urgentOnly` names match exactly between Task 1's API param names and Task 2's `URLSearchParams.set` calls.
- **No placeholders:** every step above contains literal find/replace code, no "similar to" references.
