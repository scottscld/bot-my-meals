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

/** kind + week, capped at 32 base64url-safe characters so a newer push replaces the old one. */
export function pushTopic(kind: string, weekId: string | null | undefined): string {
  const safeKind = kind.replace(TOPIC_SAFE, "").slice(0, 20);
  const week = (weekId ?? "").replace(/-/g, "").replace(TOPIC_SAFE, "").slice(0, 11);
  const topic = week ? `${safeKind}-${week}` : safeKind;
  return topic.slice(0, 32);
}

export async function buildPushPayload(
  message: PushMessageBody,
  subscription: PushSubscription,
  vapid: VapidKeys,
) {
  return encryptPush(
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
}

export async function sendPush(
  subscription: PushSubscription,
  message: PushMessageBody,
  vapid: VapidKeys,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; gone: boolean; status: number }> {
  const init = await buildPushPayload(message, subscription, vapid);
  const response = await fetchImpl(subscription.endpoint, init);
  const gone = response.status === 404 || response.status === 410;
  return { ok: response.ok, gone, status: response.status };
}
