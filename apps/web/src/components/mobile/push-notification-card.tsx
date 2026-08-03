import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, LoaderCircle, Send } from "lucide-react";
import {
  getPushPermission,
  hasActiveSubscription,
  isPushSupported,
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
  type PushPermission,
} from "@/lib/push";
import { notify } from "@/components/mobile/notification-banner";
import { cn } from "@/lib/utils";

type TestState = "idle" | "sending";

/** Device-level push controls shown alongside reminders. */
export function PushNotificationCard() {
  const [permission, setPermission] =
    useState<PushPermission>("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<TestState>("idle");

  const refresh = useCallback(async () => {
    setPermission(getPushPermission());
    setSubscribed(await hasActiveSubscription());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggleNotifications() {
    setBusy(true);
    try {
      if (subscribed) {
        const removed = await unsubscribeFromPush();
        notify({
          title: removed ? "Notifications off" : "Couldn't turn notifications off",
          body: removed ? "This device will no longer receive alerts." : "Please try again.",
        });
      } else {
        const result = await subscribeToPush();
        if (result.ok) {
          notify({
            title: "Notifications enabled",
            body: "Reminders and event alerts can now reach this device.",
          });
        } else if (result.reason === "denied") {
          notify({
            title: "Permission blocked",
            body: "Allow notifications in your browser or device settings.",
          });
        } else if (result.reason === "no-vapid-key") {
          notify({
            title: "Push service unavailable",
            body: "The notification server is not configured yet.",
          });
        } else {
          notify({
            title: "Couldn't enable notifications",
            body: "Check your connection and try again.",
          });
        }
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function testNotification() {
    setTestState("sending");
    try {
      const delivered = await sendTestPush();
      notify({
        title: delivered ? "Test sent" : "Test not delivered",
        body: delivered
          ? "A device notification should arrive now."
          : "Re-enable notifications, then try again.",
      });
    } catch {
      notify({
        title: "Couldn't send test",
        body: "The notification server could not be reached.",
      });
    } finally {
      setTestState("idle");
    }
  }

  const supported = isPushSupported();
  const blocked = permission === "denied";
  const description = !supported
    ? "Install Ember and open it from your home screen to enable alerts on supported devices."
    : blocked
      ? "Notifications are blocked. Allow them in your browser or device settings."
      : subscribed
        ? "Reminders and event alerts can arrive even while Ember is closed."
        : "Enable alerts on this device before relying on a reminder.";

  return (
    <section className="m-card m-anim-slide-up overflow-hidden p-4" aria-labelledby="device-alerts-title">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--m-surface-2)]",
            subscribed ? "text-[var(--m-text)]" : "text-[var(--m-text-3)]",
          )}
          aria-hidden="true"
        >
          {subscribed ? <Bell width={17} height={17} /> : <BellOff width={17} height={17} />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 id="device-alerts-title" className="text-[13px] font-semibold text-[var(--m-text)]">
              Device notifications
            </h2>
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--m-text-3)]">
              {loading ? "Checking" : subscribed ? "On" : blocked ? "Blocked" : "Off"}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--m-text-3)]">
            {description}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void toggleNotifications()}
              disabled={loading || busy || !supported || blocked}
              className={cn(
                "m-press inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[12px] font-semibold disabled:opacity-40",
                subscribed
                  ? "border border-[var(--m-border)] bg-[var(--m-surface-2)] text-[var(--m-text-2)]"
                  : "bg-[var(--m-primary)] text-[var(--m-primary-fg)]",
              )}
            >
              {busy && <LoaderCircle width={14} height={14} className="animate-spin" />}
              {subscribed ? "Turn off" : "Enable alerts"}
            </button>

            {subscribed && (
              <button
                type="button"
                onClick={() => void testNotification()}
                disabled={testState === "sending"}
                className="m-press inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--m-border)] bg-transparent px-4 text-[12px] font-semibold text-[var(--m-text-2)] disabled:opacity-40"
              >
                {testState === "sending" ? (
                  <LoaderCircle width={14} height={14} className="animate-spin" />
                ) : (
                  <Send width={14} height={14} />
                )}
                Send test
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
