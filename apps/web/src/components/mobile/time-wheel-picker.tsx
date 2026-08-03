import { useMemo } from "react";
import { WheelColumn } from "./wheel-column";
import { cn } from "@/lib/utils";

interface TimeWheelPickerProps {
  /** Selected time in 24h "HH:mm" format (what the API stores). */
  value: string;
  /** Fired with a 24h "HH:mm" string as the wheels settle. */
  onChange: (value: string) => void;
  itemHeight?: number;
  visibleItems?: number;
  className?: string;
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => String(i + 1)); // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0"),
);
const MERIDIEM = ["AM", "PM"];

interface Parts {
  hour: string;
  minute: string;
  ampm: string;
}

/** Convert 24h "HH:mm" → 12h parts. Falls back to 09:00 on bad input. */
function toParts(time: string): Parts {
  const parsed = /^(\d{2}):(\d{2})$/.exec(time ?? "");
  let h = parsed ? Number(parsed[1]) : 9;
  let m = parsed ? Number(parsed[2]) : 0;
  if (Number.isNaN(h)) h = 9;
  if (Number.isNaN(m)) m = 0;
  h = ((h % 24) + 24) % 24;
  m = ((m % 60) + 60) % 60;

  let hour12: number;
  let ampm: string;
  if (h === 0) {
    hour12 = 12;
    ampm = "AM";
  } else if (h < 12) {
    hour12 = h;
    ampm = "AM";
  } else if (h === 12) {
    hour12 = 12;
    ampm = "PM";
  } else {
    hour12 = h - 12;
    ampm = "PM";
  }
  return {
    hour: String(hour12),
    minute: String(m).padStart(2, "0"),
    ampm,
  };
}

/** Convert 12h parts → 24h "HH:mm". */
function to24h(hour: string, minute: string, ampm: string): string {
  const h12 = Number(hour);
  const h24 = ampm === "AM" ? (h12 === 12 ? 0 : h12) : h12 === 12 ? 12 : h12 + 12;
  return `${String(h24).padStart(2, "0")}:${minute}`;
}

/**
 * TimeWheelPicker — three WheelColumns (hour 1-12, minute 0-59, AM/PM)
 * styled as a single recessed dial, like the iOS Clock "Add Alarm" picker.
 * Stores/exposes 24h "HH:mm" so it stays backend-compatible.
 */
export function TimeWheelPicker({
  value,
  onChange,
  itemHeight = 40,
  visibleItems = 5,
  className,
}: TimeWheelPickerProps) {
  const { hour, minute, ampm } = toParts(value);
  const hours = useMemo(() => HOURS_12, []);
  const minutes = useMemo(() => MINUTES, []);
  const meridiem = useMemo(() => MERIDIEM, []);

  return (
    <div className={cn("relative", className)}>
      {/* centre selection band — spans all three wheels */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-2 z-0 rounded-lg border-y border-white/10 bg-white/[0.06]"
        style={{
          top: `calc(50% - ${itemHeight / 2}px)`,
          height: itemHeight,
        }}
      />
      <div className="relative z-10 flex items-stretch">
        <WheelColumn
          ariaLabel="Hour"
          values={hours}
          value={hour}
          itemHeight={itemHeight}
          visibleItems={visibleItems}
          onChange={(h) => onChange(to24h(h, minute, ampm))}
          className="flex-1"
        />
        <WheelColumn
          ariaLabel="Minute"
          values={minutes}
          value={minute}
          itemHeight={itemHeight}
          visibleItems={visibleItems}
          onChange={(mn) => onChange(to24h(hour, mn, ampm))}
          className="flex-1"
        />
        <WheelColumn
          ariaLabel="AM or PM"
          values={meridiem}
          value={ampm}
          itemHeight={itemHeight}
          visibleItems={visibleItems}
          onChange={(ap) => onChange(to24h(hour, minute, ap))}
          className="w-16"
        />
      </div>
    </div>
  );
}
