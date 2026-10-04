import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUSH_DENIED, PUSH_INSTALL_FIRST, pushCardMode, pushSupportState, urlBase64ToUint8Array } from "./push";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const ready = {
  hasSW: true,
  hasPushManager: true,
  hasNotification: true,
  standalone: true,
  ios: false,
  permission: "default" as NotificationPermission,
};

describe("urlBase64ToUint8Array", () => {
  it("round-trips base64url bytes", () => {
    const bytes = Uint8Array.from([0, 1, 255, 16, 32, 250]);
    expect(urlBase64ToUint8Array(bytesToBase64Url(bytes))).toEqual(bytes);
  });
});

describe("pushSupportState", () => {
  it("covers each branch", () => {
    expect(pushSupportState({ ...ready, hasPushManager: false })).toBe("unsupported");
    expect(pushSupportState({ ...ready, ios: true, standalone: false, permission: "default" })).toBe(
      "install-first",
    );
    expect(pushSupportState({ ...ready, standalone: true, permission: "default" })).toBe("off");
    expect(pushSupportState({ ...ready, permission: "denied" })).toBe("denied");
    expect(pushSupportState({ ...ready, permission: "granted" })).toBe("on");
  });

  it("keeps the install and denied copy", () => {
    expect(PUSH_INSTALL_FIRST).toMatch(/Add to Home Screen/);
    expect(PUSH_DENIED).toMatch(/Settings → Notifications → Bot My Meals/);
  });
});

describe("pushCardMode", () => {
  it("stays off when iOS says granted before Allow was shown", () => {
    expect(pushCardMode({ base: "on", permissionState: "prompt", hasSubscription: true })).toBe("off");
    expect(pushCardMode({ base: "on", permissionState: "granted", hasSubscription: true })).toBe("on");
    expect(pushCardMode({ base: "on", permissionState: "granted", hasSubscription: false })).toBe("off");
    expect(pushCardMode({ base: "off", permissionState: null, hasSubscription: false })).toBe("off");
    expect(pushCardMode({ base: "install-first", permissionState: "granted", hasSubscription: true })).toBe(
      "install-first",
    );
  });

  it("starts the iOS prompt from subscribe in the tap", () => {
    const source = readFileSync(path.join(import.meta.dirname, "../components/push-opt-in.tsx"), "utf8");
    expect(source).toContain("pushManager\n      .subscribe({");
    expect(source).toContain("subscribe() is the call that shows the iOS Allow prompt");
    expect(source).not.toContain("requestPermission");
  });
});
