import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * InstallPrompt — clean monochrome "Add to Home Screen" card.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent));

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || dismissed) return null;
  if (!deferred && !isIOS) return null;

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setDeferred(null);
  };

  return (
    <div className="m-card m-anim-slide-up relative p-4">
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="m-press absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-[var(--m-text-3)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text-2)]"
        aria-label="Dismiss install prompt"
      >
        <X width={14} height={14} />
      </button>

      <div className="flex items-start gap-3">
        <img src="/icons/ember-192.png" alt="" className="h-10 w-10 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-[var(--m-text)]">Install Ember</p>
          {isIOS ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] leading-snug text-[var(--m-text-2)]">
              Tap <Share width={12} height={12} className="inline" /> then
              <span className="font-medium text-[var(--m-text)]">"Add to Home Screen"</span> for the full app.
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] leading-snug text-[var(--m-text-2)]">
              Full-screen, offline-ready, with push reminders.
            </p>
          )}
          {!isIOS && (
            <button
              type="button"
              onClick={install}
              className="m-press mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--m-primary)] px-4 text-[12px] font-semibold text-[var(--m-primary-fg)]"
            >
              <Download width={12} height={12} strokeWidth={2.5} />
              Install app
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
