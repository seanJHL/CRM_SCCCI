import {
  createFileRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import "@/styles/mobile.css";
import { BottomNav } from "@/components/mobile/bottom-nav";
import {
  QuickActionSheet,
  type QuickCaptureRequest,
} from "@/components/mobile/quick-action-sheet";
import { NotificationBanner } from "@/components/mobile/notification-banner";
import { registerServiceWorker, syncPushSubscription } from "@/lib/push";

export const Route = createFileRoute("/m")({
  component: MobileShell,
});

/**
 * MobileShell — wraps every /m/* screen with the shadcn monochrome theme,
 * bottom tab strip and the in-app notification layer.
 */
function MobileShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isLiveWorkout = /^\/m\/workouts\/[^/]+$/.test(pathname);
  const isCrm = pathname === "/m/crm";
  const [sheetOpen, setSheetOpen] = useState(false);
  const [captureRequest, setCaptureRequest] =
    useState<QuickCaptureRequest>();

  useEffect(() => {
    void registerServiceWorker();
    void syncPushSubscription();
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

  return (
    <div className="m-app flex min-h-dvh flex-col">
      <NotificationBanner />

      <main
        className={`m-page-shell mx-auto w-full max-w-lg flex-1${isLiveWorkout ? " is-live-workout" : ""}${isCrm ? " is-crm" : ""}`}
      >
        <Outlet />
      </main>

      {!isLiveWorkout && <BottomNav />}
      <QuickActionSheet
        open={sheetOpen}
        request={captureRequest}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
