import { buildPushPayload as encryptPush, type PushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";

export type PushMessageBody = {
  title: string;
  body: string;
  url: string;
  tag: string;
  kind?: string;
  weekId?: string | null;
};

const TOPIC_SAFE = /[^A-Za-z0-9_-]/g;
const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const vapidHeaderCache = new Map<string, { header: string; exp: number }>();

const ZERO = BigInt(0);
const EIGHT = BigInt(8);
const BYTE = BigInt(255);
const TWO = BigInt(2);

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = ZERO;
  for (const byte of bytes) value = (value << EIGHT) + BigInt(byte);
  return value;
}

function writeUint256(target: Uint8Array, offset: number, value: bigint) {
  for (let index = 31; index >= 0; index -= 1) {
    target[offset + index] = Number(value & BYTE);
    value >>= EIGHT;
  }
}

/** Apple rejects an ES256 JWT when S is in the upper half of the P-256 order. */
export function canonicalizeEcdsaSignature(signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) return signature;
  const s = bytesToBigInt(signature.subarray(32));
  if (s <= P256_N / TWO) return signature;
  const out = new Uint8Array(signature);
  writeUint256(out, 32, P256_N - s);
  return out;
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function jwtExp(jwt: string): number | null {
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as { exp?: unknown };
    return typeof parsed.exp === "number" ? parsed.exp : null;
  } catch {
    return null;
  }
}

function canonicalizeVapidJwt(jwt: string): string {
  const parts = jwt.split(".");
  if (parts.length !== 3) return jwt;
  return `${parts[0]}.${parts[1]}.${encodeBase64Url(canonicalizeEcdsaSignature(decodeBase64Url(parts[2])))}`;
}

/**
 * Apple asks servers to reuse a VAPID token for up to an hour.
 * A brand-new token on every test tap is a common reason the phone stays quiet.
 */
export function reuseVapidAuthorization(authorization: string, endpoint: string): string {
  const match = /^vapid t=([^,\s]+),\s*k=([^,\s]+)$/.exec(authorization);
  if (!match) return authorization;
  const origin = new URL(endpoint).origin;
  const cacheKey = `${origin}:${match[2]}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = vapidHeaderCache.get(cacheKey);
  if (cached && cached.exp > now + 60 * 60) return cached.header;
  const header = `vapid t=${canonicalizeVapidJwt(match[1])}, k=${match[2]}`;
  vapidHeaderCache.set(cacheKey, { header, exp: jwtExp(match[1]) ?? now + 12 * 60 * 60 });
  return header;
}

/**
 * kind + week, capped at 32 base64url characters so a newer push replaces the old one.
 * Apple rejects a topic whose length mod 4 is 1 (BadWebPushTopic), so pad to a multiple of 4.
 */
export function pushTopic(kind: string, weekId: string | null | undefined): string {
  const safeKind = kind.replace(TOPIC_SAFE, "").slice(0, 20);
  const week = (weekId ?? "").replace(/-/g, "").replace(TOPIC_SAFE, "").slice(0, 11);
  const topic = (week ? `${safeKind}-${week}` : safeKind).slice(0, 32) || "notice";
  const pad = (4 - (topic.length % 4)) % 4;
  return topic + "0".repeat(pad);
}

export async function buildPushPayload(
  message: PushMessageBody,
  subscription: PushSubscription,
  vapid: VapidKeys,
) {
  const payload = await encryptPush(
    {
      data: {
        title: message.title,
        body: message.body,
        url: message.url,
        tag: message.tag,
      },
      options: {
        ttl: 6 * 3600,
        urgency: "normal",
        topic: pushTopic(message.kind ?? message.tag, message.weekId),
      },
    },
    subscription,
    vapid,
  );
  if (typeof payload.headers.authorization === "string") {
    payload.headers.authorization = reuseVapidAuthorization(payload.headers.authorization, subscription.endpoint);
  }
  return payload;
}

export async function sendPush(
  subscription: PushSubscription,
  message: PushMessageBody,
  vapid: VapidKeys,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; gone: boolean; status: number; reason: string }> {
  const init = await buildPushPayload(message, subscription, vapid);
  const response = await fetchImpl(subscription.endpoint, init);
  const gone = response.status === 404 || response.status === 410;
  let reason = "";
  if (!response.ok && !gone) {
    const text = await response.text().catch(() => "");
    try {
      const parsed = JSON.parse(text) as { reason?: unknown };
      reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 80) : "";
    } catch {
      reason = "";
    }
  }
  return { ok: response.ok, gone, status: response.status, reason };
}
