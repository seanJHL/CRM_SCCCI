import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import "@/styles/mobile.css";
import { BottomNav } from "@/components/mobile/bottom-nav";
import {
  QuickActionSheet,
  type QuickCaptureRequest,
} from "@/components/mobile/quick-action-sheet";
import { NotificationBanner } from "@/components/mobile/notification-banner";
import { getServiceWorkerRegistration } from "@/lib/push";

export const Route = createFileRoute("/m")({
  component: MobileShell,
});

/**
 * MobileShell — wraps every /m/* screen with the shadcn monochrome theme,
 * bottom tab strip, a floating action button, and the in-app notification layer.
 */
function MobileShell() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [captureRequest, setCaptureRequest] =
    useState<QuickCaptureRequest>();

  useEffect(() => {
    void getServiceWorkerRegistration();
  }, []);

  useEffect(() => {
    const openCapture = (event: Event) => {
      const detail = (event as CustomEvent<QuickCaptureRequest>).detail;
      setCaptureRequest(detail ?? {});
      setSheetOpen(true);
    };
    window.addEventListener("ember:quick-capture", openCapture);
    return () =>
      window.removeEventListener("ember:quick-capture", openCapture);
  }, []);

  const openDefaultCapture = () => {
    setCaptureRequest({});
    setSheetOpen(true);
  };

  return (
    <div className="m-app flex min-h-dvh flex-col">
      <NotificationBanner />

      <main
        className="m-page-shell mx-auto w-full max-w-lg flex-1"
      >
        <Outlet />
      </main>

      <button
        onClick={openDefaultCapture}
        aria-label="Quick add to calendar"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        className={sheetOpen ? "hidden" : "m-fab m-press"}
      >
        <Plus width={23} height={23} strokeWidth={2.5} />
      </button>

      <BottomNav />
      <QuickActionSheet
        open={sheetOpen}
        request={captureRequest}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
