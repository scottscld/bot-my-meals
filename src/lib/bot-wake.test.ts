import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { BotCheckNow } from "@/components/bot-check-frequency";
import { BotWakeSettings } from "@/components/bot-wake-settings";
import { PostLockWaitingCard, RecipePendingNotice } from "@/components/post-lock-waiting";
import {
  BOT_CHECK_NOW_HINT,
  BOT_CHECK_NOW_LABEL,
} from "@/lib/bot-check";
import {
  POST_LOCK_GET_RECIPES_HINT,
  POST_LOCK_GET_RECIPES_LABEL,
  RECIPE_PENDING_HINT,
} from "@/lib/post-lock-waiting";
import {
  BOT_CHECK_NOW_WAKE_HINT,
  BOT_WAKE_CREATE_BODY,
  BOT_WAKE_CREATE_SAVED,
  BOT_WAKE_DEBOUNCE_MS,
  BOT_WAKE_EMPTY,
  FINISH_WAKE_BEFORE_CREATE,
  BOT_WAKE_KEY_HELPER,
  BOT_WAKE_KEY_LABEL,
  BOT_WAKE_KEY_PLACEHOLDER,
  BOT_WAKE_REPLACE,
  BOT_WAKE_SAVE_ERROR,
  BOT_WAKE_SAVED,
  BOT_WAKE_SECTION_LABEL,
  BOT_WAKE_SOFT_FAIL,
  BOT_WAKE_URL_HELPER,
  BOT_WAKE_URL_LABEL,
  BOT_WAKE_URL_PLACEHOLDER,
  POST_LOCK_GET_RECIPES_WAKE_HINT,
  RECIPE_PENDING_WAKE_HINT,
  botWakeBody,
  createWakeDebounceStore,
  householdHostFromRequest,
  isHttpsWebhookUrl,
  postBotWake,
  shouldWakeNeedsWork,
  debounceKey,
  parseWakeEvent,
  wakeAllowed,
  type WakeEvent,
} from "@/lib/bot-wake";
import {
  BOT_WAKE_KEY_SECRET,
  BOT_WAKE_URL_SECRET,
  readBotWakeSecrets,
  resetRememberedBotWakeSecrets,
  saveBotWakeSecrets,
} from "@/lib/bot-wake-secret";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const srcRoot = path.resolve(import.meta.dirname, "..");
const URL = "https://example.com/automations/webhook/wake";
const KEY = "crsr_test_key";
const NOW = new Date("2026-09-28T17:00:00.000Z");

function testEnv(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values };
}

function jsonResponse(status: number, body: unknown = { success: true }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("bot wake helper", () => {
  it("posts the exact body and sends the sender key as Authorization: Bearer", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await postBotWake({
      event: "week_locked",
      householdHost: "meals.example.com",
      url: URL,
      key: KEY,
      now: NOW,
      debounce: createWakeDebounceStore(),
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse(200);
      },
    });

    expect(result).toEqual({ posted: true, reason: "ok" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(URL);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.redirect).toBe("manual");
    expect(calls[0]?.init.credentials).toBe("omit");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({
      source: "bot-my-meals",
      event: "week_locked",
      household_host: "meals.example.com",
      at: "2026-09-28T17:00:00.000Z",
    });
    expect(Object.keys(body)).toEqual(["source", "event", "household_host", "at"]);
    expect(JSON.stringify(body)).not.toMatch(/supabase|cookie|anon|email|crsr_/i);
    expect(botWakeBody("check_now", "meals.example.com", NOW).source).toBe("bot-my-meals");
  });

  it("omits the Authorization header when no sender key is stored", async () => {
    let headers: Record<string, string> = {};
    await postBotWake({
      event: "check_now",
      householdHost: "meals.example.com",
      url: URL,
      key: null,
      now: NOW,
      debounce: createWakeDebounceStore(),
      fetchImpl: async (_url, init) => {
        headers = (init?.headers ?? {}) as Record<string, string>;
        return jsonResponse(200);
      },
    });
    expect(headers.authorization).toBeUndefined();
  });

  it("debounces the same event for 30s and still posts a different event", async () => {
    const store = createWakeDebounceStore();
    const events: WakeEvent[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      events.push(JSON.parse(String(init?.body)).event);
      return jsonResponse(200);
    };
    const base = {
      householdHost: "meals.example.com",
      url: URL,
      key: KEY,
      debounce: store,
      fetchImpl,
    };

    expect((await postBotWake({ ...base, event: "needs_work", now: NOW })).reason).toBe("ok");
    expect(
      (await postBotWake({ ...base, event: "needs_work", now: new Date(NOW.getTime() + 1_000) })).reason,
    ).toBe("debounced");
    expect(
      (await postBotWake({ ...base, event: "check_now", now: new Date(NOW.getTime() + 1_000) })).reason,
    ).toBe("ok");
    expect(
      (
        await postBotWake({
          ...base,
          event: "needs_work",
          now: new Date(NOW.getTime() + BOT_WAKE_DEBOUNCE_MS),
        })
      ).reason,
    ).toBe("ok");
    expect(events).toEqual(["needs_work", "check_now", "needs_work"]);
  });

  it("soft-fails when the webhook errors and does not throw or log the secret", async () => {
    const logs: string[] = [];
    const thrown = await postBotWake({
      event: "check_now",
      householdHost: "meals.example.com",
      url: URL,
      key: KEY,
      now: NOW,
      debounce: createWakeDebounceStore(),
      log: (message) => logs.push(message),
      fetchImpl: async () => {
        throw new Error(`nope ${URL} ${KEY}`);
      },
    });
    expect(thrown).toEqual({ posted: false, reason: "failed" });

    const http = await postBotWake({
      event: "week_locked",
      householdHost: "meals.example.com",
      url: URL,
      key: KEY,
      now: NOW,
      debounce: createWakeDebounceStore(),
      log: (message) => logs.push(message),
      fetchImpl: async () => jsonResponse(401, { error: KEY }),
    });
    expect(http).toEqual({ posted: false, reason: "failed" });
    expect(logs.join("\n")).toBe("[bot-wake] check_now network\n[bot-wake] week_locked http 401");
    expect(logs.join("\n")).not.toContain(URL);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("does not POST when the URL is unset and keeps polling as the fallback", async () => {
    let called = false;
    const result = await postBotWake({
      event: "needs_work",
      householdHost: "meals.example.com",
      url: null,
      key: KEY,
      now: NOW,
      fetchImpl: async () => {
        called = true;
        return jsonResponse(200);
      },
    });
    expect(result).toEqual({ posted: false, reason: "unset" });
    expect(called).toBe(false);
    expect(isHttpsWebhookUrl("http://example.com/hook")).toBe(false);
  });

  it("wakes check now always, week_locked only when locked, and needs_work only on a flip", () => {
    expect(wakeAllowed("check_now", { weekLocked: false, needsWork: false, listApproved: false })).toBe(true);
    expect(wakeAllowed("week_locked", { weekLocked: true, needsWork: false, listApproved: false })).toBe(true);
    expect(wakeAllowed("week_locked", { weekLocked: false, needsWork: true, listApproved: false })).toBe(false);
    expect(wakeAllowed("needs_work", { weekLocked: false, needsWork: true, listApproved: false })).toBe(true);
    expect(wakeAllowed("needs_work", { weekLocked: true, needsWork: false, listApproved: false })).toBe(false);
    expect(parseWakeEvent("list_approved")).toBe("list_approved");
    expect(wakeAllowed("list_approved", { weekLocked: false, needsWork: false, listApproved: true })).toBe(true);
    expect(wakeAllowed("list_approved", { weekLocked: true, needsWork: true, listApproved: false })).toBe(false);
    expect(debounceKey("meals.example.com", "list_approved")).toBe("meals.example.com:list_approved");
    expect(shouldWakeNeedsWork(null, true)).toBe(false);
    expect(shouldWakeNeedsWork(true, true)).toBe(false);
    expect(shouldWakeNeedsWork(false, false)).toBe(false);
    expect(shouldWakeNeedsWork(false, true)).toBe(true);
  });

  it("reads the household host from the forwarded host, without a port", () => {
    expect(
      householdHostFromRequest(
        new Request("https://internal.worker", { headers: { "x-forwarded-host": "meals.example.com:443, proxy" } }),
      ),
    ).toBe("meals.example.com");
  });
});

describe("bot wake secrets", () => {
  afterEach(() => {
    resetRememberedBotWakeSecrets();
  });

  it("reads Worker env secrets and never a NEXT_PUBLIC name", () => {
    expect(BOT_WAKE_URL_SECRET).toBe("BOT_WAKE_WEBHOOK_URL");
    expect(BOT_WAKE_KEY_SECRET).toBe("BOT_WAKE_WEBHOOK_KEY");
    expect(BOT_WAKE_URL_SECRET.startsWith("NEXT_PUBLIC_")).toBe(false);
    expect(BOT_WAKE_KEY_SECRET.startsWith("NEXT_PUBLIC_")).toBe(false);
    expect(
      readBotWakeSecrets(
        testEnv({
          BOT_WAKE_WEBHOOK_URL: `  ${URL}  `,
          BOT_WAKE_WEBHOOK_KEY: `  ${KEY}  `,
        }),
      ),
    ).toEqual({ url: URL, key: KEY, configured: true });
    expect(readBotWakeSecrets(testEnv()).configured).toBe(false);
  });

  it("stores both secrets with the Cloudflare bulk API and does not echo them back", async () => {
    let sent = "";
    let auth = "";
    const saved = await saveBotWakeSecrets({
      url: URL,
      key: KEY,
      env: testEnv({
        NODE_ENV: "production",
        CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
        CLOUDFLARE_API_TOKEN: "cf-token",
      }),
      fetchImpl: async (url, init) => {
        sent = String(init?.body);
        auth = String((init?.headers as Record<string, string>).authorization);
        expect(String(url)).toBe(
          `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/workers/scripts/bot-my-meals/secrets-bulk`,
        );
        expect(init?.method).toBe("PATCH");
        return jsonResponse(200);
      },
    });
    expect(saved).toEqual({ ok: true });
    expect(auth).toBe("Bearer cf-token");
    const body = JSON.parse(sent);
    expect(body.secrets.BOT_WAKE_WEBHOOK_URL).toEqual({
      name: "BOT_WAKE_WEBHOOK_URL",
      text: URL,
      type: "secret_text",
    });
    expect(body.secrets.BOT_WAKE_WEBHOOK_KEY.text).toBe(KEY);
    expect(JSON.stringify(saved)).not.toContain(URL);
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(readBotWakeSecrets(testEnv())).toEqual({ url: URL, key: KEY, configured: true });
  });

  it("refuses to pretend a production save worked when the Cloudflare token is missing", async () => {
    let called = false;
    const saved = await saveBotWakeSecrets({
      url: URL,
      env: testEnv({ NODE_ENV: "production" }),
      fetchImpl: async () => {
        called = true;
        return jsonResponse(200);
      },
    });
    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.error).toContain("BOT_WAKE_WEBHOOK_URL");
      expect(saved.error).not.toContain(URL);
    }
    expect(called).toBe(false);
    expect(readBotWakeSecrets(testEnv()).configured).toBe(false);
  });

  it("soft-fails a Cloudflare error without throwing", async () => {
    const saved = await saveBotWakeSecrets({
      url: URL,
      key: KEY,
      env: testEnv({
        NODE_ENV: "production",
        CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
        CLOUDFLARE_API_TOKEN: "cf-token",
      }),
      fetchImpl: async () => {
        throw new Error(KEY);
      },
    });
    expect(saved).toEqual({ ok: false, error: "Could not store that on the Worker." });
  });
});

describe("Wake your Bot settings and gated hints", () => {
  it("matches the lock copy", () => {
    expect(BOT_WAKE_SECTION_LABEL).toBe("Wake your Bot");
    expect(BOT_WAKE_URL_LABEL).toBe("Bot webhook URL");
    expect(BOT_WAKE_URL_HELPER).toBe(
      "In your Bot My Meals Grok Bot, open Routines, open the wake routine, and copy Webhook URL. Paste it here so Lock and Check now can wake your bot.",
    );
    expect(BOT_WAKE_URL_PLACEHOLDER).toBe("https://…");
    expect(BOT_WAKE_EMPTY).toBe(
      "Required. Paste the Webhook URL before you create this week\u2019s meals.",
    );
    expect(BOT_WAKE_EMPTY).not.toMatch(/Adaptive|every hour|schedule|Optional/i);
    expect(BOT_WAKE_CREATE_BODY).toBe(
      "Paste your bot\u2019s Webhook URL so the app can wake it when you create meals, lock, or tap Check now.",
    );
    expect(BOT_WAKE_CREATE_SAVED).toBe("Saved. Create this week\u2019s meals will wake your bot.");
    expect(FINISH_WAKE_BEFORE_CREATE).toBe("Finish Wake your Bot first.");
    expect(BOT_WAKE_SAVED).toBe("Saved. Check now will wake your bot.");
    expect(BOT_WAKE_REPLACE).toBe("Saved · Replace");
    expect(BOT_WAKE_SAVE_ERROR).toBe("Couldn\u2019t save. Try again.");
    expect(BOT_WAKE_SOFT_FAIL).toBe("Couldn\u2019t reach your bot. Try again or message it.");
    expect(BOT_CHECK_NOW_WAKE_HINT).toBe("Wakes your Bot My Meals bot now.");
    expect(POST_LOCK_GET_RECIPES_WAKE_HINT).toBe("Wakes your bot to fill recipes and the shopping list.");
    expect(RECIPE_PENDING_WAKE_HINT).toBe("Wakes your bot to fill this recipe.");
    expect(BOT_WAKE_KEY_LABEL).toBe("Sender key");
    expect(BOT_WAKE_KEY_HELPER).toBe(
      "If the routine panel shows a sender key, paste it here too. Skip if you don\u2019t see one.",
    );
    expect(BOT_WAKE_KEY_PLACEHOLDER).toBe("Paste key");
    const voice = [
      BOT_WAKE_URL_HELPER,
      BOT_WAKE_EMPTY,
      BOT_WAKE_SAVED,
      BOT_WAKE_SOFT_FAIL,
      BOT_CHECK_NOW_WAKE_HINT,
      POST_LOCK_GET_RECIPES_WAKE_HINT,
      RECIPE_PENDING_WAKE_HINT,
    ].join(" ");
    expect(voice).not.toMatch(/APNs|Instant push|phone push/i);
  });

  it("shows the empty paste for an admin and the saved line after the URL is set", () => {
    const empty = renderToStaticMarkup(createElement(BotWakeSettings, { canEdit: true, configured: false }));
    expect(empty).toContain("Wake your Bot");
    expect(empty).toContain("Bot webhook URL");
    expect(empty).toContain("open Routines");
    expect(empty).toContain("https://…");
    expect(empty).toContain("Required. Paste the Webhook URL");
    expect(empty).toContain("Sender key");
    expect(empty).toContain("Paste key");
    expect(empty).toContain("Skip if you");
    expect(empty).not.toContain("Saved. Check now will wake");
    expect(empty).not.toContain(URL);

    const saved = renderToStaticMarkup(createElement(BotWakeSettings, { canEdit: true, configured: true }));
    expect(saved).toContain("Saved. Check now will wake your bot.");
    expect(saved).toContain("Saved · Replace");
    expect(saved).not.toContain("Required. Paste the Webhook URL");
    expect(saved).not.toContain('id="bot-wake-url"');
    expect(saved).not.toContain('id="bot-wake-key"');
    expect(saved).not.toContain('value="https://');

    const member = renderToStaticMarkup(createElement(BotWakeSettings, { canEdit: false, configured: false }));
    expect(member).toContain("Required. Paste the Webhook URL");
    expect(member).not.toContain("<form");
  });

  it("keeps the message-your-Bot hint until a webhook URL is configured", () => {
    const quiet = renderToStaticMarkup(createElement(BotCheckNow, { wakeConfigured: false }));
    expect(quiet).toContain(BOT_CHECK_NOW_LABEL);
    expect(quiet).toContain(BOT_CHECK_NOW_HINT);
    expect(quiet).toContain("This isn’t a push from the app.");
    expect(quiet).not.toContain(BOT_CHECK_NOW_WAKE_HINT);
    expect(quiet).toContain('data-wake="off"');

    const waking = renderToStaticMarkup(createElement(BotCheckNow, { wakeConfigured: true }));
    expect(waking).toContain(BOT_CHECK_NOW_LABEL);
    expect(waking).toContain(BOT_CHECK_NOW_WAKE_HINT);
    expect(waking).not.toContain("isn’t a push");
    expect(waking).toContain('data-wake="on"');
    expect(waking).toContain("<button");

    const settingsOff = renderToStaticMarkup(
      createElement(BotWakeSettings, { canEdit: true, configured: false }),
    );
    expect(settingsOff).toContain("Wake your Bot");
    expect(settingsOff).toContain(BOT_WAKE_EMPTY);
    expect(settingsOff).toContain("This isn’t a push from the app.");
    expect(settingsOff).not.toContain("Bot check frequency");
    expect(settingsOff).not.toContain("Adaptive");
    expect(settingsOff).not.toContain("Every hour");

    const settingsOn = renderToStaticMarkup(
      createElement(BotWakeSettings, { canEdit: true, configured: true }),
    );
    expect(settingsOn).toContain("Wakes your Bot My Meals bot now.");
    expect(settingsOn).not.toContain("Bot check frequency");
    expect(settingsOn).not.toContain("Adaptive");
    expect(settingsOn).not.toContain("Every hour");
    expect(settingsOn).not.toContain("Every 6 hours");
    expect(settingsOn).not.toContain(BOT_WAKE_EMPTY);

    const setupEmpty = renderToStaticMarkup(
      createElement(BotWakeSettings, { canEdit: true, configured: false, placement: "setup" }),
    );
    expect(setupEmpty).toContain(BOT_WAKE_EMPTY);
    expect(setupEmpty).toContain(BOT_WAKE_CREATE_BODY);
    expect(setupEmpty).not.toContain("Optional");
    expect(setupEmpty).not.toContain(BOT_CHECK_NOW_WAKE_HINT);

    const setupSaved = renderToStaticMarkup(
      createElement(BotWakeSettings, { canEdit: true, configured: true, placement: "setup" }),
    );
    expect(setupSaved).toContain(BOT_WAKE_CREATE_SAVED);
    expect(setupSaved).not.toContain(BOT_WAKE_SAVED);
    expect(setupSaved).not.toContain(BOT_WAKE_EMPTY);

    const waitingOff = renderToStaticMarkup(
      createElement(PostLockWaitingCard, { wakeConfigured: false }),
    );
    expect(waitingOff).toContain(POST_LOCK_GET_RECIPES_LABEL);
    expect(waitingOff).toContain(POST_LOCK_GET_RECIPES_HINT);
    expect(waitingOff).toContain("This isn’t a push from the app.");

    const waitingOn = renderToStaticMarkup(
      createElement(PostLockWaitingCard, { wakeConfigured: true }),
    );
    expect(waitingOn).toContain("Get recipes now");
    expect(waitingOn).toContain(POST_LOCK_GET_RECIPES_WAKE_HINT);
    expect(waitingOn).not.toContain("isn’t a push");
    expect(waitingOn).not.toContain("Checks about every hour");
    expect(waitingOn).not.toContain("Next check in about");
    expect(waitingOn).not.toContain("post-lock-cadence");

    const recipeOff = renderToStaticMarkup(createElement(RecipePendingNotice, { wakeConfigured: false }));
    expect(recipeOff).toContain(RECIPE_PENDING_HINT);
    expect(recipeOff).not.toContain(RECIPE_PENDING_WAKE_HINT);
    expect(recipeOff).toContain('data-wake="off"');

    const recipeOn = renderToStaticMarkup(createElement(RecipePendingNotice, { wakeConfigured: true }));
    expect(recipeOn).toContain(RECIPE_PENDING_WAKE_HINT);
    expect(recipeOn).not.toContain(RECIPE_PENDING_HINT);
    expect(recipeOn).toContain('data-wake="on"');
    expect(recipeOn).not.toMatch(/APNs|Instant push|phone push/i);
  });

  it("wires lock, needs-work flips, and House above the check interval", () => {
    const provider = readFileSync(path.join(srcRoot, "components/supper-provider.tsx"), "utf8");
    const settings = readFileSync(path.join(srcRoot, "app/settings/page.tsx"), "utf8");
    const route = readFileSync(path.join(srcRoot, "app/api/bot/wake/route.ts"), "utf8");
    const secrets = readFileSync(path.join(srcRoot, "lib/bot-wake-secret.ts"), "utf8");
    const clientFiles = [
      "components/bot-wake-settings.tsx",
      "components/bot-check-frequency.tsx",
      "components/post-lock-waiting.tsx",
      "components/use-bot-wake.ts",
      "lib/bot-wake-client.ts",
      "app/settings/page.tsx",
    ].map((file) => readFileSync(path.join(srcRoot, file), "utf8"));

    expect(provider).toContain('requestBotWake("week_locked")');
    expect(provider).toContain('requestBotWake("needs_work")');
    expect(provider).toContain('requestBotWake("list_approved")');
    expect(provider).toContain("shouldWakeNeedsWork");
    expect(provider).toContain("wakeWeekOrPlanChange");
    expect(provider).toMatch(/saveWeekPeople:[\s\S]*wakeWeekOrPlanChange/);
    expect(provider).toMatch(/savePlanningPeople:[\s\S]*wakeWeekOrPlanChange/);
    expect(provider).toMatch(/planNextWeek:[\s\S]*wakeWeekOrPlanChange/);
    expect(provider).toMatch(/requestWeekBallot:[\s\S]*fetchBotWakeConfigured[\s\S]*FINISH_WAKE_BEFORE_CREATE/);
    expect(provider).toMatch(/requestWeekBallot:[\s\S]*wakeWeekOrPlanChange/);
    const wizard = readFileSync(path.join(srcRoot, "components/setup-wizard.tsx"), "utf8");
    const week = readFileSync(path.join(srcRoot, "app/week/page.tsx"), "utf8");
    expect(wizard).toContain('placement="setup"');
    expect(wizard).toContain("disabled={busy || !createReady}");
    expect(wizard).toContain("FINISH_WAKE_BEFORE_CREATE");
    expect(wizard).not.toMatch(/create-meals[\s\S]{0,400}Skip/);
    expect(week).toContain("disabled={creating || !wakeReady}");
    expect(week).toContain("FINISH_WAKE_BEFORE_CREATE");
    expect(settings).toContain("BotWakeSettings");
    expect(settings).not.toContain("BotCheckFrequency");
    expect(settings).not.toContain("Bot check frequency");
    expect(secrets).toContain("BOT_WAKE_WEBHOOK_URL");
    expect(secrets).toContain("BOT_WAKE_WEBHOOK_KEY");
    expect(route).toContain("saveBotWakeSecrets");
    expect(route).not.toMatch(/NEXT_PUBLIC_BOT/);
    expect(route).not.toMatch(/service.role/i);
    for (const source of clientFiles) {
      expect(source).not.toContain("bot-wake-secret");
      expect(source).not.toContain("process.env.BOT_WAKE");
      expect(source).not.toContain("NEXT_PUBLIC_BOT");
    }
  });

  it("documents the install paste and the bearer key", () => {
    const docs = readFileSync(path.join(repoRoot, "docs/bot-routines.md"), "utf8");
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
    expect(docs).toContain("Wake on app event");
    expect(docs).toContain("Webhook URL");
    expect(docs).toContain("House → Wake your Bot");
    expect(docs).toContain("BOT_WAKE_WEBHOOK_URL");
    expect(docs).toContain("BOT_WAKE_WEBHOOK_KEY");
    expect(docs).toContain("Authorization: Bearer");
    expect(docs).toMatch(/stay quiet if nothing changed/i);
    expect(docs).toMatch(/Waiting never shows a schedule/);
    expect(docs).toMatch(/required before Create this week's meals/);
    expect(readme).toMatch(/required before Create this week's meals/);
    expect(docs).toMatch(/needs_work/);
    expect(docs).not.toMatch(/@every/);
    expect(docs).not.toMatch(/Adaptive/);
    expect(docs).not.toMatch(/Copy \*\*POST to\*\* \(the webhook URL\) and \*\*key\*\*/);
    expect(readme).toContain("Wake on app event");
    expect(readme).toContain("Webhook URL");
    expect(readme).toContain("House → Wake your Bot");
    expect(readme).toContain("BOT_WAKE_WEBHOOK_URL");
    expect(readme).toContain("Authorization: Bearer");
    expect(readme).not.toMatch(/Copy POST to and key/);
  });
});
