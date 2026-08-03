import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface WheelColumnProps {
  /** Display values to render in the wheel (one per row). */
  values: string[];
  /** Currently selected value. Must exist in `values`. */
  value: string;
  /** Fired with the newly centered value as the user scrolls. */
  onChange: (value: string) => void;
  /** Height of each row in px. */
  itemHeight?: number;
  /** Number of rows visible at once (should be odd so one centers). */
  visibleItems?: number;
  /** Accessible label for the listbox. */
  ariaLabel?: string;
  /** Optional formatter for the visible label of each value. */
  formatItem?: (value: string) => string;
  className?: string;
}

/**
 * WheelColumn — an iOS-style scroll-snap "dial" column.
 *
 * Renders a vertically scrollable list where the item snapped to the
 * centre is the selected value. Pointer + keyboard driven. A vertical
 * mask gradient fades the top/bottom rows so it reads as a cylinder.
 */
export function WheelColumn({
  values,
  value,
  onChange,
  itemHeight = 40,
  visibleItems = 5,
  ariaLabel,
  formatItem,
  className,
}: WheelColumnProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  // Tracks the index the wheel is currently settled on so programmatic
  // scrolls (external value changes) don't fight an in-flight user scroll.
  const lastIndexRef = useRef(-1);

  const safeIndex =
    values.length > 0 ? Math.max(0, values.indexOf(value)) : 0;
  const padding = Math.floor(visibleItems / 2);

  // Sync scroll position when the value changes from the outside.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || values.length === 0) return;
    const targetIndex = Math.max(0, values.indexOf(value));
    if (targetIndex === lastIndexRef.current) return;
    lastIndexRef.current = targetIndex;
    el.scrollTo({ top: targetIndex * itemHeight, behavior: "auto" });
  }, [value, values, itemHeight]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el || values.length === 0) return;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const raw = Math.round(el.scrollTop / itemHeight);
      const clamped = Math.max(0, Math.min(values.length - 1, raw));
      if (clamped !== lastIndexRef.current) {
        lastIndexRef.current = clamped;
        onChange(values[clamped]);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (values.length === 0) return;
    let next = safeIndex;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      next = Math.min(values.length - 1, safeIndex + 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      next = Math.max(0, safeIndex - 1);
    } else if (e.key === "PageDown") {
      next = Math.min(values.length - 1, safeIndex + 5);
    } else if (e.key === "PageUp") {
      next = Math.max(0, safeIndex - 5);
    } else {
      return;
    }
    e.preventDefault();
    onChange(values[next]);
  }

  const fade =
    "linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)";

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={ariaLabel}
      tabIndex={0}
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      className={cn(
        "m-no-scrollbar snap-y snap-mandatory overflow-y-auto outline-none",
        className,
      )}
      style={{
        height: itemHeight * visibleItems,
        touchAction: "pan-y",
        WebkitOverflowScrolling: "touch",
        maskImage: fade,
        WebkitMaskImage: fade,
      }}
    >
      <div style={{ height: padding * itemHeight }} aria-hidden="true" />
      {values.map((v, i) => (
        <div
          key={`${v}-${i}`}
          role="option"
          aria-selected={i === safeIndex}
          id={`wheel-opt-${ariaLabel}-${i}`}
          className={cn(
            "flex snap-center items-center justify-center tabular-nums transition-[color] duration-150",
            i === safeIndex
              ? "font-semibold text-[var(--m-text)]"
              : "font-medium text-[var(--m-text-3)]",
          )}
          style={{ height: itemHeight }}
        >
          {formatItem ? formatItem(v) : v}
        </div>
      ))}
      <div style={{ height: padding * itemHeight }} aria-hidden="true" />
    </div>
  );
}
