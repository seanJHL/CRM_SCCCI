import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/sidebar";
import "@/styles/globals.css";

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "Ember" },
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
      { name: "theme-color", content: "#ffffff" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
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

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          {isMobileRoute ? (
            <main className="min-h-screen bg-background">
              <Outlet />
            </main>
          ) : (
            <div className="flex min-h-screen bg-background">
              <Sidebar />
              <main className="flex-1 overflow-auto">
                <div className="w-full">
                  <Outlet />
                </div>
              </main>
            </div>
          )}
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
