/* global self, caches, fetch, URL, Response, Request */
/**
 * Ember Service Worker
 *
 * Responsibilities:
 *  - Web Push: receive `push` events and surface system notifications.
 *  - Notification click: focus or open the PWA to the relevant route.
 *  - Offline: cache-first for static assets, network-first for API + navigation.
 *
 * This file is served statically from /sw.js and registered by the mobile app.
 */

const CACHE_VERSION = "ember-v4";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

/** Core app-shell assets cached on install for instant offline launch. */
const APP_SHELL = ["/m", "/manifest.webmanifest", "/icons/ember-192.png", "/icons/ember-512.png"];

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        Promise.allSettled(
          APP_SHELL.map((url) =>
            cache.add(new Request(url, { cache: "reload" })),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ember-") && key !== STATIC_CACHE && key !== API_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ---------------------------------------------------------------------------
// Fetch — routing strategy
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle http(s)
  if (!url.protocol.startsWith("http")) return;

  // Never intercept local development. Vite module URLs are intentionally
  // stable and must always come from the live development server.
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return;

  // API calls: network-first, fall back to last-good cached response.
  if (url.pathname.startsWith("/api/")) {
    if (request.method !== "GET") return; // never cache mutations
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Navigations: network-first with offline app-shell fallback.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Static assets (same-origin): cache-first. Vite fingerprints application
  // assets, while a service-worker version bump refreshes stable files.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  }
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && contentType.includes("text/html")) {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.all([
        cache.put(request, response.clone()),
        cache.put("/m", response.clone()),
      ]);
    }
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match("/m")) || Response.error();
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      const cache = await caches.open(cacheName);
      await cache.put(request, copy);
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || Response.json({ success: false, error: { code: "OFFLINE", message: "You are offline." } }, { status: 503 });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let payload = { title: "Ember", body: "You have a new notification.", url: "/m" };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon || "/icons/ember-192.png",
    badge: payload.badge || "/icons/ember-192.png",
    tag: payload.tag || "ember-notification",
    renotify: Boolean(payload.tag),
    data: { url: payload.url || "/m" },
    vibrate: [60, 40, 60],
    actions: payload.actions || [],
    requireInteraction: Boolean(payload.requireInteraction),
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = (event.notification.data && event.notification.data.url) || "/m";
  const parsedUrl = new URL(requestedUrl, self.location.origin);
  const targetUrl =
    parsedUrl.origin === self.location.origin
      ? `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
      : "/m";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus an existing window if one matches, navigating it if needed.
      for (const client of clientList) {
        if ("focus" in client) {
          const clientUrl = new URL(client.url);
          if (`${clientUrl.pathname}${clientUrl.search}${clientUrl.hash}` === targetUrl) {
            return client.focus();
          }
        }
      }
      if (clientList.length > 0 && "navigate" in clientList[0]) {
        return clientList[0].navigate(targetUrl).then((client) => client && client.focus());
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
