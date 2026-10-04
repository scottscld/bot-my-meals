"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HouseCard } from "@/components/house-card";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { supabaseDeletePushSubscription, supabaseSetPushPrefs, supabaseUpsertPushSubscription } from "@/lib/supabase/repo";
import { isIosDevice, isStandaloneDisplay } from "@/lib/install";
import { PUSH_DENIED, PUSH_INSTALL_FIRST, pushCardMode, pushSupportState, urlBase64ToUint8Array } from "@/lib/push";

type PushJson = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

export async function syncPushSubscription(client: SupabaseClient) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const registration = registrations[0];
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await supabaseUpsertPushSubscription(client, subscription.toJSON(), navigator.userAgent);
}

export function PushOptIn() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [permissionOverride, setPermissionOverride] = useState<NotificationPermission | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [menuReady, setMenuReady] = useState(true);
  const [weekLocked, setWeekLocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [workerReady, setWorkerReady] = useState(false);
  const [permissionState, setPermissionState] = useState<"granted" | "denied" | "prompt" | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/push/config", {
      method: "POST",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { publicKey?: unknown };
      })
      .then((body) => {
        if (cancelled) return;
        const key = typeof body.publicKey === "string" && body.publicKey ? body.publicKey : "";
        setPublicKey(key || null);
        setPhase(key ? "ready" : "missing");
      })
      .catch(() => {
        if (!cancelled) setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    let cancelled = false;
    void (async () => {
      if (!("serviceWorker" in navigator)) return;
      const registration = await navigator.serviceWorker.ready;
      if (cancelled) return;
      registrationRef.current = registration;
      let state: "granted" | "denied" | "prompt" | null = null;
      try {
        state = await registration.pushManager.permissionState({ userVisibleOnly: true });
      } catch {
        state = null;
      }
      const existing = await registration.pushManager.getSubscription();
      if (cancelled) return;
      // A subscription saved before iOS showed Allow cannot be prompted again until it is cleared.
      if (state === "prompt" && existing) {
        const endpointToDrop = existing.endpoint;
        await existing.unsubscribe();
        const client = createSupabaseBrowserClient();
        if (client) await supabaseDeletePushSubscription(client, endpointToDrop).catch(() => undefined);
        setEndpoint(null);
      } else if (existing) {
        setEndpoint(existing.endpoint);
      }
      if (!cancelled) {
        setPermissionState(state);
        setWorkerReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  if (phase !== "ready" || !publicKey) {
    const detail =
      phase === "error"
        ? "Notifications didn’t load. Pull down to refresh this page."
        : phase === "missing"
          ? "Notifications aren’t available on this copy of the app yet."
          : "Checking this phone…";
    return (
      <HouseCard className="mt-6" data-slot="push-opt-in">
        <h2 className="type-section text-primary">Notifications</h2>
        <p className="type-body mt-2">{detail}</p>
      </HouseCard>
    );
  }

  const livePermission: NotificationPermission =
    typeof Notification === "undefined" ? "default" : Notification.permission;
  const permission = permissionOverride ?? livePermission;

  const ios = typeof navigator !== "undefined" && isIosDevice(navigator.userAgent);
  const support = pushCardMode({
    base: pushSupportState({
      hasSW: typeof navigator !== "undefined" && "serviceWorker" in navigator,
      hasPushManager: typeof window !== "undefined" && "PushManager" in window,
      hasNotification: typeof Notification !== "undefined",
      standalone:
        typeof window !== "undefined" &&
        isStandaloneDisplay(
          (query) => window.matchMedia(query),
          "standalone" in navigator
            ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
            : false,
        ),
      ios,
      permission,
    }),
    permissionState,
    hasSubscription: Boolean(endpoint),
  });

  const turnOn = () => {
    const registration = registrationRef.current;
    if (!registration) {
      setMessage("Still checking this phone. Tap again.");
      return;
    }
    setBusy(true);
    setMessage(null);
    // subscribe() is the call that shows the iOS Allow prompt, and it has to start in this tap.
    void registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      .then(async (subscription) => {
        setPermissionOverride("granted");
        setPermissionState("granted");
        const client = createSupabaseBrowserClient();
        if (!client) throw new Error("Not signed in");
        const json = subscription.toJSON() as PushJson;
        await supabaseUpsertPushSubscription(client, json, navigator.userAgent);
        setEndpoint(subscription.endpoint);
      })
      .catch((err: unknown) => {
        if (typeof Notification !== "undefined" && Notification.permission === "denied") {
          setPermissionOverride("denied");
          setPermissionState("denied");
        }
        setMessage(err instanceof Error ? err.message : "Could not turn on notifications.");
      })
      .finally(() => setBusy(false));
  };

  const savePrefs = (nextMenu: boolean, nextLocked: boolean) => {
    setMenuReady(nextMenu);
    setWeekLocked(nextLocked);
    if (!endpoint) return;
    const client = createSupabaseBrowserClient();
    if (!client) return;
    void supabaseSetPushPrefs(client, endpoint, nextMenu, nextLocked).catch((err: unknown) => {
      setMessage(err instanceof Error ? err.message : "Could not save those switches.");
    });
  };

  return (
    <HouseCard className="mt-6" data-slot="push-opt-in">
      <h2 className="type-section text-primary">Notifications</h2>
      {support === "install-first" ? <p className="type-body mt-2">{PUSH_INSTALL_FIRST}</p> : null}
      {support === "denied" ? <p className="type-body mt-2">{PUSH_DENIED}</p> : null}
      {support === "unsupported" ? (
        <p className="type-body mt-2 text-muted-foreground">This browser can’t show notifications.</p>
      ) : null}
      {support === "off" ? (
        <>
          <Button
            type="button"
            size="fat"
            variant="primary"
            className="mt-3 w-full"
            disabled={busy || !workerReady}
            onClick={turnOn}
          >
            {busy ? "Turning on…" : workerReady ? "Turn on notifications" : "Checking this phone…"}
          </Button>
          {ios ? (
            <p className="type-meta mt-2 text-muted-foreground">
              Allow the iPhone prompt that appears after this tap.
            </p>
          ) : null}
        </>
      ) : null}
      {support === "on" ? (
        <div className="mt-3 space-y-3">
          <label className="flex min-h-12 items-center justify-between gap-3">
            <span className="type-body">New menu to vote on</span>
            <input
              type="checkbox"
              checked={menuReady}
              onChange={(event) => savePrefs(event.target.checked, weekLocked)}
            />
          </label>
          <label className="flex min-h-12 items-center justify-between gap-3">
            <span className="type-body">Menu locked</span>
            <input
              type="checkbox"
              checked={weekLocked}
              onChange={(event) => savePrefs(menuReady, event.target.checked)}
            />
          </label>
          <Button
            type="button"
            size="fat"
            variant="outline"
            className="w-full"
            onClick={() => {
              setMessage(null);
              void fetch("/api/push/test", { method: "POST" })
                .then(async (response) => {
                  const body = (await response.json()) as { error?: string; sent?: number };
                  if (response.ok && (body.sent ?? 0) > 0) {
                    setMessage("Test sent. It can take a few seconds to arrive.");
                    return;
                  }
                  setMessage(body.error ?? "Could not send a test.");
                })
                .catch(() => setMessage("Could not send a test."));
            }}
          >
            Send a test
          </Button>
          <Button
            type="button"
            size="fat"
            variant="outline"
            className="w-full"
            onClick={() => {
              void (async () => {
                const registrations = await navigator.serviceWorker.getRegistrations();
                const subscription = await registrations[0]?.pushManager.getSubscription();
                const current = subscription?.endpoint ?? endpoint;
                await subscription?.unsubscribe();
                const client = createSupabaseBrowserClient();
                if (client && current) await supabaseDeletePushSubscription(client, current);
                setEndpoint(null);
                setPermissionOverride("default");
              })();
            }}
          >
            Turn off
          </Button>
        </div>
      ) : null}
      {message ? <p className="type-meta mt-2 text-muted-foreground">{message}</p> : null}
    </HouseCard>
  );
}
