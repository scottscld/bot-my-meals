import { describe, expect, it, vi } from "vitest";
import { buildPushPayload, sendPush } from "./push-send";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function testVapid() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    subject: "mailto:test@example.com",
    publicKey,
    privateKey: jwk.d ?? "",
  };
}

async function testSubscription() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint: "https://push.example.test/subscription",
    expirationTime: null,
    keys: { p256dh: toBase64Url(publicKey), auth: toBase64Url(auth) },
  };
}

const message = {
  title: "Bot My Meals",
  body: "This week’s menu is ready.",
  url: "/week",
  tag: "menu_ready:week",
  kind: "menu_ready",
  weekId: "fed4dffc-63f0-4107-925d-592bcacd4860",
};

describe("buildPushPayload", () => {
  it("uses aes128gcm and a vapid token", async () => {
    const payload = await buildPushPayload(message, await testSubscription(), await testVapid());
    expect(payload.headers["content-encoding"]).toBe("aes128gcm");
    expect(payload.headers.authorization.startsWith("vapid t=")).toBe(true);
    expect(payload.headers.topic?.length ?? 0).toBeLessThanOrEqual(32);
  });

  it("marks a 410 as gone", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 410 }));
    const result = await sendPush(await testSubscription(), message, await testVapid(), fetchImpl);
    expect(result).toEqual({ ok: false, gone: true, status: 410 });
  });
});
