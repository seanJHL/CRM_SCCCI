import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, ChevronDown } from "lucide-react";

export const CATEGORIES = ["general", "urgent", "scheduling", "billing", "support", "newsletter"] as const;
export const PRIORITIES = ["critical", "high", "normal", "low"] as const;
export const STATUSES = ["unread", "read", "replied", "scheduled", "archived", "dismissed"] as const;

function pluralizeAllLabel(label: string) {
  const lower = label.toLowerCase();
  if (lower.endsWith("y")) return `All ${lower.slice(0, -1)}ies`;
  if (lower.endsWith("s")) return `All ${lower}es`;
  return `All ${lower}s`;
}

interface MobileFilterSelectProps {
  label: string;
  value: string;
  values: readonly string[];
  onChange: (value: string) => void;
  hideAllOption?: boolean;
  /** Render as a compact trigger that opens a bottom-sheet panel of options, instead of a native `<select>`. */
  asPanel?: boolean;
  /** Panel mode only: hide the caption and size the trigger to its content, for inline placement next to an external label. */
  compact?: boolean;
}

export function MobileFilterSelect({ label, value, values, onChange, hideAllOption, asPanel, compact }: MobileFilterSelectProps) {
  if (asPanel) {
    return (
      <MobileSheetSelect label={label} value={value} values={values} onChange={onChange} hideAllOption={hideAllOption} compact={compact} />
    );
  }
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="m-field w-full appearance-none pr-9 capitalize"
        >
          {!hideAllOption && <option value="">{pluralizeAllLabel(label)}</option>}
          {values.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

function MobileSheetSelect({
  label,
  value,
  values,
  onChange,
  hideAllOption,
  compact,
}: {
  label: string;
  value: string;
  values: readonly string[];
  onChange: (value: string) => void;
  hideAllOption?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = hideAllOption ? values : ["", ...values];
  const allLabel = pluralizeAllLabel(label);
  const currentLabel = value || allLabel;

  return (
    <div className={compact ? "inline-block" : "block"}>
      {!compact && <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">{label}</span>}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`m-press flex h-11 items-center gap-2 rounded-[12px] border border-[var(--m-border)] bg-[var(--m-surface-2)] px-3.5 text-[13px] font-medium capitalize text-[var(--m-text)] ${
          compact ? "w-auto justify-center" : "w-full justify-between"
        }`}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown width={15} height={15} className="shrink-0 text-[var(--m-text-3)]" />
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="m-controller-surface fixed bottom-0 left-1/2 z-[81] w-full max-w-lg -translate-x-1/2 rounded-t-[26px] border border-b-0 border-[var(--m-border)] bg-[#20282d] p-4 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <DialogPrimitive.Title className="px-1 text-[18px] font-semibold tracking-tight text-[var(--m-text)]">
              {label}
            </DialogPrimitive.Title>
            <div className="mt-3 space-y-1 pb-1">
              {options.map((item) => {
                const itemLabel = item === "" ? allLabel : item;
                const selected = item === value;
                return (
                  <button
                    key={item || "__all"}
                    type="button"
                    onClick={() => {
                      onChange(item);
                      setOpen(false);
                    }}
                    className={`m-press flex w-full items-center justify-between rounded-[12px] px-3.5 py-3 text-left text-[14px] capitalize ${
                      selected ? "bg-[var(--m-primary)]/15 font-semibold text-[var(--m-primary)]" : "text-[var(--m-text)]"
                    }`}
                  >
                    {itemLabel}
                    {selected && <Check width={16} height={16} />}
                  </button>
                );
              })}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}
