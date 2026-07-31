import { AlertCircle, RotateCw } from "lucide-react";

interface MobileErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function MobileErrorState({
  title = "Couldn’t load this",
  message = "Check your connection and try again.",
  onRetry,
}: MobileErrorStateProps) {
  return (
    <div
      className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 p-3.5 text-red-900"
      role="alert"
    >
      <AlertCircle
        width={18}
        height={18}
        className="mt-0.5 shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-red-700">
          {message}
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="m-press flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-[12px] font-semibold text-red-800 shadow-sm"
        >
          <RotateCw width={13} height={13} aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}
