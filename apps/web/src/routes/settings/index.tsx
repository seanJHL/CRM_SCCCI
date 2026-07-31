import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Dumbbell,
  RotateCcw,
  Save,
  ShieldCheck,
  Timer,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_APP_PREFERENCES,
  type AppPreferences,
  type CalendarDefaultView,
  useAppPreferences,
} from "@/lib/preferences";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  const { preferences, ready, save, reset } = useAppPreferences();
  const [draft, setDraft] = useState<AppPreferences>(DEFAULT_APP_PREFERENCES);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (ready) setDraft(preferences);
  }, [preferences, ready]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(preferences),
    [draft, preferences],
  );

  function updatePreference<K extends keyof AppPreferences>(
    key: K,
    value: AppPreferences[K],
  ) {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleSave() {
    save(draft);
    setSaved(true);
  }

  function handleReset() {
    reset();
    setDraft(DEFAULT_APP_PREFERENCES);
    setSaved(true);
  }

  return (
    <div className="min-h-screen bg-[#fafafa] px-4 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Personal preferences
            </p>
            <h1 className="text-[28px] font-bold tracking-tight text-foreground">
              Settings
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Choose how your calendar and workouts should behave by default.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset
            </Button>
            <Button onClick={handleSave} disabled={!isDirty}>
              {saved && !isDirty ? (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              {saved && !isDirty ? "Saved" : "Save changes"}
            </Button>
          </div>
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-5">
            <SettingsSection
              icon={CalendarDays}
              title="Calendar defaults"
              description="Open the calendar in the view and week layout you use most."
            >
              <SettingRow
                label="Default view"
                description="Used whenever you open or return to Calendar."
              >
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                  {(["month", "week", "day"] as CalendarDefaultView[]).map(
                    (view) => (
                      <ChoiceButton
                        key={view}
                        selected={draft.calendarDefaultView === view}
                        onClick={() =>
                          updatePreference("calendarDefaultView", view)
                        }
                      >
                        {view}
                      </ChoiceButton>
                    ),
                  )}
                </div>
              </SettingRow>

              <SettingRow
                label="Week starts on"
                description="Changes the order and grouping of dates."
              >
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                  <ChoiceButton
                    selected={draft.weekStartsOn === 1}
                    onClick={() => updatePreference("weekStartsOn", 1)}
                  >
                    Monday
                  </ChoiceButton>
                  <ChoiceButton
                    selected={draft.weekStartsOn === 0}
                    onClick={() => updatePreference("weekStartsOn", 0)}
                  >
                    Sunday
                  </ChoiceButton>
                </div>
              </SettingRow>
            </SettingsSection>

            <SettingsSection
              icon={Dumbbell}
              title="Workout defaults"
              description="Speed up workout creation with targets that match your routine."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberPreference
                  icon={Dumbbell}
                  label="Default sets"
                  description="For exercises without history"
                  value={draft.defaultSets}
                  min={1}
                  max={20}
                  step={1}
                  suffix="sets"
                  onChange={(value) => updatePreference("defaultSets", value)}
                />
                <NumberPreference
                  icon={TrendingUp}
                  label="Default reps"
                  description="Starting target per set"
                  value={draft.defaultReps}
                  min={1}
                  max={100}
                  step={1}
                  suffix="reps"
                  onChange={(value) => updatePreference("defaultReps", value)}
                />
                <NumberPreference
                  icon={TrendingUp}
                  label="Overload increment"
                  description="Suggested weight increase"
                  value={draft.overloadIncrement}
                  min={0.25}
                  max={25}
                  step={0.25}
                  suffix="kg"
                  onChange={(value) =>
                    updatePreference("overloadIncrement", value)
                  }
                />
                <NumberPreference
                  icon={Timer}
                  label="Rest timer"
                  description="Starts after logging a set"
                  value={draft.restTimerSeconds}
                  min={15}
                  max={600}
                  step={15}
                  suffix="sec"
                  onChange={(value) =>
                    updatePreference("restTimerSeconds", value)
                  }
                />
              </div>
            </SettingsSection>

            <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-4">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-[12px] font-semibold text-foreground">
                  Stored on this device
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  These preferences stay in this browser and contain no workout
                  history or personal account data.
                </p>
              </div>
            </div>
          </div>

          <aside className="rounded-xl border border-border bg-background p-5 lg:sticky lg:top-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
              Your defaults
            </p>
            <h2 className="mt-1 text-base font-semibold text-foreground">
              Ready for your next session
            </h2>
            <div className="mt-5 space-y-4">
              <PreferenceSummary
                icon={CalendarDays}
                label="Calendar opens in"
                value={`${draft.calendarDefaultView} view`}
                detail={`Week begins ${
                  draft.weekStartsOn === 1 ? "Monday" : "Sunday"
                }`}
              />
              <PreferenceSummary
                icon={Dumbbell}
                label="New exercise target"
                value={`${draft.defaultSets} × ${draft.defaultReps}`}
                detail="Used when no previous workout exists"
              />
              <PreferenceSummary
                icon={TrendingUp}
                label="Progression suggestion"
                value={`+${draft.overloadIncrement} kg`}
                detail="Or one additional rep"
              />
              <PreferenceSummary
                icon={Timer}
                label="Rest after each set"
                value={`${draft.restTimerSeconds} seconds`}
                detail="Timer can still be skipped"
              />
            </div>

            {isDirty && (
              <div className="mt-5 rounded-lg bg-amber-50 px-3 py-2.5">
                <p className="text-[10px] font-medium leading-relaxed text-amber-900">
                  You have unsaved changes. Save them to use these defaults
                  across Ember.
                </p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof CalendarDays;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-start gap-3 border-b border-border p-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-4 w-4 text-foreground" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="divide-y divide-border px-5">{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_260px] sm:items-center">
      <div>
        <p className="text-[12px] font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

function ChoiceButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-[11px] font-medium capitalize text-muted-foreground transition-colors hover:text-foreground",
        selected && "bg-background text-foreground shadow-sm",
      )}
    >
      {children}
    </button>
  );
}

function NumberPreference({
  icon: Icon,
  label,
  description,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  icon: typeof Dumbbell;
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="rounded-lg border border-border p-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
      </span>
      <span className="mt-0.5 block text-[9px] text-muted-foreground">
        {description}
      </span>
      <span className="mt-3 flex items-center gap-2">
        <Input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) {
              onChange(Math.min(max, Math.max(min, next)));
            }
          }}
          className="h-8 text-right text-[12px] font-semibold tabular-nums"
        />
        <span className="w-8 text-[10px] text-muted-foreground">{suffix}</span>
      </span>
    </label>
  );
}

function PreferenceSummary({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-3.5 w-3.5 text-foreground" />
      </div>
      <div>
        <p className="text-[9px] font-medium text-muted-foreground">{label}</p>
        <p className="text-[12px] font-semibold capitalize text-foreground">
          {value}
        </p>
        <p className="text-[9px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
