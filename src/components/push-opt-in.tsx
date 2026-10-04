"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HouseCard } from "@/components/house-card";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { supabaseDeletePushSubscription, supabaseSetPushPrefs, supabaseUpsertPushSubscription } from "@/lib/supabase/repo";
import { isIosDevice, isStandaloneDisplay } from "@/lib/install";
import { PUSH_DENIED, PUSH_INSTALL_FIRST, pushSupportState, urlBase64ToUint8Array } from "@/lib/push";

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
  const [publicKey, setPublicKey] = useState<string | null | undefined>(undefined);
  const [configError, setConfigError] = useState(false);
  const [permissionOverride, setPermissionOverride] = useState<NotificationPermission | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [menuReady, setMenuReady] = useState(true);
  const [weekLocked, setWeekLocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
        setConfigError(false);
        setPublicKey(typeof body.publicKey === "string" && body.publicKey ? body.publicKey : null);
      })
      .catch(() => {
        if (!cancelled) setConfigError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (configError) {
    return (
      <HouseCard className="mt-6" data-slot="push-opt-in">
        <h2 className="type-section text-primary">Notifications</h2>
        <p className="type-body mt-2">Notifications didn’t load. Close the app and open it from the Home Screen icon.</p>
      </HouseCard>
    );
  }

  if (!publicKey) return null;

  const livePermission: NotificationPermission =
    typeof Notification === "undefined" ? "default" : Notification.permission;
  const permission = permissionOverride ?? livePermission;

  const support = pushSupportState({
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
    ios: typeof navigator !== "undefined" && isIosDevice(navigator.userAgent),
    permission,
  });

  const turnOn = () => {
    const asked = Notification.requestPermission();
    setBusy(true);
    setMessage(null);
    void asked
      .then(async (next) => {
        setPermissionOverride(next);
        if (next !== "granted") return;
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          }));
        const client = createSupabaseBrowserClient();
        if (!client) throw new Error("Not signed in");
        const json = subscription.toJSON() as PushJson;
        await supabaseUpsertPushSubscription(client, json, navigator.userAgent);
        setEndpoint(subscription.endpoint);
      })
      .catch((err: unknown) => {
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
        <Button type="button" size="fat" variant="primary" className="mt-3 w-full" disabled={busy} onClick={turnOn}>
          {busy ? "Turning on…" : "Turn on notifications"}
        </Button>
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
                  const body = (await response.json()) as { error?: string };
                  setMessage(response.ok ? "Test sent." : body.error ?? "Could not send a test.");
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
