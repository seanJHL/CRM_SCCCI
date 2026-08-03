/**
 * Web Push client — VAPID subscription lifecycle for the Ember PWA.
 *
 * Flow:
 *   1. Ensure the service worker (/sw.js) is registered.
 *   2. Fetch the server's VAPID public key.
 *   3. Subscribe via PushManager and POST the subscription to the API.
 */

import { getApiUrl } from "@/lib/api-url";

export type PushPermission = NotificationPermission | "unsupported";

const SERVER_SUBSCRIPTION_KEY = "ember:push:endpoint";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getPushPermission(): PushPermission {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

export function isServiceWorkerSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

/** Register the Ember service worker independently of notification support. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) return null;
  if (import.meta.env.DEV) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    void registration.update().catch((error: unknown) => {
      console.warn("[pwa] Service worker update check failed", error);
    });
    return registration;
  } catch (err) {
    console.error("[pwa] Service worker registration failed", err);
    return null;
  }
}

/** Backward-compatible alias used by existing callers. */
export const getServiceWorkerRegistration = registerServiceWorker;

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

async function pushApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(getApiUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });

  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // Keep the error below useful when a proxy returns HTML or an empty body.
  }

  if (!response.ok || !body?.success || body.data === undefined) {
    throw new Error(
      body?.error?.message ?? `Push API request failed (${response.status})`,
    );
  }

  return body.data;
}

async function getVapidPublicKey(): Promise<string> {
  const data = await pushApi<{ publicKey: string }>(
    "/api/push/vapid-public-key",
  );
  return data.publicKey;
}

export interface SubscribeResult {
  ok: boolean;
  reason?: "unsupported" | "denied" | "no-vapid-key" | "network" | "unknown";
}

function bytesEqual(left: ArrayBuffer | null, right: Uint8Array<ArrayBuffer>) {
  if (!left) return false;
  const current = new Uint8Array(left);
  return (
    current.length === right.length &&
    current.every((value, index) => value === right[index])
  );
}

async function persistSubscription(subscription: PushSubscription) {
  await pushApi<{ id: string }>("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      userAgent: navigator.userAgent,
    }),
  });
  window.localStorage.setItem(SERVER_SUBSCRIPTION_KEY, subscription.endpoint);
}

/** Full opt-in: register SW, request permission, subscribe, persist on server. */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };

  // Keep this as the first awaited browser API: Safari/iOS requires the
  // permission request to remain directly tied to the user's click.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  const registration = await registerServiceWorker();
  if (!registration) return { ok: false, reason: "unknown" };

  try {
    let publicKey: string;
    try {
      publicKey = await getVapidPublicKey();
    } catch (error) {
      console.error("[push] VAPID key request failed", error);
      return { ok: false, reason: "no-vapid-key" };
    }

    const applicationServerKey = urlBase64ToUint8Array(publicKey);
    let subscription = await registration.pushManager.getSubscription();
    if (
      subscription &&
      !bytesEqual(subscription.options.applicationServerKey, applicationServerKey)
    ) {
      await subscription.unsubscribe();
      subscription = null;
      window.localStorage.removeItem(SERVER_SUBSCRIPTION_KEY);
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    await persistSubscription(subscription);
    return { ok: true };
  } catch (err) {
    console.error("[push] subscribe failed", err);
    return { ok: false, reason: "network" };
  }
}

/** Opt-out: remove the browser subscription and tell the server to forget it. */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      try {
        await pushApi<null>("/api/push/unsubscribe", {
          method: "POST",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      } catch (error) {
        // Local opt-out still wins. The server will prune the invalid endpoint
        // on its next 404/410 delivery response.
        console.warn("[push] Server unsubscribe failed", error);
      }
      await subscription.unsubscribe();
    }
    window.localStorage.removeItem(SERVER_SUBSCRIPTION_KEY);
    return true;
  } catch (err) {
    console.error("[push] unsubscribe failed", err);
    return false;
  }
}

/** Whether a subscription currently exists for this browser. */
export async function hasActiveSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return Boolean(
    subscription &&
      window.localStorage.getItem(SERVER_SUBSCRIPTION_KEY) ===
        subscription.endpoint,
  );
}

/** Re-upsert an existing browser subscription without prompting the user. */
export async function syncPushSubscription(): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== "granted") return false;
  const registration = await registerServiceWorker();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) {
    window.localStorage.removeItem(SERVER_SUBSCRIPTION_KEY);
    return false;
  }

  try {
    await persistSubscription(subscription);
    return true;
  } catch (error) {
    console.warn("[push] Subscription sync failed", error);
    return hasActiveSubscription();
  }
}

/** Send a test notification only to this browser's subscription. */
export async function sendTestPush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;

  const data = await pushApi<{ delivered: boolean }>("/api/push/test", {
    method: "POST",
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  return data.delivered;
}
