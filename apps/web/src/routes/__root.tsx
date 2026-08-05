import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { BuiltWithBadge } from "@/components/layout/built-with-badge";
import "@/styles/globals.css";

interface RouterContext {
  queryClient: QueryClient;
}

const MOBILE_VIEW_QUERY = "(max-width: 820px)";
const DESKTOP_VIEW_KEY = "ember:desktop-view";
const DEV_SERVICE_WORKER_RESET = `
(() => {
  const hostname = window.location.hostname;
  // Matches localhost, loopback, private LAN ranges (10.x, 172.16-31.x,
  // 192.168.x) and .local mDNS hostnames — the ways a dev server gets
  // opened from a phone for PWA testing, in addition to plain "localhost"
  // on the same machine.
  if (!/^(localhost|127(?:\\.\\d{1,3}){3}|10(?:\\.\\d{1,3}){3}|192\\.168(?:\\.\\d{1,3}){2}|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.\\d{1,3}){2}|[^.]+\\.local)$/i.test(hostname)) return;

  const resetKey = "sccci:dev-service-worker-reset:v1";
  if (window.sessionStorage.getItem(resetKey) === "done") return;

  const registrations = "serviceWorker" in navigator
    ? navigator.serviceWorker.getRegistrations()
    : Promise.resolve([]);
  const cacheNames = "caches" in window ? window.caches.keys() : Promise.resolve([]);

  Promise.all([registrations, cacheNames])
    .then(async ([activeRegistrations, names]) => {
      const emberCaches = names.filter((name) => name.startsWith("ember-"));
      const needsReload = activeRegistrations.length > 0 || emberCaches.length > 0;

      await Promise.all([
        ...activeRegistrations.map((registration) => registration.unregister()),
        ...emberCaches.map((name) => window.caches.delete(name)),
      ]);

      window.sessionStorage.setItem(resetKey, "done");
      if (needsReload) window.location.reload();
    })
    .catch(() => {
      window.sessionStorage.setItem(resetKey, "done");
    });
})();
`;

function getMobileDestination(pathname: string) {
  if (pathname === "/crm" || pathname.startsWith("/crm/")) {
    return "/m/crm";
  }
  if (pathname === "/reminders" || pathname.startsWith("/reminders/")) {
    return "/m/reminders";
  }
  if (pathname === "/planner" || pathname.startsWith("/planner/")) {
    return "/m/calendar";
  }
  if (
    pathname === "/workouts" ||
    pathname.startsWith("/workouts/") ||
    pathname === "/workout" ||
    pathname.startsWith("/workout/")
  ) {
    return "/m/workouts";
  }
  return "/m";
}

/**
 * The browser's mobile layout and the installed PWA deliberately share the
 * exact same /m routes. This keeps the responsive browser preview from
 * drifting away from the experience people install on their home screen.
 */
function MobileViewportRedirect({
  pathname,
  isMobileRoute,
  disabled,
}: {
  pathname: string;
  isMobileRoute: boolean;
  disabled: boolean;
}) {
  useEffect(() => {
    const root = document.documentElement;

    if (disabled) {
      delete root.dataset.emberDesktopView;
      return;
    }

    if (isMobileRoute) {
      try {
        window.sessionStorage.removeItem(DESKTOP_VIEW_KEY);
      } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
      }
      delete root.dataset.emberDesktopView;
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const requestedDesktop = searchParams.get("desktop") === "1";
    let desktopOverride = requestedDesktop;

    try {
      if (requestedDesktop) {
        window.sessionStorage.setItem(DESKTOP_VIEW_KEY, "1");
      } else {
        desktopOverride =
          window.sessionStorage.getItem(DESKTOP_VIEW_KEY) === "1";
      }
    } catch {
      // The query-string override still works when session storage is blocked.
    }

    if (desktopOverride) {
      root.dataset.emberDesktopView = "true";
      return () => {
        delete root.dataset.emberDesktopView;
      };
    }

    delete root.dataset.emberDesktopView;
    const narrowViewport = window.matchMedia(MOBILE_VIEW_QUERY);
    const standaloneDisplay = window.matchMedia("(display-mode: standalone)");
    const iosStandalone =
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true;
    let redirecting = false;

    const openMobileView = () => {
      if (
        redirecting ||
        (!narrowViewport.matches &&
          !standaloneDisplay.matches &&
          !iosStandalone)
      ) {
        return;
      }

      redirecting = true;
      const destination = new URL(
        getMobileDestination(pathname),
        window.location.origin,
      );
      searchParams.delete("desktop");
      searchParams.forEach((value, key) => {
        destination.searchParams.append(key, value);
      });
      destination.hash = window.location.hash;
      window.location.replace(
        `${destination.pathname}${destination.search}${destination.hash}`,
      );
    };

    openMobileView();
    narrowViewport.addEventListener("change", openMobileView);
    standaloneDisplay.addEventListener("change", openMobileView);

    return () => {
      narrowViewport.removeEventListener("change", openMobileView);
      standaloneDisplay.removeEventListener("change", openMobileView);
      delete root.dataset.emberDesktopView;
    };
  }, [disabled, isMobileRoute, pathname]);

  return null;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "SCCCI CRM" },
      {
        name: "description",
        content:
          "A fast mobile remote for adding activities, tasks, events, habits, and reminders to your day.",
      },
      { property: "og:title", content: "Ember — Your day. Under control." },
      {
        property: "og:description",
        content:
          "Capture activities, tasks, and events in seconds from a simple mobile controller.",
      },
      { property: "og:type", content: "website" },
      {
        property: "og:image",
        content: "https://crm.seanleejh.com/og.png",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Ember — Your day. Under control." },
      {
        name: "twitter:description",
        content:
          "Capture activities, tasks, and events in seconds from a simple mobile controller.",
      },
      {
        name: "twitter:image",
        content: "https://crm.seanleejh.com/og.png",
      },
      { name: "theme-color", content: "#1d2429" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Ember" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: "/icons/ember-192.png" },
      { rel: "apple-touch-icon", href: "/icons/ember-192.png" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  // Mobile PWA routes (/m/*) render full-screen without the desktop sidebar.
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isMobileRoute = pathname === "/m" || pathname.startsWith("/m/");
  const isCrmExperience =
    pathname === "/login" ||
    pathname === "/privacy-policy";

  return (
    <html lang="en" className={isMobileRoute ? "ember-mobile-active" : undefined}>
      <head>
        {import.meta.env.DEV && (
          <script dangerouslySetInnerHTML={{ __html: DEV_SERVICE_WORKER_RESET }} />
        )}
        <HeadContent />
      </head>
      <body className={isMobileRoute ? "ember-mobile-active" : undefined}>
        <QueryClientProvider client={queryClient}>
          <MobileViewportRedirect
            pathname={pathname}
            isMobileRoute={isMobileRoute}
            disabled={isCrmExperience}
          />
          {isMobileRoute ? (
            <main className="min-h-screen bg-[#151b1f]">
              <Outlet />
            </main>
          ) : isCrmExperience ? (
            <main className="min-h-screen bg-[#f5f7f6]">
              <Outlet />
            </main>
          ) : (
            <>
              <div className="desktop-app-shell flex min-h-screen bg-background">
                <Sidebar />
                <main className="flex-1 overflow-auto">
                  <div className="w-full">
                    <Outlet />
                  </div>
                </main>
              </div>
              <div className="mobile-route-handoff" role="status">
                <span className="mobile-route-handoff__mark" aria-hidden="true">
                  E
                </span>
                <span>Opening your mobile controls…</span>
                <a href="/m">Open now</a>
              </div>
            </>
          )}
          <BuiltWithBadge />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
