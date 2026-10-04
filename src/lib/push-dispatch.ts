import { timingSafeEqual, type PushConfig } from "@/lib/push-config";
import type { PushMessageBody } from "@/lib/push-send";

export type PushDispatchSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushDispatchClaim = {
  id: number;
  kind: string;
  week_id: string | null;
  message: { title: string; body: string; url: string; tag: string };
  subscriptions: PushDispatchSubscription[];
};

export type PushSendResult = { ok: boolean; gone: boolean; status: number };

const SEND_CONCURRENCY = 6;

async function sendChunked(
  subscriptions: PushDispatchSubscription[],
  send: (subscription: PushDispatchSubscription, message: PushMessageBody) => Promise<PushSendResult>,
  message: PushMessageBody,
): Promise<PromiseSettledResult<{ endpoint: string; result: PushSendResult }>[]> {
  const settled: PromiseSettledResult<{ endpoint: string; result: PushSendResult }>[] = [];
  for (let index = 0; index < subscriptions.length; index += SEND_CONCURRENCY) {
    const chunk = subscriptions.slice(index, index + SEND_CONCURRENCY);
    const batch = await Promise.allSettled(
      chunk.map(async (subscription) => ({
        endpoint: subscription.endpoint,
        result: await send(subscription, message),
      })),
    );
    settled.push(...batch);
  }
  return settled;
}

export async function handlePushDispatch(input: {
  secretHeader: string | null;
  body: unknown;
  config: PushConfig | null;
  claim: (secret: string, outboxId: number) => Promise<PushDispatchClaim | null>;
  send: (subscription: PushDispatchSubscription, message: PushMessageBody) => Promise<PushSendResult>;
  report: (secret: string, outboxId: number, gone: string[], ok: string[], error: string | null) => Promise<void>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!input.config) return { status: 503, body: { error: "push is not configured" } };

  const header = input.secretHeader ?? "";
  if (!(await timingSafeEqual(header, input.config.dispatchSecret))) {
    return { status: 401, body: { error: "forbidden" } };
  }

  const outboxId =
    input.body != null &&
    typeof input.body === "object" &&
    "outbox_id" in input.body &&
    typeof input.body.outbox_id === "number"
      ? input.body.outbox_id
      : null;
  if (outboxId == null) return { status: 400, body: { error: "outbox_id required" } };

  let claim: PushDispatchClaim | null;
  try {
    claim = await input.claim(input.config.dispatchSecret, outboxId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/forbidden/i.test(message)) return { status: 401, body: { error: "forbidden" } };
    throw err;
  }
  if (!claim) return { status: 200, body: { skipped: true } };

  const message: PushMessageBody = {
    title: claim.message.title,
    body: claim.message.body,
    url: claim.message.url,
    tag: claim.message.tag,
    kind: claim.kind,
    weekId: claim.week_id,
  };
  const settled = await sendChunked(claim.subscriptions, input.send, message);
  const gone: string[] = [];
  const ok: string[] = [];
  let failed = 0;
  let sent = 0;
  for (const item of settled) {
    if (item.status === "rejected") {
      failed += 1;
      continue;
    }
    if (item.value.result.gone) gone.push(item.value.endpoint);
    else if (item.value.result.ok) {
      ok.push(item.value.endpoint);
      sent += 1;
    } else failed += 1;
  }
  const error = failed > 0 ? `${failed} push send(s) failed` : null;
  await input.report(input.config.dispatchSecret, outboxId, gone, ok, error);
  return { status: 200, body: { sent, gone: gone.length, failed } };
}
