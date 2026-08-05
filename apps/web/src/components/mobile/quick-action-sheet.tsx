import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import {
  Activity,
  CalendarDays,
  Check,
  CheckSquare2,
  ChevronDown,
  Clock3,
  Plus,
  Repeat,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  queryKeys,
  type Event,
  type GroupExercise,
  type Task,
  type WorkoutGroup,
} from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { notify } from "@/components/mobile/notification-banner";

export type CaptureKind = "activity" | "task" | "event";

export interface QuickCaptureRequest {
  kind?: CaptureKind;
  date?: string;
  title?: string;
}

export function openQuickCapture(request: QuickCaptureRequest = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<QuickCaptureRequest>("ember:quick-capture", {
      detail: request,
    }),
  );
}

interface QuickActionSheetProps {
  open: boolean;
  onClose: () => void;
  request?: QuickCaptureRequest;
}

const CAPTURE_TYPES = [
  {
    id: "activity",
    label: "Activity",
    description: "Schedule one",
    icon: Activity,
    placeholder: "e.g. Bench Press",
  },
  {
    id: "task",
    label: "Task",
    description: "Make a checklist",
    icon: CheckSquare2,
    placeholder: "e.g. Trip packing list",
  },
  {
    id: "event",
    label: "Event",
    description: "Schedule it",
    icon: CalendarDays,
    placeholder: "e.g. Project catch-up",
  },
] as const;

const DURATIONS = [15, 30, 45, 60, 90, 120] as const;
const RECURRENCE_PRESETS = [
  { label: "Never", rule: "" },
  { label: "Daily", rule: "FREQ=DAILY;INTERVAL=1" },
  { label: "Weekly", rule: "FREQ=WEEKLY;INTERVAL=1" },
  { label: "Every 2 weeks", rule: "FREQ=WEEKLY;INTERVAL=2" },
  { label: "Monthly", rule: "FREQ=MONTHLY;INTERVAL=1" },
] as const;

function recurrenceExpiry(date: string) {
  return format(addDays(new Date(`${date}T12:00:00`), 30), "yyyy-MM-dd");
}

function defaultSchedule() {
  const date = new Date();
  const minutes = date.getMinutes();
  date.setMinutes(minutes < 30 ? 30 : 60, 0, 0);
  return {
    date: format(date, "yyyy-MM-dd"),
    time: format(date, "HH:mm"),
  };
}

export function QuickActionSheet({
  open,
  onClose,
  request,
}: QuickActionSheetProps) {
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<CaptureKind>("event");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => defaultSchedule().date);
  const [time, setTime] = useState(() => defaultSchedule().time);
  const [duration, setDuration] = useState(60);
  const [recurrenceRule, setRecurrenceRule] = useState("");
  const [recurrenceExpiryAt, setRecurrenceExpiryAt] = useState(() =>
    recurrenceExpiry(defaultSchedule().date),
  );

  // Activity: pick a workout group from the Train tab and put it on the
  // calendar at the chosen time.
  const [activityGroupId, setActivityGroupId] = useState<string | null>(null);

  // Task: an optional due date plus a checklist of bullet items.
  const [hasDueDate, setHasDueDate] = useState(true);
  const [checklistItems, setChecklistItems] = useState<string[]>([""]);

  const activeType = useMemo(
    () => CAPTURE_TYPES.find((type) => type.id === kind) ?? CAPTURE_TYPES[2],
    [kind],
  );

  const createEventMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<Event>("/api/events", payload),
    onSuccess: async () => {
      // Wait for the active agenda surface to refresh before dismissing the
      // sheet, while marking every other calendar range stale for navigation.
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      notify({
        title: "Event added",
        body: `${title.trim()} is on your calendar.`,
      });
      onClose();
    },
  });

  const { data: workoutGroups } = useQuery({
    queryKey: queryKeys.workoutGroups.all,
    queryFn: () => api.get<WorkoutGroup[]>("/api/workouts/groups"),
    staleTime: 300_000,
    enabled: open,
  });

  const createActivityMutation = useMutation({
    mutationFn: async (input: {
      groupId: string;
      name: string;
      startAt: string;
      endAt: string;
    }) => {
      const group = await api.get<WorkoutGroup & { exercises: GroupExercise[] }>(
        `/api/workouts/groups/${input.groupId}`,
      );

      await api.post<Event>("/api/events", {
        title: input.name,
        startAt: input.startAt,
        endAt: input.endAt,
        category: "personal",
        // Kept as a tag so the calendar can label it an Activity rather than
        // a plain event — see scheduleItemKind().
        tags: "activity",
        recurrenceRule: "",
        recurrenceExpiryAt: "",
        exercises: group.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          sets: exercise.defaultSets,
          reps: exercise.defaultReps,
          weight: exercise.defaultWeight,
        })),
      });

      return { groupName: group.name };
    },
    onSuccess: async ({ groupName }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      notify({
        title: "Activity scheduled",
        body: `${groupName} is on your calendar.`,
      });
      onClose();
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<Task>("/api/tasks", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      notify({
        title: "Task added",
        body: `${title.trim()} is on your board.`,
      });
      onClose();
    },
  });

  const activeMutation =
    kind === "activity" ? createActivityMutation : kind === "task" ? createTaskMutation : createEventMutation;

  const resetAllMutations = () => {
    createEventMutation.reset();
    createActivityMutation.reset();
    createTaskMutation.reset();
  };

  const activityQuery = title.trim().toLowerCase();
  const activityMatches = useMemo(() => {
    const groups = workoutGroups ?? [];
    if (!activityQuery) return groups.slice(0, 6);
    return groups
      .filter((group) => group.name.toLowerCase().includes(activityQuery))
      .slice(0, 6);
  }, [workoutGroups, activityQuery]);

  useEffect(() => {
    if (!open) return;
    const nextKind = request?.kind ?? "event";
    const nextSchedule = defaultSchedule();
    resetAllMutations();
    setKind(nextKind);
    setTitle(request?.title ?? "");
    setDate(request?.date ?? nextSchedule.date);
    setTime(nextSchedule.time);
    setDuration(60);
    setRecurrenceRule("");
    setRecurrenceExpiryAt(
      recurrenceExpiry(request?.date ?? nextSchedule.date),
    );
    setActivityGroupId(null);
    setHasDueDate(true);
    setChecklistItems([""]);
  }, [open, request]);

  const selectKind = (nextKind: CaptureKind) => {
    resetAllMutations();
    setActivityGroupId(null);
    setKind(nextKind);
  };

  const selectActivityGroup = (group: WorkoutGroup) => {
    setActivityGroupId(group.id);
    setTitle(group.name);
  };

  const scheduleShortcut = (shortcut: "now" | "later" | "tomorrow") => {
    const next = new Date();
    if (shortcut === "later") {
      next.setHours(next.getHours() + 2, 0, 0, 0);
    } else if (shortcut === "tomorrow") {
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
    } else {
      next.setMinutes(next.getMinutes() < 30 ? 30 : 60, 0, 0);
    }
    setDate(format(next, "yyyy-MM-dd"));
    setTime(format(next, "HH:mm"));
    if (recurrenceRule) {
      setRecurrenceExpiryAt(format(addDays(next, 30), "yyyy-MM-dd"));
    }
  };

  const selectRecurrence = (rule: string) => {
    setRecurrenceRule(rule);
    if (rule && recurrenceExpiryAt <= date) {
      setRecurrenceExpiryAt(recurrenceExpiry(date));
    }
  };

  const updateChecklistItem = (index: number, value: string) => {
    setChecklistItems((current) => current.map((item, i) => (i === index ? value : item)));
  };
  const addChecklistItem = () => setChecklistItems((current) => [...current, ""]);
  const removeChecklistItem = (index: number) =>
    setChecklistItems((current) => current.filter((_, i) => i !== index));

  const recurrenceError =
    kind === "event" && recurrenceRule && recurrenceExpiryAt <= date
      ? "Repeat-until date must be after the first event."
      : null;

  const hasChecklistContent = checklistItems.some((item) => item.trim());
  const canSubmit =
    Boolean(title.trim()) &&
    !activeMutation.isPending &&
    !recurrenceError &&
    (kind !== "task" || hasChecklistContent) &&
    (kind !== "activity" || Boolean(activityGroupId));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    if (kind === "activity") {
      if (!activityGroupId) return;
      const start = new Date(`${date}T${time}:00`);
      if (Number.isNaN(start.getTime())) return;
      createActivityMutation.mutate({
        groupId: activityGroupId,
        name: title.trim(),
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + duration * 60_000).toISOString(),
      });
      return;
    }

    if (kind === "task") {
      const items = checklistItems.map((item) => item.trim()).filter(Boolean);
      if (items.length === 0) return;
      let dueAt: string | undefined;
      if (hasDueDate) {
        const due = new Date(`${date}T${time}:00`);
        if (Number.isNaN(due.getTime())) return;
        dueAt = due.toISOString();
      }
      createTaskMutation.mutate({ title: title.trim(), dueAt, items });
      return;
    }

    const start = new Date(`${date}T${time}:00`);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + duration * 60_000);
    createEventMutation.mutate({
      title: title.trim(),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      category: "meeting",
      recurrenceRule,
      recurrenceExpiryAt: recurrenceRule
        ? new Date(`${recurrenceExpiryAt}T23:59:59`).toISOString()
        : "",
    });
  };

  const submitLabel = activeMutation.isPending
    ? "Adding…"
    : kind === "activity"
      ? "Add activity to calendar"
      : kind === "task"
        ? "Add task"
        : "Add event to calendar";

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="m-sheet-overlay fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="m-mobile-surface m-controller-surface m-sheet-content fixed bottom-0 z-50 max-h-[min(92dvh,760px)] overflow-x-hidden overflow-y-auto rounded-t-[28px] border border-b-0 border-[var(--m-border)] bg-[var(--m-surface)] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-3 shadow-[0_-18px_50px_rgba(0,0,0,0.16)] sm:bottom-4 sm:rounded-[28px] sm:border sm:pb-5"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            window.setTimeout(() => titleRef.current?.focus(), 80);
          }}
        >
          <div
            aria-hidden="true"
            className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--m-border-strong)]"
          />

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="m-eyebrow">Quick capture</p>
              <DialogPrimitive.Title className="mt-1 text-xl font-semibold tracking-tight text-[var(--m-text)]">
                Add it to your day
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug text-[var(--m-text-2)]">
                One thought in, the right place out.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="m-icon-button m-press"
                aria-label="Close quick capture"
              >
                <X width={19} height={19} />
              </button>
            </DialogPrimitive.Close>
          </div>

          <form className="mt-5" onSubmit={submit}>
            <fieldset>
              <legend className="sr-only">What are you adding?</legend>
              <div className="grid grid-cols-3 gap-2">
                {CAPTURE_TYPES.map((type) => {
                  const Icon = type.icon;
                  const selected = type.id === kind;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectKind(type.id)}
                      className={cn(
                        "m-press flex min-w-0 flex-col items-start rounded-2xl border p-3 text-left",
                        selected
                          ? "border-[var(--m-text)] bg-[var(--m-primary)] text-[var(--m-primary-fg)]"
                          : "border-[var(--m-border)] bg-[var(--m-surface-2)] text-[var(--m-text)]",
                      )}
                    >
                      <Icon width={18} height={18} strokeWidth={2} />
                      <span className="mt-3 block text-[13px] font-semibold">
                        {type.label}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-[10px]",
                          selected
                            ? "text-[var(--m-primary-fg)] opacity-60"
                            : "text-[var(--m-text-3)]",
                        )}
                      >
                        {type.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-4">
              <label
                htmlFor="quick-capture-title"
                className="mb-1.5 block text-[12px] font-semibold text-[var(--m-text)]"
              >
                {kind === "activity"
                  ? "Search your workout groups"
                  : "What’s happening?"}
              </label>
              <span className="relative block">
                <input
                  ref={titleRef}
                  id="quick-capture-title"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setActivityGroupId(null);
                  }}
                  placeholder={activeType.placeholder}
                  autoComplete="off"
                  className={cn("m-field w-full", kind === "activity" && "pl-9")}
                />
                {kind === "activity" && (
                  <Search
                    width={15}
                    height={15}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--m-text-3)]"
                  />
                )}
              </span>
            </div>

            {kind === "activity" && (
              <div
                className="mt-2 overflow-hidden rounded-2xl border border-[var(--m-border)] bg-[var(--m-surface-2)]"
                role="listbox"
                aria-label="Your workout groups"
              >
                {activityMatches.length === 0 && (
                  <p className="px-3 py-3 text-[12px] text-[var(--m-text-3)]">
                    {title.trim()
                      ? "No workout groups match that name."
                      : "No workout groups yet — build one in the Train tab first."}
                  </p>
                )}
                {activityMatches.map((group) => {
                  const selected = group.id === activityGroupId;
                  return (
                    <button
                      key={group.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => selectActivityGroup(group)}
                      className={cn(
                        "m-press flex min-h-11 w-full items-center gap-2 border-b border-[var(--m-border)] px-3 py-2 text-left last:border-b-0",
                        selected && "bg-[var(--m-primary)]/12",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[var(--m-text)]">
                          {group.name}
                        </span>
                        <span className="block truncate text-[10px] text-[var(--m-text-3)]">
                          {group.targetDays || "Workout group"}
                        </span>
                      </span>
                      {selected && (
                        <Check
                          width={15}
                          height={15}
                          strokeWidth={3}
                          aria-hidden="true"
                          className="shrink-0 text-[var(--m-text)]"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {kind === "task" && (
              <>
                <fieldset className="mt-4">
                  <legend className="mb-2 text-[12px] font-semibold text-[var(--m-text)]">
                    Checklist
                  </legend>
                  <div className="space-y-2">
                    {checklistItems.map((item, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          value={item}
                          onChange={(event) => updateChecklistItem(index, event.target.value)}
                          placeholder={`Item ${index + 1}`}
                          autoComplete="off"
                          className="m-field w-full"
                        />
                        <button
                          type="button"
                          onClick={() => removeChecklistItem(index)}
                          disabled={checklistItems.length === 1}
                          aria-label={`Remove item ${index + 1}`}
                          className="m-icon-button m-press shrink-0 disabled:opacity-30"
                        >
                          <Trash2 width={16} height={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addChecklistItem}
                    className="m-press mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--m-primary)]"
                  >
                    <Plus width={14} height={14} /> Add item
                  </button>
                </fieldset>

                <label className="mt-4 flex items-center justify-between gap-3 py-1">
                  <span className="text-[13px] font-medium text-[var(--m-text)]">Set a due date</span>
                  <input
                    type="checkbox"
                    checked={hasDueDate}
                    onChange={(event) => setHasDueDate(event.target.checked)}
                    className="h-5 w-5 rounded border-[var(--m-border)]"
                  />
                </label>
              </>
            )}

            {(kind === "event" ||
              kind === "activity" ||
              (kind === "task" && hasDueDate)) && (
              <>
                <fieldset className="mt-4">
                  <legend className="mb-2 text-[12px] font-semibold text-[var(--m-text)]">
                    When?
                  </legend>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ["now", "Next slot"],
                        ["later", "In 2 hours"],
                        ["tomorrow", "Tomorrow"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => scheduleShortcut(value)}
                        className="m-secondary-button m-press min-w-0 truncate px-2 text-[12px]"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="m-field-shell">
                    <CalendarDays
                      width={16}
                      height={16}
                      aria-hidden="true"
                      className="shrink-0 text-[var(--m-text-3)]"
                    />
                    <span className="sr-only">Date</span>
                    <input
                      type="date"
                      value={date}
                      onChange={(event) => {
                        const nextDate = event.target.value;
                        setDate(nextDate);
                        if (recurrenceRule && recurrenceExpiryAt <= nextDate) {
                          setRecurrenceExpiryAt(recurrenceExpiry(nextDate));
                        }
                      }}
                      className="min-w-0 flex-1 bg-transparent text-[16px] focus:outline-none"
                      required
                    />
                  </label>
                  <label className="m-field-shell">
                    <Clock3
                      width={16}
                      height={16}
                      aria-hidden="true"
                      className="shrink-0 text-[var(--m-text-3)]"
                    />
                    <span className="sr-only">Start time</span>
                    <input
                      type="time"
                      value={time}
                      onChange={(event) => setTime(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-[16px] focus:outline-none"
                      required
                    />
                  </label>
                </div>
              </>
            )}

            {(kind === "event" || kind === "activity") && (
              <label className="m-field-shell mt-2">
                <span className="flex-1 text-[13px] font-medium text-[var(--m-text-2)]">
                  Duration
                </span>
                <select
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                  className="appearance-none bg-transparent text-right text-[16px] font-semibold text-[var(--m-text)] focus:outline-none"
                >
                  {DURATIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  width={15}
                  height={15}
                  aria-hidden="true"
                  className="text-[var(--m-text-3)]"
                />
              </label>
            )}

            {kind === "event" && (
              <>
                <label className="m-field-shell mt-2">
                  <Repeat
                    width={16}
                    height={16}
                    aria-hidden="true"
                    className="shrink-0 text-[var(--m-text-3)]"
                  />
                  <span className="flex-1 text-[13px] font-medium text-[var(--m-text-2)]">
                    Repeat
                  </span>
                  <select
                    value={recurrenceRule}
                    onChange={(event) => selectRecurrence(event.target.value)}
                    className="max-w-[58%] appearance-none truncate bg-transparent text-right text-[15px] font-semibold text-[var(--m-text)] focus:outline-none"
                    aria-label="Repeat schedule"
                  >
                    {RECURRENCE_PRESETS.map((preset) => (
                      <option key={preset.label} value={preset.rule}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    width={15}
                    height={15}
                    aria-hidden="true"
                    className="text-[var(--m-text-3)]"
                  />
                </label>

                {recurrenceRule && (
                  <label className="m-field-shell mt-2">
                    <CalendarDays
                      width={16}
                      height={16}
                      aria-hidden="true"
                      className="shrink-0 text-[var(--m-text-3)]"
                    />
                    <span className="flex-1 text-[13px] font-medium text-[var(--m-text-2)]">
                      Repeat until
                    </span>
                    <input
                      type="date"
                      min={format(addDays(new Date(`${date}T12:00:00`), 1), "yyyy-MM-dd")}
                      value={recurrenceExpiryAt}
                      onChange={(event) => setRecurrenceExpiryAt(event.target.value)}
                      className="min-w-0 max-w-[58%] bg-transparent text-right text-[15px] font-semibold focus:outline-none"
                      aria-label="Repeat until date"
                      required
                    />
                  </label>
                )}

                {recurrenceError && (
                  <p className="mt-2 text-[11px] text-red-300" role="alert">
                    {recurrenceError}
                  </p>
                )}
              </>
            )}

            {activeMutation.isError && (
              <p
                className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12px] leading-snug text-red-700"
                role="alert"
              >
                We couldn’t add this right now. Check your connection and try
                again.
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="m-primary-button m-press mt-4 w-full"
            >
              {submitLabel}
            </button>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
