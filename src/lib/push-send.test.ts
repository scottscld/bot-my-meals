import { describe, expect, it, vi } from "vitest";
import { buildPushPayload, canonicalizeEcdsaSignature, pushTopic, sendPush } from "./push-send";

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
    expect((payload.headers.topic?.length ?? 0) % 4).toBe(0);
  });

  it("marks a 410 as gone", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 410 }));
    const result = await sendPush(await testSubscription(), message, await testVapid(), fetchImpl);
    expect(result).toEqual({ ok: false, gone: true, status: 410, reason: "" });
  });
});

describe("pushTopic", () => {
  it("pads every topic to a length Apple will accept", () => {
    const topics = [
      pushTopic("push-test", null),
      pushTopic("menu_ready", null),
      pushTopic("options_refreshed", null),
      pushTopic("week_locked", null),
      pushTopic("menu_ready", "fed4dffc-63f0-4107-925d-592bcacd4860"),
      pushTopic("options_refreshed", "fed4dffc-63f0-4107-925d-592bcacd4860"),
    ];
    for (const topic of topics) {
      expect(topic.length).toBeGreaterThan(0);
      expect(topic.length).toBeLessThanOrEqual(32);
      expect(topic.length % 4).toBe(0);
      expect(topic).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(pushTopic("push-test", null)).toBe("push-test000");
  });
});

describe("canonicalizeEcdsaSignature", () => {
  it("folds a high S into the lower half and still verifies", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const data = new TextEncoder().encode("vapid");
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data));
    const order = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
    const high = new Uint8Array(signature);
    let s = BigInt(0);
    for (let index = 32; index < 64; index += 1) s = (s << BigInt(8)) + BigInt(high[index]);
    s = s <= order / BigInt(2) ? order - s : s;
    for (let index = 63; index >= 32; index -= 1) {
      high[index] = Number(s & BigInt(255));
      s >>= BigInt(8);
    }
    const low = canonicalizeEcdsaSignature(high);
    let lowS = BigInt(0);
    for (let index = 32; index < 64; index += 1) lowS = (lowS << BigInt(8)) + BigInt(low[index]);
    expect(lowS <= order / BigInt(2)).toBe(true);
    const signatureBytes = new Uint8Array(low);
    expect(
      await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, signatureBytes, data),
    ).toBe(true);
  });
});
