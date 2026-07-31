import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";

interface StreakFlameProps {
  streak: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: { icon: 14, text: "text-[11px]" },
  md: { icon: 16, text: "text-[13px]" },
  lg: { icon: 22, text: "text-lg" },
} as const;

/**
 * Streak flame — monochrome flame icon with streak count.
 */
export function StreakFlame({ streak, size = "md", className }: StreakFlameProps) {
  const s = SIZES[size];
  const active = streak > 0;

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title={`${streak} day streak`}
    >
      <Flame
        width={s.icon}
        height={s.icon}
        strokeWidth={2}
        className={cn(
          active ? "text-[var(--m-text)]" : "text-[var(--m-text-3)]",
        )}
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.15 : 0}
      />
      <span
        className={cn(
          "font-semibold tabular-nums",
          s.text,
          active ? "text-[var(--m-text)]" : "text-[var(--m-text-3)]",
        )}
      >
        {streak}
      </span>
    </span>
  );
}
