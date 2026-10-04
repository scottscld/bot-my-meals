import { NextResponse } from "next/server";
import { fetchSupabaseSession } from "@/lib/supabase/repo";
import { createSupabaseForRequest } from "@/lib/supabase/server";
import { readPushConfig } from "@/lib/push-config";
import { sendPush } from "@/lib/push-send";

export const dynamic = "force-dynamic";

const lastSentAt = new Map<string, number>();
const TEST_GAP_MS = 10_000;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const config = readPushConfig();
  if (!config) return json({ error: "push is not configured" }, 503);

  const client = await createSupabaseForRequest(request);
  if (!client) return json({ error: "unavailable" }, 503);
  let session;
  try {
    session = await fetchSupabaseSession(client);
  } catch {
    session = null;
  }
  if (!session?.householdId) return json({ error: "unauthorized" }, 401);

  const now = Date.now();
  const previous = lastSentAt.get(session.userId) ?? 0;
  if (now - previous < TEST_GAP_MS) return json({ error: "Wait a few seconds, then try again." }, 429);
  lastSentAt.set(session.userId, now);

  const { data, error } = await client
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", session.userId);
  if (error) return json({ error: error.message }, 500);

  const vapid = {
    subject: config.subject,
    publicKey: config.publicKey,
    privateKey: config.privateKey,
  };
  const message = {
    title: "Bot My Meals",
    body: "Notifications are on.",
    url: "/week",
    tag: "push-test",
    kind: "push-test",
    weekId: null,
  };
  let sent = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const result = await sendPush(
      {
        endpoint: String(row.endpoint),
        expirationTime: null,
        keys: { p256dh: String(row.p256dh), auth: String(row.auth) },
      },
      message,
      vapid,
    );
    if (result.ok) sent += 1;
    else failed += 1;
  }
  return json({ sent, failed });
}
