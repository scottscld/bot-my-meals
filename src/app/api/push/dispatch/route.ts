import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/config";
import { handlePushDispatch, type PushDispatchClaim } from "@/lib/push-dispatch";
import { readPushConfig } from "@/lib/push-config";
import { sendPush } from "@/lib/push-send";

export const dynamic = "force-dynamic";

function anonClient() {
  const config = getPublicSupabaseConfig();
  if (!config) return null;
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  const config = readPushConfig();
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const client = anonClient();
  const result = await handlePushDispatch({
    secretHeader: request.headers.get("x-push-secret"),
    body,
    config: client ? config : null,
    claim: async (secret, outboxId) => {
      if (!client) throw new Error("unavailable");
      const { data, error } = await client.rpc("push_dispatch_claim", {
        secret,
        outbox_id: outboxId,
      });
      if (error) throw new Error(error.message);
      return (data ?? null) as PushDispatchClaim | null;
    },
    send: (subscription, message) => {
      if (!config) return Promise.resolve({ ok: false, gone: false, status: 503 });
      return sendPush(
        { endpoint: subscription.endpoint, expirationTime: null, keys: subscription.keys },
        message,
        { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
      );
    },
    report: async (secret, outboxId, gone, ok, error) => {
      if (!client) return;
      const { error: reportError } = await client.rpc("push_dispatch_report", {
        secret,
        outbox_id: outboxId,
        gone,
        ok,
        error,
      });
      if (reportError) throw new Error(reportError.message);
    },
  });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
