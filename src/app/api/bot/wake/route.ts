import { NextResponse } from "next/server";
import {
  householdHostFromRequest,
  parseWakeEvent,
  postBotWake,
  sharedWakeDebounce,
  wakeAllowed,
  type WakeEvent,
} from "@/lib/bot-wake";
import { readBotWakeSecrets, saveBotWakeSecrets } from "@/lib/bot-wake-secret";
import {
  fetchSupabaseSession,
  supabaseBotCheckStatus,
  supabaseCurrentWeekLocked,
  supabaseListAwaitingBot,
} from "@/lib/supabase/repo";
import { createSupabaseForRequest } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/users";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function wakeJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

async function requireMember(request: Request) {
  const client = await createSupabaseForRequest(request);
  if (!client) return { client: null, session: null, response: wakeJson({ error: "unavailable" }, 503) };
  try {
    const session = await fetchSupabaseSession(client);
    if (!session?.householdId) {
      return { client, session: null, response: wakeJson({ error: "unauthorized" }, 401) };
    }
    return { client, session, response: null };
  } catch {
    return { client, session: null, response: wakeJson({ error: "unauthorized" }, 401) };
  }
}

async function wakeFacts(
  client: SupabaseClient,
  householdId: string,
  event: WakeEvent,
): Promise<{ weekLocked: boolean; needsWork: boolean; listApproved: boolean }> {
  switch (event) {
    case "check_now":
      return { weekLocked: false, needsWork: false, listApproved: false };
    case "week_locked":
      return {
        weekLocked: await supabaseCurrentWeekLocked(client, householdId),
        needsWork: false,
        listApproved: false,
      };
    case "needs_work": {
      const status = await supabaseBotCheckStatus(client);
      return { weekLocked: false, needsWork: status.ok && status.body.needs_work, listApproved: false };
    }
    case "list_approved":
      return {
        weekLocked: false,
        needsWork: false,
        listApproved: await supabaseListAwaitingBot(client, householdId),
      };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if (auth.response || !auth.session) return auth.response ?? wakeJson({ error: "unauthorized" }, 401);
  return wakeJson({ configured: readBotWakeSecrets().configured });
}

export async function POST(request: Request) {
  const auth = await requireMember(request);
  if (auth.response || !auth.session || !auth.client) {
    return auth.response ?? wakeJson({ error: "unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return wakeJson({ error: "unknown event" }, 400);
  }
  const event = parseWakeEvent(
    payload != null && typeof payload === "object" && "event" in payload ? payload.event : null,
  );
  if (!event) return wakeJson({ error: "unknown event" }, 400);

  const householdId = auth.session.householdId;
  if (!householdId) return wakeJson({ error: "unauthorized" }, 401);

  try {
    const facts = await wakeFacts(auth.client, householdId, event);
    if (!wakeAllowed(event, facts)) return wakeJson({ posted: false, reason: "skipped" });
    const secrets = readBotWakeSecrets();
    const result = await postBotWake({
      event,
      householdHost: householdHostFromRequest(request),
      url: secrets.url,
      key: secrets.key,
      debounce: sharedWakeDebounce,
    });
    return wakeJson({ posted: result.posted, reason: result.reason });
  } catch {
    console.warn(`[bot-wake] ${event} soft-fail`);
    return wakeJson({ posted: false, reason: "failed" });
  }
}

export async function PUT(request: Request) {
  const auth = await requireMember(request);
  if (auth.response || !auth.session) return auth.response ?? wakeJson({ error: "unauthorized" }, 401);
  if (!isAdmin(auth.session.role)) {
    return wakeJson({ error: "Only an Admin can save the bot webhook." }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return wakeJson({ error: "Paste an https webhook URL." }, 400);
  }
  if (payload == null || typeof payload !== "object") {
    return wakeJson({ error: "Paste an https webhook URL." }, 400);
  }
  const url = "url" in payload && typeof payload.url === "string" ? payload.url : "";
  const key = "key" in payload && typeof payload.key === "string" ? payload.key : undefined;
  const saved = await saveBotWakeSecrets({ url, key });
  if (!saved.ok) {
    const status = saved.error.startsWith("Paste") ? 400 : 502;
    return wakeJson({ error: saved.error }, status);
  }
  return wakeJson({ configured: true });
}
