import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface TogglePillProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}

/**
 * Toggle pill — shadcn-style switch. Black when on, gray when off.
 */
export function TogglePill({ checked, onChange, disabled, label }: TogglePillProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? (checked ? "Mark as not done" : "Mark as done")}
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => onChange(!checked)}
      className={cn(
        "m-press relative h-11 w-[60px] shrink-0 rounded-full border transition-all duration-200",
        checked
          ? "border-transparent bg-[var(--m-primary)]"
          : "border-[var(--m-border)] bg-[var(--m-surface-3)]",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm transition-all duration-200",
          checked ? "left-[21px]" : "left-[3px]",
        )}
      >
        <Check width={13} height={13} strokeWidth={3} className={cn("transition-opacity", checked ? "opacity-100 text-[var(--m-primary)]" : "opacity-0")} />
      </span>
    </button>
  );
}
