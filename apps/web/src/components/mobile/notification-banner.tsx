import { useEffect, useState } from "react";
import { X } from "lucide-react";

export interface NotifyPayload {
  title: string;
  body?: string;
}

/** Fire an in-app toast from anywhere. */
export function notify(payload: NotifyPayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("ember:notify", { detail: payload }));
}

interface Toast extends NotifyPayload {
  id: number;
}

/**
 * NotificationBanner — clean shadcn-style toast notification.
 */
export function NotificationBanner() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<NotifyPayload>).detail;
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev.slice(-2), { ...detail, id }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4200);
    };
    window.addEventListener("ember:notify", handler);
    return () => window.removeEventListener("ember:notify", handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4"
      style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 10px)" }}
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
          aria-label={`Dismiss notification: ${toast.title}`}
          className="m-press pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border border-[var(--m-border)] bg-white px-4 py-3 text-left shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
          style={{ animation: "m-slide-up 0.3s var(--m-ease) both" }}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-[var(--m-text)]">{toast.title}</span>
            {toast.body && <span className="block text-[12px] leading-snug text-[var(--m-text-2)]">{toast.body}</span>}
          </span>
          <X width={14} height={14} className="mt-0.5 shrink-0 text-[var(--m-text-3)]" />
        </button>
      ))}
    </div>
  );
}
