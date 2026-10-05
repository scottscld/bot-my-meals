export const BOT_WAKE_DEBOUNCE_MS = 30_000;

export const BOT_WAKE_SECTION_LABEL = "Wake your Bot";
export const BOT_WAKE_URL_LABEL = "Bot webhook URL";
export const BOT_WAKE_URL_HELPER =
  "In your Bot My Meals Grok Bot, open Routines, open the wake routine, and copy Webhook URL. Paste it here so Lock and Check now can wake your bot.";
export const BOT_WAKE_URL_PLACEHOLDER = "https://…";
export const BOT_WAKE_EMPTY =
  "Required. Paste the Webhook URL before you create this week\u2019s meals.";
export const BOT_WAKE_CREATE_BODY =
  "Paste your bot\u2019s Webhook URL so the app can wake it when you create meals, lock, or tap Check now.";
export const BOT_WAKE_CREATE_SAVED = "Saved. Create this week\u2019s meals will wake your bot.";
export const FINISH_WAKE_BEFORE_CREATE = "Finish Wake your Bot first.";
export const BOT_WAKE_SAVED = "Saved. Check now will wake your bot.";
export const BOT_WAKE_REPLACE = "Saved · Replace";
export const BOT_WAKE_SAVE_ERROR = "Couldn\u2019t save. Try again.";
export const BOT_WAKE_SOFT_FAIL = "Couldn\u2019t reach your bot. Try again or message it.";
export const BOT_WAKE_KEY_LABEL = "Sender key";
export const BOT_WAKE_KEY_HELPER =
  "If the routine panel shows a sender key, paste it here too. Skip if you don\u2019t see one.";
export const BOT_WAKE_KEY_PLACEHOLDER = "Paste key";

export const BOT_CHECK_NOW_WAKE_HINT = "Wakes your Bot My Meals bot now.";
export const POST_LOCK_GET_RECIPES_WAKE_HINT =
  "Wakes your bot to fill recipes and the shopping list.";
export const RECIPE_PENDING_WAKE_HINT = "Wakes your bot to fill this recipe.";

export const WAKE_EVENTS = ["week_locked", "needs_work", "check_now", "list_approved"] as const;
export type WakeEvent = (typeof WAKE_EVENTS)[number];

export type BotWakeBody = {
  source: "bot-my-meals";
  event: WakeEvent;
  household_host: string;
  at: string;
};

export type WakeDebounceStore = {
  lastAt(key: string): number | null;
  mark(key: string, at: number): void;
};

export type PostBotWakeResult = {
  posted: boolean;
  reason: "ok" | "unset" | "debounced" | "failed";
};

export function createWakeDebounceStore(): WakeDebounceStore {
  const last = new Map<string, number>();
  return {
    lastAt(key) {
      return last.get(key) ?? null;
    },
    mark(key, at) {
      last.set(key, at);
    },
  };
}

export const sharedWakeDebounce = createWakeDebounceStore();

export function isHttpsWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function usableSenderKey(key: string | null | undefined): string | null {
  const trimmed = (key ?? "").trim();
  if (!trimmed || /[\u0000\r\n]/.test(trimmed)) return null;
  return trimmed;
}

export function parseWakeEvent(value: unknown): WakeEvent | null {
  switch (value) {
    case "week_locked":
    case "needs_work":
    case "check_now":
    case "list_approved":
      return value;
    default:
      return null;
  }
}

/** Edge trigger: opening the app while work is already pending does not wake. */
export function shouldWakeNeedsWork(previous: boolean | null, next: boolean): boolean {
  return previous === false && next;
}

export function wakeAllowed(
  event: WakeEvent,
  facts: { weekLocked: boolean; needsWork: boolean; listApproved: boolean },
): boolean {
  switch (event) {
    case "check_now":
      return true;
    case "week_locked":
      return facts.weekLocked;
    case "needs_work":
      return facts.needsWork;
    case "list_approved":
      return facts.listApproved;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function debounceKey(householdHost: string, event: WakeEvent): string {
  return `${householdHost}:${event}`;
}

export function botWakeBody(event: WakeEvent, householdHost: string, at: Date): BotWakeBody {
  return {
    source: "bot-my-meals",
    event,
    household_host: householdHost,
    at: at.toISOString(),
  };
}

export function householdHostFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const raw = forwarded.split(",")[0]?.trim() ?? "";
  if (raw) {
    try {
      return new URL(`https://${raw}`).hostname;
    } catch {
      // Fall through to the request URL.
    }
  }
  try {
    return new URL(request.url).hostname;
  } catch {
    return "unknown";
  }
}

export async function postBotWake(input: {
  event: WakeEvent;
  householdHost: string;
  url: string | null;
  key: string | null;
  now?: Date;
  debounce?: WakeDebounceStore;
  debounceMs?: number;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}): Promise<PostBotWakeResult> {
  const url = (input.url ?? "").trim();
  if (!isHttpsWebhookUrl(url)) return { posted: false, reason: "unset" };

  const now = input.now ?? new Date();
  const store = input.debounce ?? sharedWakeDebounce;
  const windowMs = input.debounceMs ?? BOT_WAKE_DEBOUNCE_MS;
  const key = debounceKey(input.householdHost, input.event);
  if (store.lastAt(key) != null && now.getTime() - (store.lastAt(key) as number) < windowMs) {
    return { posted: false, reason: "debounced" };
  }
  store.mark(key, now.getTime());

  const payload = botWakeBody(input.event, input.householdHost, now);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const senderKey = usableSenderKey(input.key);
  if (senderKey) headers.authorization = `Bearer ${senderKey}`;

  const fetchImpl = input.fetchImpl ?? fetch;
  const log = input.log ?? ((message: string) => console.warn(message));
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "manual",
      credentials: "omit",
    });
    if (!response.ok) {
      log(`[bot-wake] ${input.event} http ${response.status}`);
      return { posted: false, reason: "failed" };
    }
    return { posted: true, reason: "ok" };
  } catch {
    log(`[bot-wake] ${input.event} network`);
    return { posted: false, reason: "failed" };
  }
}
