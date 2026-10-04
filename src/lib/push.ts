export const PUSH_INSTALL_FIRST =
  "On iPhone, add Bot My Meals to your Home Screen (Share → Add to Home Screen), open it from there, then turn on notifications.";

export const PUSH_DENIED =
  "Notifications are blocked. Turn them on in iPhone Settings → Notifications → Bot My Meals.";

export type PushSupport =
  | "unsupported"
  | "install-first"
  | "denied"
  | "off"
  | "on";

export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (base64url.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** What the Notifications card should show. iOS Safari tabs must install first. */
export function pushSupportState(input: {
  hasSW: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  standalone: boolean;
  ios: boolean;
  permission: NotificationPermission;
}): PushSupport {
  if (!input.hasSW || !input.hasPushManager || !input.hasNotification) return "unsupported";
  if (input.ios && !input.standalone) return "install-first";
  if (input.permission === "denied") return "denied";
  if (input.permission === "granted") return "on";
  return "off";
}

/**
 * iOS can report Notification.permission as "granted" without showing Allow.
 * The push permission state is what decides whether the card is actually on.
 */
export function pushCardMode(input: {
  base: PushSupport;
  permissionState: "granted" | "denied" | "prompt" | null;
  hasSubscription: boolean;
}): PushSupport {
  if (input.base === "unsupported" || input.base === "install-first") return input.base;
  if (input.permissionState === "denied" || input.base === "denied") return "denied";
  const granted =
    input.permissionState === "granted" || (input.permissionState == null && input.base === "on");
  if (granted && input.hasSubscription) return "on";
  return "off";
}
