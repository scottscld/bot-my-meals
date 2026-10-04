export type PushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
  dispatchSecret: string;
};

/** Server-only. Never read these through NEXT_PUBLIC_. */
export function readPushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (env.VAPID_SUBJECT ?? "").trim();
  const dispatchSecret = (env.PUSH_DISPATCH_SECRET ?? "").trim();
  if (!publicKey || !privateKey || !subject || !dispatchSecret) return null;
  return { publicKey, privateKey, subject, dispatchSecret };
}

export function pushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readPushConfig(env) != null;
}

/** Compare two strings by their SHA-256 digests so the loop length does not leak the secret. */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let diff = a.length ^ b.length;
  for (let i = 0; i < leftBytes.length; i += 1) diff |= leftBytes[i] ^ rightBytes[i];
  return diff === 0;
}
