import { useEffect, useMemo, useRef, useState } from "react";
import { format, addDays } from "date-fns";
import {
  AlignLeft,
  Bookmark,
  CalendarDays,
  Dumbbell,
  Hash,
  Link2,
  Palette,
  Repeat,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Event, Exercise } from "@/lib/query-keys";
import { queryKeys } from "@/lib/query-keys";
import {
  EVENT_CATEGORIES,
  EVENT_PALETTE,
  MAX_TAGS,
  type EventCategory,
  normalizeTag,
  paletteById,
  parseTags,
  serializeTags,
  CATEGORY_META,
} from "@/lib/event-meta";

export interface ExerciseItem {
  exerciseId: string;
  sets: number;
  reps: number;
  weight: number | null;
}

export interface EventPayload {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  category: EventCategory;
  color: string;
  tags: string;
  link: string;
  recurrenceRule: string;
  recurrenceExpiryAt: string;
  exercises: ExerciseItem[];
}

interface EventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Event being edited; null puts the dialog in create mode. */
  event: Event | null;
  /** Date pre-filled in create mode. */
  defaultDate: Date;
  /** Tags that already exist across events, offered as suggestions. */
  tagSuggestions: string[];
  onSubmit: (payload: EventPayload) => void;
  onDelete?: (id: string) => void;
  isSaving: boolean;
}

const toISO = (date: string, time: string) =>
  new Date(`${date}T${time}:00`).toISOString();

const RECURRENCE_PRESETS = [
  { label: "Does not repeat", rule: "" },
  { label: "Daily", rule: "FREQ=DAILY;INTERVAL=1" },
  { label: "Weekly", rule: "FREQ=WEEKLY;INTERVAL=1" },
  { label: "Biweekly", rule: "FREQ=WEEKLY;INTERVAL=2" },
  { label: "Monthly", rule: "FREQ=MONTHLY;INTERVAL=1" },
] as const;

const MAX_EXERCISES = 8;

export function EventDialog({
  open,
  onOpenChange,
  event,
  defaultDate,
  tagSuggestions,
  onSubmit,
  onDelete,
  isSaving,
}: EventDialogProps) {
  const isEdit = event !== null;

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [isAllDay, setIsAllDay] = useState(false);
  const [category, setCategory] = useState<EventCategory>("meeting");
  const [color, setColor] = useState(""); // "" = follow category
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [description, setDescription] = useState("");
  const [link, setLink] = useState("");
  const [touched, setTouched] = useState(false);

  // Recurrence state
  const [recurrenceRule, setRecurrenceRule] = useState("");
  const [recurrenceExpiryAt, setRecurrenceExpiryAt] = useState(
    format(addDays(new Date(), 30), "yyyy-MM-dd"),
  );

  // Exercises state
  const [attachedExercises, setAttachedExercises] = useState<
    Array<ExerciseItem & { exerciseName: string }>
  >([]);
  const [exerciseSearchOpen, setExerciseSearchOpen] = useState(false);
  const [exerciseSearchQuery, setExerciseSearchQuery] = useState("");
  const exerciseSearchRef = useRef<HTMLInputElement>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  // Fetch exercise library
  const { data: exerciseLibrary } = useQuery({
    queryKey: queryKeys.exercises.all,
    queryFn: () => api.get<Exercise[]>("/api/exercises"),
    staleTime: 600_000,
    gcTime: 900_000,
  });

  const filteredExercises = useMemo(() => {
    const lib = exerciseLibrary ?? [];
    if (!exerciseSearchQuery.trim()) return lib;
    const q = exerciseSearchQuery.toLowerCase();
    return lib.filter(
      (ex) =>
        ex.name.toLowerCase().includes(q) ||
        ex.category.toLowerCase().includes(q),
    );
  }, [exerciseLibrary, exerciseSearchQuery]);

  // Re-seed the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setTagInput("");
    setExerciseSearchQuery("");
    setExerciseSearchOpen(false);
    if (event) {
      const start = new Date(event.startAt);
      const end = new Date(event.endAt);
      setTitle(event.title);
      setDate(format(start, "yyyy-MM-dd"));
      setStartTime(format(start, "HH:mm"));
      setEndTime(format(end, "HH:mm"));
      setIsAllDay(event.isAllDay);
      setCategory(event.category);
      setColor(event.color ?? "");
      setTags(parseTags(event.tags));
      setDescription(event.description ?? "");
      setLink(event.link ?? "");
      setRecurrenceRule(event.recurrenceRule ?? "");
      setRecurrenceExpiryAt(
        event.recurrenceExpiryAt
          ? format(new Date(event.recurrenceExpiryAt), "yyyy-MM-dd")
          : format(addDays(end, 30), "yyyy-MM-dd"),
      );
      setAttachedExercises(
        (event.exercises ?? []).map((ex) => ({
          exerciseId: ex.exerciseId,
          sets: ex.sets,
          reps: ex.reps,
          weight: ex.weight,
          exerciseName: ex.exerciseName,
        })),
      );
    } else {
      setTitle("");
      setDate(format(defaultDate, "yyyy-MM-dd"));
      setStartTime("09:00");
      setEndTime("10:00");
      setIsAllDay(false);
      setCategory("meeting");
      setColor("");
      setTags([]);
      setDescription("");
      setLink("");
      setRecurrenceRule("");
      setRecurrenceExpiryAt(format(addDays(defaultDate, 30), "yyyy-MM-dd"));
      setAttachedExercises([]);
    }
    const timer = setTimeout(() => titleRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open, event?.id]);

  // Focus search input when exercise search opens
  useEffect(() => {
    if (exerciseSearchOpen) {
      setTimeout(() => exerciseSearchRef.current?.focus(), 30);
    }
  }, [exerciseSearchOpen]);

  const timeError = useMemo(() => {
    if (isAllDay) return null;
    return endTime <= startTime ? "End time must be after the start time." : null;
  }, [isAllDay, startTime, endTime]);

  const recurrenceError = useMemo(() => {
    if (!recurrenceRule) return null;
    if (!recurrenceExpiryAt) return "Recurring events need an expiry date.";
    if (recurrenceExpiryAt <= date) return "Expiry must be after the event date.";
    return null;
  }, [recurrenceRule, recurrenceExpiryAt, date]);

  const canSave =
    title.trim().length > 0 && !timeError && !recurrenceError && !isSaving;

  const suggestions = useMemo(
    () =>
      tagSuggestions
        .filter(
          (tag) => !tags.some((selected) => selected.toLowerCase() === tag.toLowerCase()),
        )
        .slice(0, 6),
    [tagSuggestions, tags],
  );

  function addTag(raw: string) {
    const tag = normalizeTag(raw);
    if (!tag) return;
    setTags((current) => {
      if (current.length >= MAX_TAGS) return current;
      if (current.some((item) => item.toLowerCase() === tag.toLowerCase())) {
        return current;
      }
      return [...current, tag];
    });
    setTagInput("");
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
      return;
    }
    if (e.key === "Backspace" && tagInput === "") {
      setTags((current) => current.slice(0, -1));
    }
  }

  function addExercise(ex: Exercise) {
    if (attachedExercises.length >= MAX_EXERCISES) return;
    if (attachedExercises.some((e) => e.exerciseId === ex.id)) return;
    setAttachedExercises((current) => [
      ...current,
      { exerciseId: ex.id, sets: 3, reps: 10, weight: null, exerciseName: ex.name },
    ]);
    setExerciseSearchQuery("");
  }

  function removeExercise(exerciseId: string) {
    setAttachedExercises((current) =>
      current.filter((e) => e.exerciseId !== exerciseId),
    );
  }

  function updateExercise(
    exerciseId: string,
    field: "sets" | "reps" | "weight",
    value: number | null,
  ) {
    setAttachedExercises((current) =>
      current.map((e) =>
        e.exerciseId === exerciseId ? { ...e, [field]: value } : e,
      ),
    );
  }

  function handleRecurrencePreset(rule: string) {
    setRecurrenceRule(rule);
    if (rule && !recurrenceExpiryAt) {
      setRecurrenceExpiryAt(format(addDays(new Date(date), 30), "yyyy-MM-dd"));
    }
  }

  function handleSubmit() {
    setTouched(true);
    if (!canSave) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      startAt: toISO(date, isAllDay ? "00:00" : startTime),
      endAt: toISO(date, isAllDay ? "23:59" : endTime),
      isAllDay,
      category,
      color,
      tags: serializeTags(tags),
      link: link.trim(),
      recurrenceRule,
      recurrenceExpiryAt: recurrenceRule
        ? new Date(`${recurrenceExpiryAt}T23:59:59`).toISOString()
        : "",
      exercises: attachedExercises.map((ex) => ({
        exerciseId: ex.exerciseId,
        sets: ex.sets,
        reps: ex.reps,
        weight: ex.weight,
      })),
    });
  }

  const autoColor = paletteById(CATEGORY_META[category].colorId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[540px] overflow-hidden p-0">
        <DialogTitle className="sr-only">
          {isEdit ? "Edit event" : "New event"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {isEdit
            ? "Update the details of this event."
            : "Add a new event to your calendar."}
        </DialogDescription>

        {/* Title block */}
        <div className="border-b border-border px-6 pb-4 pt-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {format(new Date(`${date}T00:00:00`), "EEEE, d MMMM yyyy")}
            <span className="mx-1.5 text-border">·</span>
            {isEdit ? "Edit event" : "New event"}
          </p>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="Add a title"
            aria-label="Event title"
            className="w-full bg-transparent text-[20px] font-semibold tracking-[-0.02em] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          />
          {touched && title.trim() === "" && (
            <p className="mt-1 text-[11px] text-destructive">
              A title is required.
            </p>
          )}
        </div>

        {/* Property rows */}
        <div className="max-h-[55vh] space-y-4 overflow-y-auto px-6 py-4">
          {/* When */}
          <div className="flex gap-3">
            <CalendarDays className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                  aria-label="Event date"
                  className="h-8 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {!isAllDay && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      aria-label="Start time"
                      className="h-8 rounded-md border border-border bg-background px-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-muted-foreground/60">–</span>
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      aria-label="End time"
                      className="h-8 rounded-md border border-border bg-background px-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={isAllDay}
                  onClick={() => setIsAllDay((value) => !value)}
                  className="ml-auto flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span
                    className={cn(
                      "relative h-[18px] w-8 rounded-full bg-muted transition-colors",
                      isAllDay && "bg-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-[2px] left-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform",
                        isAllDay && "translate-x-[14px]",
                      )}
                    />
                  </span>
                  All day
                </button>
              </div>
              {timeError && (
                <p className="mt-1.5 text-[11px] text-destructive">{timeError}</p>
              )}
            </div>
          </div>

          {/* Recurrence */}
          <div className="flex gap-3">
            <Repeat className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-1.5">
                {RECURRENCE_PRESETS.map((preset) => {
                  const selected = recurrenceRule === preset.rule;
                  return (
                    <button
                      type="button"
                      key={preset.label}
                      aria-pressed={selected}
                      onClick={() => handleRecurrencePreset(preset.rule)}
                      className={cn(
                        "h-7 rounded-md border px-2.5 text-[11px] font-medium transition-all",
                        selected
                          ? "border-foreground/30 bg-foreground/5 text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              {recurrenceRule && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Repeat until</span>
                  <input
                    type="date"
                    value={recurrenceExpiryAt}
                    onChange={(e) =>
                      e.target.value && setRecurrenceExpiryAt(e.target.value)
                    }
                    min={date}
                    aria-label="Recurrence expiry date"
                    className="h-7 rounded-md border border-border bg-background px-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              )}
              {recurrenceError && (
                <p className="mt-1 text-[11px] text-destructive">{recurrenceError}</p>
              )}
            </div>
          </div>

          {/* Category */}
          <div className="flex gap-3">
            <Bookmark className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
            <div className="flex flex-1 flex-wrap gap-1.5">
              {EVENT_CATEGORIES.map((option) => {
                const optionColor = paletteById(option.colorId);
                const selected = category === option.id;
                return (
                  <button
                    type="button"
                    key={option.id}
                    aria-pressed={selected}
                    onClick={() => setCategory(option.id)}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-[12px] font-medium transition-all",
                      selected
                        ? cn(optionColor.chip, "border-current/20 shadow-sm")
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", optionColor.dot)} />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Colour */}
          <div className="flex gap-3">
            <Palette className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/60" />
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-pressed={color === ""}
                onClick={() => setColor("")}
                title={`Auto (${autoColor.label})`}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors",
                  color === ""
                    ? "border-foreground/25 bg-muted text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <span className={cn("h-2.5 w-2.5 rounded-full", autoColor.dot)} />
                Auto
              </button>
              {EVENT_PALETTE.map((option) => {
                const selected = color === option.id;
                return (
                  <button
                    type="button"
                    key={option.id}
                    aria-pressed={selected}
                    aria-label={option.label}
                    title={option.label}
                    onClick={() => setColor(selected ? "" : option.id)}
                    className={cn(
                      "h-[22px] w-[22px] rounded-full transition-transform hover:scale-110",
                      option.swatch,
                      selected &&
                        "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                    )}
                  />
                );
              })}
            </div>
          </div>

          {/* Tags */}
          <div className="flex gap-3">
            <Hash className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "flex min-h-8 flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 transition-shadow focus-within:ring-1 focus-within:ring-ring",
                )}
              >
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="group flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag}`}
                      onClick={() =>
                        setTags((current) => current.filter((item) => item !== tag))
                      }
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {tags.length < MAX_TAGS && (
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onBlur={() => tagInput.trim() && addTag(tagInput)}
                    placeholder={tags.length === 0 ? "Add tags…" : ""}
                    aria-label="Add tag"
                    className="h-6 min-w-[90px] flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                  />
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {suggestions.map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    onClick={() => addTag(tag)}
                    className="rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground"
                  >
                    + {tag}
                  </button>
                ))}
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
                  {tags.length}/{MAX_TAGS}
                </span>
              </div>
            </div>
          </div>

          {/* Exercises */}
          <div className="flex gap-3">
            <Dumbbell className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
            <div className="min-w-0 flex-1">
              <div className="space-y-1.5">
                {attachedExercises.map((ex) => (
                  <div
                    key={ex.exerciseId}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                      {ex.exerciseName}
                    </span>
                    <div className="flex items-center gap-1">
                      <label className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        Sets
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={ex.sets}
                          onChange={(e) =>
                            updateExercise(
                              ex.exerciseId,
                              "sets",
                              parseInt(e.target.value) || 1,
                            )
                          }
                          className="h-6 w-12 rounded border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </label>
                      <span className="text-muted-foreground/40">×</span>
                      <label className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        Reps
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={ex.reps}
                          onChange={(e) =>
                            updateExercise(
                              ex.exerciseId,
                              "reps",
                              parseInt(e.target.value) || 1,
                            )
                          }
                          className="h-6 w-12 rounded border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </label>
                      <label className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        kg
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={ex.weight ?? ""}
                          onChange={(e) =>
                            updateExercise(
                              ex.exerciseId,
                              "weight",
                              e.target.value ? parseFloat(e.target.value) : null,
                            )
                          }
                          className="h-6 w-14 rounded border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${ex.exerciseName}`}
                      onClick={() => removeExercise(ex.exerciseId)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>

              {attachedExercises.length < MAX_EXERCISES && (
                <div className="relative mt-2">
                  <button
                    type="button"
                    onClick={() => setExerciseSearchOpen((v) => !v)}
                    className="flex h-7 w-full items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground"
                  >
                    <Search className="h-3 w-3" />
                    Add exercise…
                  </button>

                  {exerciseSearchOpen && (
                    <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-background shadow-lg">
                      <div className="sticky top-0 border-b border-border bg-background px-2 py-1.5">
                        <input
                          ref={exerciseSearchRef}
                          value={exerciseSearchQuery}
                          onChange={(e) => setExerciseSearchQuery(e.target.value)}
                          placeholder="Search exercises…"
                          aria-label="Search exercises"
                          className="h-7 w-full rounded border border-border bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                      {filteredExercises.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-muted-foreground">
                          No exercises found.
                        </p>
                      ) : (
                        <div className="py-1">
                          {filteredExercises.map((ex) => {
                            const alreadyAdded = attachedExercises.some(
                              (e) => e.exerciseId === ex.id,
                            );
                            return (
                              <button
                                type="button"
                                key={ex.id}
                                disabled={alreadyAdded}
                                onClick={() => addExercise(ex)}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-muted",
                                  alreadyAdded &&
                                    "cursor-not-allowed opacity-40",
                                )}
                              >
                                <span className="flex-1 truncate font-medium text-foreground">
                                  {ex.name}
                                </span>
                                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                                  {ex.category}
                                </span>
                                {alreadyAdded && (
                                  <span className="text-[9px] text-muted-foreground">
                                    Added
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <span className="mt-1 block text-right text-[10px] tabular-nums text-muted-foreground/60">
                {attachedExercises.length}/{MAX_EXERCISES} exercises
              </span>
            </div>
          </div>

          {/* Link */}
          <div className="flex gap-3">
            <Link2 className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
            <div className="min-w-0 flex-1">
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Add a link (Zoom, Meet, docs…)"
                aria-label="Event link"
                className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link2 className="h-3 w-3" />
                  <span className="truncate">{link.replace(/^https?:\/\//, "")}</span>
                </a>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="flex gap-3">
            <AlignLeft className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Add a description…"
              aria-label="Event description"
              className="flex-1 resize-none rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] leading-5 text-foreground placeholder:text-muted-foreground/50 focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-6 py-3">
          {isEdit && onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDelete(event.id)}
              disabled={isSaving}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={!canSave}
              className="px-4"
            >
              {isSaving ? "Saving…" : isEdit ? "Save changes" : "Create event"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
