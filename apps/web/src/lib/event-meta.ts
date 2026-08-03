import type { Event } from "@/lib/query-keys";

/**
 * Event categorisation & colour metadata.
 *
 * Categories behave like Google Calendar's event types (one per event),
 * while the palette offers Google-style colour overrides and tags offer
 * Notion-style free-form multi-select labelling.
 */

export type EventCategory = "meeting" | "shift" | "personal" | "deadline";
export type ScheduleItemKind = "activity" | "task" | "event";

export const SCHEDULE_ITEM_META: Record<
  ScheduleItemKind,
  { label: string; shortLabel: string }
> = {
  activity: { label: "Activity", shortLabel: "ACT" },
  task: { label: "Task", shortLabel: "TSK" },
  event: { label: "Event", shortLabel: "EVT" },
};

export interface PaletteColor {
  id: string;
  label: string;
  /** Solid hex value, used for dots and inline accents. */
  hex: string;
  /** Small solid dot. */
  dot: string;
  /** Tinted calendar chip (background + text). */
  chip: string;
  /** Solid picker swatch. */
  swatch: string;
}

export const EVENT_PALETTE: PaletteColor[] = [
  {
    id: "graphite",
    label: "Graphite",
    hex: "#8b919a",
    dot: "bg-[#8b919a]",
    chip: "bg-[#f1f2f4] text-[#5c636e]",
    swatch: "bg-[#8b919a]",
  },
  {
    id: "blue",
    label: "Blue",
    hex: "#4472ca",
    dot: "bg-[#4472ca]",
    chip: "bg-[#edf2fa] text-[#38609f]",
    swatch: "bg-[#4472ca]",
  },
  {
    id: "teal",
    label: "Teal",
    hex: "#4d9da8",
    dot: "bg-[#4d9da8]",
    chip: "bg-[#ebf5f6] text-[#3d7f89]",
    swatch: "bg-[#4d9da8]",
  },
  {
    id: "green",
    label: "Green",
    hex: "#6ba35e",
    dot: "bg-[#6ba35e]",
    chip: "bg-[#eff5ec] text-[#55854a]",
    swatch: "bg-[#6ba35e]",
  },
  {
    id: "amber",
    label: "Amber",
    hex: "#d9933c",
    dot: "bg-[#d9933c]",
    chip: "bg-[#fbf3e8] text-[#a06b26]",
    swatch: "bg-[#d9933c]",
  },
  {
    id: "orange",
    label: "Orange",
    hex: "#d9730d",
    dot: "bg-[#d9730d]",
    chip: "bg-[#faeee0] text-[#a35807]",
    swatch: "bg-[#d9730d]",
  },
  {
    id: "red",
    label: "Red",
    hex: "#e03e3e",
    dot: "bg-[#e03e3e]",
    chip: "bg-[#fdeeee] text-[#b33232]",
    swatch: "bg-[#e03e3e]",
  },
  {
    id: "pink",
    label: "Pink",
    hex: "#d15796",
    dot: "bg-[#d15796]",
    chip: "bg-[#faedf4] text-[#a44576]",
    swatch: "bg-[#d15796]",
  },
  {
    id: "purple",
    label: "Purple",
    hex: "#9065b0",
    dot: "bg-[#9065b0]",
    chip: "bg-[#f3eef8] text-[#71508c]",
    swatch: "bg-[#9065b0]",
  },
];

export const CATEGORY_META: Record<
  EventCategory,
  { label: string; colorId: string }
> = {
  meeting: { label: "Meeting", colorId: "blue" },
  shift: { label: "Shift", colorId: "purple" },
  personal: { label: "Personal", colorId: "green" },
  deadline: { label: "Deadline", colorId: "red" },
};

export const EVENT_CATEGORIES = Object.entries(CATEGORY_META).map(
  ([id, meta]) => ({ id: id as EventCategory, ...meta }),
);

const FALLBACK_COLOR = EVENT_PALETTE[0];

export function paletteById(id: string | null | undefined): PaletteColor {
  return EVENT_PALETTE.find((color) => color.id === id) ?? FALLBACK_COLOR;
}

/**
 * Resolve the palette color for an event: an explicit `color` override wins,
 * otherwise the category's default color is used.
 */
export function eventPalette(event: Pick<Event, "color" | "category">) {
  if (event.color) return paletteById(event.color);
  return paletteById(CATEGORY_META[event.category]?.colorId);
}

// ---------------------------------------------------------------------------
// Tag helpers — tags are stored as a comma-separated string on the API.
// ---------------------------------------------------------------------------

export const MAX_TAGS = 6;
export const MAX_TAG_LENGTH = 24;

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Quick capture stores the item's type as a tag so activities, tasks, and
 * events can share the calendar model while retaining their identity.
 * Older and desktop-created entries safely fall back to a regular event.
 */
export function scheduleItemKind(
  event: Pick<Event, "tags">,
): ScheduleItemKind {
  const tags = new Set(parseTags(event.tags).map((tag) => tag.toLowerCase()));
  if (tags.has("activity")) return "activity";
  if (tags.has("task")) return "task";
  return "event";
}

export function serializeTags(tags: string[]): string {
  return tags.join(",");
}

/** Normalise a raw tag input: trim, collapse whitespace to dashes, lowercase. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, "-").toLowerCase().slice(0, MAX_TAG_LENGTH);
}

/** Collect unique tags across a set of events, most frequent first. */
export function collectTags(events: Event[] | undefined): string[] {
  const counts = new Map<string, number>();
  for (const event of events ?? []) {
    for (const tag of parseTags(event.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}
