/**
 * Web Push client — VAPID subscription lifecycle for the Ember PWA.
 *
 * Flow:
 *   1. Ensure the service worker (/sw.js) is registered.
 *   2. Fetch the server's VAPID public key.
 *   3. Subscribe via PushManager and POST the subscription to the API.
 */

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export type PushPermission = NotificationPermission | "unsupported";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function getPushPermission(): PushPermission {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/** Register (or return) the Ember service worker. */
export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    console.error("[push] SW registration failed", err);
    return null;
  }
}

async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/api/push/vapid-public-key`);
    const body = (await res.json()) as { success: boolean; data?: { publicKey: string } };
    return body.success && body.data ? body.data.publicKey : null;
  } catch {
    return null;
  }
}

export interface SubscribeResult {
  ok: boolean;
  reason?: "unsupported" | "denied" | "no-vapid-key" | "network" | "unknown";
}

/** Full opt-in: register SW, request permission, subscribe, persist on server. */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };

  const registration = await getServiceWorkerRegistration();
  if (!registration) return { ok: false, reason: "unknown" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  const publicKey = await getVapidPublicKey();
  if (!publicKey) return { ok: false, reason: "no-vapid-key" };

  try {
    // Reuse an existing subscription if one is already active.
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const res = await fetch(`${API_URL}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        userAgent: navigator.userAgent,
      }),
    });
    const body = (await res.json()) as { success: boolean };
    return body.success ? { ok: true } : { ok: false, reason: "network" };
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
      await fetch(`${API_URL}/api/push/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
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
  return Boolean(subscription);
}
