import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Monitor, Send, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  subscribeToPush,
  unsubscribeFromPush,
  getPushPermission,
  hasActiveSubscription,
  isPushSupported,
  type PushPermission,
} from "@/lib/push";
import { InstallPrompt } from "@/components/mobile/install-prompt";
import { notify } from "@/components/mobile/notification-banner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/m/settings")({
  component: MobileSettings,
});

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

function MobileSettings() {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const refresh = useCallback(async () => {
    setPermission(getPushPermission());
    setSubscribed(await hasActiveSubscription());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const togglePush = async () => {
    setBusy(true);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        notify({ title: "Push off", body: "You won't get alerts until you re-enable." });
      } else {
        const result = await subscribeToPush();
        if (result.ok) {
          notify({ title: "Push enabled", body: "Reminders and event alerts are on." });
        } else if (result.reason === "denied") {
          notify({ title: "Permission blocked", body: "Allow notifications in your browser settings." });
        } else {
          notify({ title: "Couldn't enable push", body: "Check your connection and try again." });
        }
      }
      await refresh();
    } catch {
      notify({
        title: "Something went wrong",
        body: "Push settings could not be updated. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setTestState("sending");
    try {
      const res = await fetch(`${API_URL}/api/push/test`, { method: "POST" });
      const body = (await res.json()) as { success: boolean };
      setTestState(body.success ? "sent" : "error");
    } catch {
      setTestState("error");
    }
    window.setTimeout(() => setTestState("idle"), 2500);
  };

  const supported = isPushSupported();

  return (
    <div className="flex flex-col gap-5">
      <header className="m-anim-slide-up">
        <p className="m-eyebrow">Your device</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-[var(--m-text)]">
          Settings
        </h1>
        <p className="mt-1.5 text-[13px] text-[var(--m-text-2)]">
          Keep your remote ready wherever the day takes you.
        </p>
      </header>

      <section className="m-anim-slide-up" style={{ animationDelay: "40ms" }}>
        <h2 className="m-eyebrow mb-2">Notifications</h2>
        <div className="m-card divide-y divide-[var(--m-border)] overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-4">
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--m-surface-2)]",
                subscribed ? "text-[var(--m-text)]" : "text-[var(--m-text-3)]",
              )}
            >
              {subscribed ? <Bell width={16} height={16} /> : <BellOff width={16} height={16} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-[var(--m-text)]">Push notifications</p>
              <p className="mt-0.5 text-[11px] leading-snug text-[var(--m-text-3)]">
                {!supported
                  ? "Not supported in this browser."
                  : permission === "denied"
                    ? "Blocked — enable in browser settings."
                    : subscribed
                      ? "Alerts will arrive even when the app is closed."
                      : "Get reminders & event alerts on this device."}
              </p>
            </div>
            <button
              type="button"
              onClick={togglePush}
              disabled={busy || !supported || permission === "denied"}
              className={cn(
                "m-press min-h-11 shrink-0 rounded-xl px-3.5 text-[12px] font-semibold transition-all disabled:opacity-40",
                subscribed
                  ? "border border-[var(--m-border)] bg-[var(--m-surface-2)] text-[var(--m-text-2)]"
                  : "bg-[var(--m-primary)] text-[var(--m-primary-fg)]",
              )}
            >
              {busy ? "…" : subscribed ? "On" : "Enable"}
            </button>
          </div>

          <div className="flex items-center gap-3 px-4 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--m-surface-2)] text-[var(--m-text-2)]">
              <Send width={15} height={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-[var(--m-text)]">Send test alert</p>
              <p className="mt-0.5 text-[11px] text-[var(--m-text-3)]">Verify push is reaching this device.</p>
            </div>
            <button
              type="button"
              onClick={sendTest}
              disabled={!subscribed || testState === "sending"}
              className="m-press min-h-11 shrink-0 rounded-xl border border-[var(--m-border)] bg-[var(--m-surface-2)] px-3.5 text-[12px] font-semibold text-[var(--m-text)] disabled:opacity-40"
            >
              {testState === "sending" ? "Sending…" : testState === "sent" ? "Sent ✓" : testState === "error" ? "Failed" : "Test"}
            </button>
          </div>
        </div>

        {permission === "denied" && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--m-ember-red)]">
            <AlertTriangle width={13} height={13} className="mt-0.5 shrink-0" />
            Notification permission is blocked. Open your browser's site settings to allow it, then return here.
          </p>
        )}
      </section>

      <section className="m-anim-slide-up" style={{ animationDelay: "80ms" }}>
        <h2 className="m-eyebrow mb-2">App</h2>
        <InstallPrompt />
        <div className="m-card mt-2.5 flex items-center gap-3 px-4 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--m-surface-2)] text-[var(--m-text-2)]">
            <CheckCircle2 width={16} height={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--m-text)]">Offline ready</p>
            <p className="mt-0.5 text-[11px] text-[var(--m-text-3)]">Your day stays cached when you lose signal.</p>
          </div>
        </div>
      </section>

      <section className="m-anim-slide-up" style={{ animationDelay: "120ms" }}>
        <a
          href="/"
          className="m-card m-press flex min-h-[72px] items-center gap-3 px-4 py-3.5"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--m-surface-2)] text-[var(--m-text-2)]">
            <Monitor width={16} height={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--m-text)]">Open full desktop app</p>
            <p className="mt-0.5 text-[11px] text-[var(--m-text-3)]">Workouts, planner & analytics on the big screen.</p>
          </div>
          <span className="text-lg text-[var(--m-text-3)]" aria-hidden="true">→</span>
        </a>
      </section>

      <p className="pb-2 text-center text-[10px] text-[var(--m-text-3)]">Ember · your day, in the palm of your hand</p>
    </div>
  );
}
