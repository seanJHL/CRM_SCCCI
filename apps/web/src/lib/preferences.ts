import { useCallback, useEffect, useState } from "react";

export type CalendarDefaultView = "month" | "week" | "day";

export interface AppPreferences {
  calendarDefaultView: CalendarDefaultView;
  weekStartsOn: 0 | 1;
  defaultSets: number;
  defaultReps: number;
  overloadIncrement: number;
  restTimerSeconds: number;
}

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  calendarDefaultView: "month",
  weekStartsOn: 1,
  defaultSets: 3,
  defaultReps: 10,
  overloadIncrement: 2.5,
  restTimerSeconds: 60,
};

const STORAGE_KEY = "ember.app-preferences.v1";
const PREFERENCES_EVENT = "ember:preferences-changed";

function isCalendarView(value: unknown): value is CalendarDefaultView {
  return value === "month" || value === "week" || value === "day";
}

export function getAppPreferences(): AppPreferences {
  if (typeof window === "undefined") return DEFAULT_APP_PREFERENCES;

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as Partial<AppPreferences>;

    return {
      calendarDefaultView: isCalendarView(stored.calendarDefaultView)
        ? stored.calendarDefaultView
        : DEFAULT_APP_PREFERENCES.calendarDefaultView,
      weekStartsOn:
        stored.weekStartsOn === 0 || stored.weekStartsOn === 1
          ? stored.weekStartsOn
          : DEFAULT_APP_PREFERENCES.weekStartsOn,
      defaultSets:
        typeof stored.defaultSets === "number" && stored.defaultSets > 0
          ? stored.defaultSets
          : DEFAULT_APP_PREFERENCES.defaultSets,
      defaultReps:
        typeof stored.defaultReps === "number" && stored.defaultReps > 0
          ? stored.defaultReps
          : DEFAULT_APP_PREFERENCES.defaultReps,
      overloadIncrement:
        typeof stored.overloadIncrement === "number" &&
        stored.overloadIncrement > 0
          ? stored.overloadIncrement
          : DEFAULT_APP_PREFERENCES.overloadIncrement,
      restTimerSeconds:
        typeof stored.restTimerSeconds === "number" &&
        stored.restTimerSeconds >= 15
          ? stored.restTimerSeconds
          : DEFAULT_APP_PREFERENCES.restTimerSeconds,
    };
  } catch {
    return DEFAULT_APP_PREFERENCES;
  }
}

export function saveAppPreferences(preferences: AppPreferences) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT));
}

export function resetAppPreferences() {
  saveAppPreferences(DEFAULT_APP_PREFERENCES);
}

export function useAppPreferences() {
  const [preferences, setPreferences] = useState<AppPreferences>(
    DEFAULT_APP_PREFERENCES,
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setPreferences(getAppPreferences());
      setReady(true);
    };
    refresh();
    window.addEventListener(PREFERENCES_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const save = useCallback((nextPreferences: AppPreferences) => {
    saveAppPreferences(nextPreferences);
  }, []);

  const reset = useCallback(() => {
    resetAppPreferences();
  }, []);

  return { preferences, ready, save, reset };
}
