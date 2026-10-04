import { describe, expect, it } from "vitest";
import { PUSH_DENIED, PUSH_INSTALL_FIRST, pushSupportState, urlBase64ToUint8Array } from "./push";

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
