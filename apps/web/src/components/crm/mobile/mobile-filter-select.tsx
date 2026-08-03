export const CATEGORIES = ["general", "urgent", "scheduling", "billing", "support", "newsletter"] as const;
export const PRIORITIES = ["critical", "high", "normal", "low"] as const;
export const STATUSES = ["unread", "read", "replied", "scheduled", "archived", "dismissed"] as const;

export function MobileFilterSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="m-field w-full appearance-none pr-9 capitalize"
        >
          <option value="">All {label.toLowerCase()}s</option>
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
