/* global self, caches, fetch, URL, Response */
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

const CACHE_VERSION = "ember-v2";
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
      .then((cache) => cache.addAll(APP_SHELL))
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

  // API calls: network-first, fall back to last-good cached response.
  if (url.pathname.startsWith("/api/")) {
    if (request.method !== "GET") return; // never cache mutations
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Navigations: network-first with offline app-shell fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put("/m", copy));
          return response;
        })
        .catch(() => caches.match("/m")),
    );
    return;
  }

  // Static assets (same-origin): stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      caches.open(cacheName).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || Response.json({ success: false, error: { code: "OFFLINE", message: "You are offline." } }, { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
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
    icon: "/icons/ember-192.png",
    badge: "/icons/ember-192.png",
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
  const targetUrl = (event.notification.data && event.notification.data.url) || "/m";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus an existing window if one matches, navigating it if needed.
      for (const client of clientList) {
        if ("focus" in client) {
          if (new URL(client.url).pathname === targetUrl) return client.focus();
        }
      }
      if (clientList.length > 0 && "navigate" in clientList[0]) {
        return clientList[0].navigate(targetUrl).then((client) => client && client.focus());
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
