import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WaitingBotCheck } from "@/components/bot-check-frequency";
import type { SupabaseClient } from "@supabase/supabase-js";
import { grokBotPastePrompt } from "./house-setup";
import { supabaseBotCheckStatus } from "./supabase/repo";
import type { BallotRequestStatus, BotCheckIntervalHours } from "./types";
import {
  BOT_CHECK_ADAPTIVE_LABEL,
  BOT_CHECK_ADAPTIVE_SUB,
  BOT_CHECK_EVERY_3_HOURS,
  BOT_CHECK_EVERY_6_HOURS,
  BOT_CHECK_EVERY_HOUR,
  BOT_CHECK_HELPER,
  BOT_CHECK_NOW_HINT,
  BOT_CHECK_NOW_LABEL,
  BOT_CHECK_SECTION_LABEL,
  BOT_CHECK_WAITING_ADAPTIVE,
  BOT_WORK_REASONS,
  botCheckChoiceFromSetting,
  botCheckSettingFromChoice,
  botCheckUpdateColumns,
  botCheckWrite,
  ORDER_STALE_MS,
  botCheckForSnapshot,
  buildBotOrder,
  deriveBotCheckStatus,
  preferBotCheckStatus,
  fixedWaitingCadenceLine,
  normalizeBotCheckSetting,
  orderWorkDue,
  waitingCadenceLine,
  type BotCheckStatus,
  type BotWorkMeal,
} from "./bot-check";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const srcRoot = path.resolve(import.meta.dirname, "..");

const PLATES = [4, 4, 4, 4, 4, 0, 0];

function status(overrides: {
  mode?: unknown;
  intervalHours?: unknown;
  setupComplete?: boolean;
  ballotStatus?: BallotRequestStatus | null;
  ballotHouseholdSize?: number | null;
  ballotNightHeadcounts?: number[] | null;
  householdSize?: number;
  nightHeadcounts?: number[];
  meals?: BotWorkMeal[];
  fillPending?: boolean;
  optionNightsNeeded?: number;
} = {}): BotCheckStatus {
  return deriveBotCheckStatus({
    mode: "adaptive",
    intervalHours: null,
    setupComplete: true,
    ballotStatus: null,
    ballotHouseholdSize: null,
    ballotNightHeadcounts: null,
    householdSize: 4,
    nightHeadcounts: PLATES,
    meals: [],
    ...overrides,
  });
}

describe("bot check cadence defaults", () => {
  it("defaults new and unknown rows to adaptive with a null interval", () => {
    expect(normalizeBotCheckSetting(undefined, undefined)).toEqual({
      mode: "adaptive",
      intervalHours: null,
    });
    expect(normalizeBotCheckSetting("adaptive", 6)).toEqual({
      mode: "adaptive",
      intervalHours: null,
    });
    expect(normalizeBotCheckSetting("weekly", 3)).toEqual({
      mode: "adaptive",
      intervalHours: null,
    });
    expect(normalizeBotCheckSetting("fixed", 3)).toEqual({ mode: "fixed", intervalHours: 3 });
    expect(normalizeBotCheckSetting("fixed", "1")).toEqual({ mode: "fixed", intervalHours: 1 });
    expect(normalizeBotCheckSetting("fixed", 2)).toEqual({ mode: "adaptive", intervalHours: null });
  });

  it("prefers pending work on a planning week over a settled cooking week", () => {
    const idle = deriveBotCheckStatus({
      mode: "adaptive",
      intervalHours: null,
      setupComplete: true,
      ballotStatus: "fulfilled",
      ballotHouseholdSize: 4,
      ballotNightHeadcounts: PLATES,
      householdSize: 4,
      nightHeadcounts: PLATES,
      meals: [],
    });
    const pending = deriveBotCheckStatus({
      mode: "adaptive",
      intervalHours: null,
      setupComplete: true,
      ballotStatus: "pending",
      ballotHouseholdSize: 4,
      ballotNightHeadcounts: PLATES,
      householdSize: 4,
      nightHeadcounts: PLATES,
      meals: [],
    });
    expect(idle.needs_work).toBe(false);
    expect(preferBotCheckStatus([idle, pending])).toMatchObject({
      needs_work: true,
      reason: "pending_ballot",
      cadence: { interval_hours: 1, phase: "active" },
    });
  });

  it("uses 1h while adaptive work or setup is open, and 6h when the week is settled", () => {
    expect(status().cadence).toEqual({ mode: "adaptive", interval_hours: 6, phase: "idle" });
    expect(status().needs_work).toBe(false);
    expect(status().reason).toBe("idle");
    expect(status({ setupComplete: false }).cadence).toEqual({
      mode: "adaptive",
      interval_hours: 1,
      phase: "active",
    });
    expect(status({ ballotStatus: "pending" }).cadence.interval_hours).toBe(1);
  });

  it("keeps a fixed 1, 3, or 6 hour override on both quiet and busy wakes", () => {
    for (const hours of [1, 3, 6] as const) {
      expect(status({ mode: "fixed", intervalHours: hours }).cadence).toEqual({
        mode: "fixed",
        interval_hours: hours,
        phase: "idle",
      });
      expect(
        status({ mode: "fixed", intervalHours: hours, ballotStatus: "pending" }).cadence,
      ).toEqual({
        mode: "fixed",
        interval_hours: hours,
        phase: "active",
      });
    }
    expect(botCheckWrite("adaptive", 6)).toEqual({ mode: "adaptive", intervalHours: null });
    expect(botCheckWrite("fixed", 6)).toEqual({ mode: "fixed", intervalHours: 6 });
    expect(() => botCheckWrite("fixed", null)).toThrow(/1, 3, or 6/);
    expect(botCheckUpdateColumns({})).toEqual({});
    expect(botCheckUpdateColumns({ botCheckMode: "adaptive", botCheckIntervalHours: null })).toEqual({
      bot_check_mode: "adaptive",
      bot_check_interval_hours: null,
    });
    expect(botCheckSettingFromChoice("3")).toEqual({
      botCheckMode: "fixed",
      botCheckIntervalHours: 3,
    });
    expect(botCheckChoiceFromSetting("adaptive", null)).toBe("adaptive");
    expect(botCheckChoiceFromSetting("fixed", 1)).toBe("1");
  });
});

describe("bot status needs_work reasons", () => {
  it("names the stable reasons", () => {
    expect(BOT_WORK_REASONS).toEqual([
      "pending_ballot",
      "options_pending",
      "meal_pending",
      "plate_or_people_change",
      "portion_pending",
      "fill_pending",
      "order_pending",
      "setup_incomplete",
      "idle",
    ]);
  });

  it("reports pending ballot, meal, portion, and plate or people changes", () => {
    expect(status({ ballotStatus: "pending", setupComplete: false })).toMatchObject({
      needs_work: true,
      reason: "pending_ballot",
    });

    const swap: BotWorkMeal = { lifecycle: "swapped", servings: 4, expectedServings: 4 };
    expect(status({ meals: [swap] })).toMatchObject({ needs_work: true, reason: "meal_pending" });
    expect(
      status({
        meals: [{ lifecycle: "request_new_meal", servings: 0, expectedServings: 4 }],
      }).reason,
    ).toBe("meal_pending");

    expect(
      status({
        meals: [{ lifecycle: "passive", servings: 2, expectedServings: 4 }],
      }),
    ).toMatchObject({ needs_work: true, reason: "portion_pending" });

    expect(
      status({
        ballotStatus: "fulfilled",
        ballotHouseholdSize: 2,
        ballotNightHeadcounts: [2, 2, 2, 2, 2, 0, 0],
        householdSize: 4,
        meals: [{ lifecycle: "passive", servings: 2, expectedServings: 4 }],
      }),
    ).toMatchObject({ needs_work: true, reason: "plate_or_people_change" });
  });

  it("stays quiet once a plate change is already applied, and during setup with nothing to fulfill", () => {
    expect(
      status({
        ballotStatus: "fulfilled",
        ballotHouseholdSize: 2,
        ballotNightHeadcounts: [2, 2, 2, 2, 2, 0, 0],
        meals: [{ lifecycle: "proposed", servings: 4, expectedServings: 4 }],
      }),
    ).toMatchObject({ needs_work: false, reason: "idle" });

    expect(status({ setupComplete: false })).toMatchObject({
      needs_work: false,
      reason: "setup_incomplete",
    });
    expect(JSON.stringify(status())).not.toMatch(/price|smith/i);
  });

  it("wakes after lock when recipes or the shopping list are still empty", () => {
    const gap = status({ fillPending: true });
    expect(gap).toMatchObject({
      needs_work: true,
      reason: "fill_pending",
      cadence: { mode: "adaptive", interval_hours: 1, phase: "active" },
    });
    expect(waitingCadenceLine(gap, { pendingWorkOnly: true })).toBe(BOT_CHECK_WAITING_ADAPTIVE);
    const waitingHtml = renderToStaticMarkup(
      createElement(WaitingBotCheck, { status: gap, pendingWorkOnly: true, wakeConfigured: false }),
    );
    expect(waitingHtml).not.toContain("Checks about every hour");
    expect(waitingHtml).toContain("Check now");
    expect(status({ fillPending: true, setupComplete: false }).reason).toBe("fill_pending");
    expect(status({ fillPending: true, ballotStatus: "pending" }).reason).toBe("pending_ballot");
    expect(status({ ballotStatus: "pending", optionNightsNeeded: 3 }).reason).toBe("pending_ballot");
    expect(
      status({
        optionNightsNeeded: 1,
        meals: [{ lifecycle: "swapped", servings: 4, expectedServings: 4 }],
      }).reason,
    ).toBe("options_pending");
    expect(
      status({
        fillPending: true,
        meals: [{ lifecycle: "passive", servings: 2, expectedServings: 4 }],
      }).reason,
    ).toBe("portion_pending");
    expect(JSON.stringify(gap)).not.toMatch(/price|smith/i);

    const household = {
      botCheckMode: "adaptive" as const,
      botCheckIntervalHours: null,
      setupStep: 8,
      householdSize: 4,
      nightHeadcounts: PLATES,
      coupleNights: [5, 6],
      familySize: 4,
      coupleSize: 2,
    };
    const dinner = {
      id: "m1",
      title: "Lemon roast chicken",
      servings: 4,
      nightDate: "2026-09-28",
    };
    const ingredient = { id: "i1", name: "Chicken", quantity: 1, unit: "lb", storeId: "store" };
    const readyRecipe = {
      id: "r1",
      mealId: "m1",
      servings: 4,
      prepMinutes: 10,
      cookMinutes: 20,
      steps: ["Roast the chicken."],
      ingredients: [ingredient],
    };
    const base = {
      household,
      meals: [dinner],
      votes: [],
      memberships: [],
    };

    expect(
      botCheckForSnapshot({ ...base, week: { status: "locked" }, recipes: [], shoppingList: null }),
    ).toMatchObject({ needs_work: true, reason: "fill_pending" });
    expect(
      botCheckForSnapshot({
        ...base,
        week: { status: "locked" },
        recipes: [{ ...readyRecipe, steps: ["  "] }],
        shoppingList: { items: [{ id: "item" }] },
      }),
    ).toMatchObject({ needs_work: true, reason: "fill_pending" });
    expect(
      botCheckForSnapshot({
        ...base,
        week: { status: "locked" },
        recipes: [readyRecipe],
        shoppingList: { items: [] },
      }),
    ).toMatchObject({ needs_work: true, reason: "fill_pending" });
    expect(
      botCheckForSnapshot({
        ...base,
        week: { status: "voting" },
        recipes: [],
        shoppingList: null,
      }),
    ).toMatchObject({ needs_work: false, reason: "idle" });

    const choiceWeek = {
      id: "week-choice",
      status: "voting" as const,
      startsOn: "2026-10-04",
      ballotMode: "choice3" as const,
      finalizedAt: null,
      nightHeadcounts: PLATES,
      editableFrom: null,
    };
    const option = (dayIndex: number, rank: number) => ({
      id: `o-${dayIndex}-${rank}`,
      householdId: "house",
      weekId: "week-choice",
      dayIndex,
      nightDate: "2026-10-04",
      rank,
      title: `Dish ${dayIndex}-${rank}`,
      pitch: "",
      servings: 4,
      prepMinutes: 30,
      recipeKey: null,
    });
    const three = (dayIndex: number) => [1, 2, 3].map((rank) => option(dayIndex, rank));
    expect(
      botCheckForSnapshot({
        ...base,
        meals: [],
        ballotRequest: { status: "fulfilled", householdSize: 4, nightHeadcounts: PLATES },
        week: choiceWeek,
        options: [...three(0), ...three(1), ...three(2), ...three(3)],
        optionRequests: [
          {
            id: "req-4",
            weekId: "week-choice",
            dayIndex: 4,
            requestedBy: "mem",
            note: "Too heavy, want tacos",
            status: "pending",
          },
        ],
      }),
    ).toMatchObject({
      needs_work: true,
      reason: "options_pending",
      work: {
        week_id: "week-choice",
        starts_on: "2026-10-04",
        ballot_mode: "choice3",
        nights: [
          {
            day_index: 4,
            night_date: "2026-10-08",
            plates: 4,
            need: "new_options",
            note: "Too heavy, want tacos",
          },
        ],
      },
    });
    expect(
      botCheckForSnapshot({
        ...base,
        meals: [],
        ballotRequest: { status: "pending", householdSize: 4, nightHeadcounts: PLATES },
        week: choiceWeek,
        options: [],
        optionRequests: [],
      }).work?.nights?.map((night) => night.need),
    ).toEqual(["options", "options", "options", "options", "options"]);
    expect(
      botCheckForSnapshot({
        ...base,
        week: { status: "locked" },
        recipes: [readyRecipe],
        shoppingList: { items: [{ id: "item" }] },
      }),
    ).toMatchObject({ needs_work: false, reason: "idle" });
    expect(
      botCheckForSnapshot({
        ...base,
        week: { status: "locked" },
        recipes: [{ ...readyRecipe, ingredients: [] }],
        shoppingList: { items: [] },
      }),
    ).toMatchObject({ needs_work: false, reason: "idle" });
    expect(
      botCheckForSnapshot({
        ...base,
        meals: [{ ...dinner, title: "Skipped pasta" }],
        votes: [
          {
            id: "v1",
            householdId: "h",
            mealId: "m1",
            membershipId: "mem",
            choice: "remove",
            note: "",
            updatedAt: "2026-09-27T00:00:00.000Z",
          },
        ],
        memberships: [
          {
            id: "mem",
            householdId: "h",
            userId: "user",
            role: "owner",
            displayName: "Ada",
            email: "ada@example.com",
          },
        ],
        week: { status: "locked" },
        recipes: [],
        shoppingList: { items: [] },
      }),
    ).toMatchObject({ needs_work: false, reason: "idle" });
  });
});

describe("H-E-B order work", () => {
  const now = new Date("2026-10-06T22:00:00.000Z");
  const order = buildBotOrder({
    listId: "list-1",
    status: "approved",
    resume: false,
    storeName: "H-E-B",
    storeSlug: "h-e-b",
    postalCode: "76177",
    checkoutMode: "review",
    maxTotalCents: 30000,
    delivery: null,
    items: [
      {
        item_id: "item-1",
        name: "Chicken thighs",
        quantity: 2,
        unit: "lb",
        note: null,
        source: "recipe",
      },
    ],
  });
  const household = {
    botCheckMode: "adaptive" as const,
    botCheckIntervalHours: null,
    setupStep: 8,
    householdSize: 4,
    nightHeadcounts: PLATES,
    coupleNights: [5, 6],
    familySize: 4,
    coupleSize: 2,
  };
  const readyRecipe = {
    id: "r1",
    mealId: "m1",
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    steps: ["Roast the chicken."],
    ingredients: [{ id: "i1", name: "Chicken", quantity: 1, unit: "lb", storeId: "store" }],
  };

  it("treats an approved list as order_pending and a fresh cart as idle", () => {
    expect(orderWorkDue({ status: "approved", orderStatusAt: null, now })).toEqual({
      due: true,
      resume: false,
    });
    expect(
      orderWorkDue({
        status: "carting",
        orderStatusAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
        now,
      }),
    ).toEqual({ due: false, resume: false });
    expect(
      orderWorkDue({
        status: "carting",
        orderStatusAt: new Date(now.getTime() - ORDER_STALE_MS).toISOString(),
        now,
      }),
    ).toEqual({ due: false, resume: false });
    expect(
      orderWorkDue({
        status: "carting",
        orderStatusAt: new Date(now.getTime() - ORDER_STALE_MS - 60 * 1000).toISOString(),
        now,
      }),
    ).toEqual({ due: true, resume: true });
    expect(orderWorkDue({ status: "carting", orderStatusAt: null, now })).toEqual({
      due: false,
      resume: false,
    });

    const base = {
      household,
      meals: [{ id: "m1", title: "Lemon roast chicken", servings: 4, nightDate: "2026-10-05" }],
      votes: [],
      memberships: [],
      week: { id: "week-1", status: "locked" as const, startsOn: "2026-10-04", ballotMode: "choice3" as const },
      recipes: [readyRecipe],
      shoppingList: { items: [{ id: "item" }] },
    };
    expect(botCheckForSnapshot(base)).toMatchObject({ needs_work: false, reason: "idle" });
    const pending = botCheckForSnapshot({ ...base, order });
    expect(pending).toMatchObject({ needs_work: true, reason: "order_pending" });
    expect(pending.work?.order).toMatchObject({
      list_id: "list-1",
      status: "approved",
      resume: false,
      checkout_mode: "review",
      max_total_cents: 30000,
      delivery: null,
      store: { name: "H-E-B", slug: "h-e-b", postal_code: "76177", site: "https://www.heb.com" },
    });
    const filling = botCheckForSnapshot({ ...base, recipes: [], shoppingList: null, order });
    expect(filling.reason).toBe("fill_pending");
    expect(filling.work?.order).toBeUndefined();
    expect(
      deriveBotCheckStatus({
        mode: "adaptive",
        intervalHours: null,
        setupComplete: true,
        ballotStatus: "fulfilled",
        ballotHouseholdSize: 4,
        ballotNightHeadcounts: PLATES,
        householdSize: 4,
        nightHeadcounts: PLATES,
        meals: [],
        orderPending: true,
      }).reason,
    ).toBe("order_pending");
  });
});

describe("Settings and Waiting copy lock", () => {
  it("matches the UX PASS strings", () => {
    expect(BOT_CHECK_SECTION_LABEL).toBe("Bot check frequency");
    expect(BOT_CHECK_HELPER).toBe("How often Bot My Meals looks for updates from your Bot.");
    expect(BOT_CHECK_ADAPTIVE_LABEL).toBe("Adaptive (recommended)");
    expect(BOT_CHECK_ADAPTIVE_SUB).toBe(
      "Every hour while you\u2019re setting up or waiting; every 6 hours when nothing is waiting.",
    );
    expect(BOT_CHECK_EVERY_HOUR).toBe("Every hour");
    expect(BOT_CHECK_EVERY_3_HOURS).toBe("Every 3 hours");
    expect(BOT_CHECK_EVERY_6_HOURS).toBe("Every 6 hours");
    expect(BOT_CHECK_NOW_LABEL).toBe("Check now");
    expect(BOT_CHECK_NOW_HINT).toBe(
      "Message your Bot My Meals Grok Bot and ask it to sync. This isn\u2019t a push from the app.",
    );
    expect(BOT_CHECK_WAITING_ADAPTIVE).toBe("Checks about every hour while you\u2019re waiting.");
    expect(fixedWaitingCadenceLine(1)).toBe("Checks every 1 hour.");
    expect(fixedWaitingCadenceLine(3)).toBe("Checks every 3 hours.");
    expect(fixedWaitingCadenceLine(6)).toBe("Checks every 6 hours.");
  });

  it("shows a cadence line only while waiting work is active", () => {
    const adaptiveWaiting = status({ ballotStatus: "pending" });
    expect(waitingCadenceLine(adaptiveWaiting)).toBe(BOT_CHECK_WAITING_ADAPTIVE);
    expect(waitingCadenceLine(status())).toBeNull();
    expect(waitingCadenceLine(status({ setupComplete: false }))).toBe(BOT_CHECK_WAITING_ADAPTIVE);
    expect(waitingCadenceLine(status({ setupComplete: false }), { pendingWorkOnly: true })).toBeNull();

    const fixed = status({ mode: "fixed", intervalHours: 3 as BotCheckIntervalHours, ballotStatus: "pending" });
    expect(waitingCadenceLine(fixed)).toBe("Checks every 3 hours.");
    expect(waitingCadenceLine(fixed)).not.toBe(BOT_CHECK_WAITING_ADAPTIVE);
  });

  it("renders Check now on Waiting without a cadence line", () => {
    const waitingHtml = renderToStaticMarkup(
      createElement(WaitingBotCheck, {
        status: status({ ballotStatus: "pending" }),
        checkNowWhenIdle: true,
        wakeConfigured: false,
      }),
    );
    expect(waitingHtml).not.toContain("Checks about every hour");
    expect(waitingHtml).not.toContain("Adaptive");
    expect(waitingHtml).not.toContain("Every hour");
    expect(waitingHtml).toContain("Check now");
    expect(waitingHtml).toContain("This isn\u2019t a push from the app.");

    const settledHtml = renderToStaticMarkup(
      createElement(WaitingBotCheck, {
        status: status(),
        pendingWorkOnly: true,
        wakeConfigured: false,
      }),
    );
    expect(settledHtml).toBe("");

    const fixedHtml = renderToStaticMarkup(
      createElement(WaitingBotCheck, {
        status: status({ mode: "fixed", intervalHours: 6, ballotStatus: "pending" }),
        wakeConfigured: false,
      }),
    );
    expect(fixedHtml).not.toContain("Checks every 6 hours.");
    expect(fixedHtml).not.toContain("Checks about every hour");
    expect(fixedHtml).not.toContain("Next check");

    const webhookOn = renderToStaticMarkup(
      createElement(WaitingBotCheck, {
        status: status({ ballotStatus: "pending" }),
        wakeConfigured: true,
      }),
    );
    expect(webhookOn).toContain("Check now");
    expect(webhookOn).not.toContain("Checks about every hour");
    expect(webhookOn).not.toContain("Checks every");
    expect(webhookOn).not.toContain("Next check");
    expect(webhookOn).not.toContain("Every hour");
    expect(webhookOn).not.toContain("every 6 hours");
    expect(webhookOn).toContain("Wakes your Bot My Meals bot now.");
  });

  it("keeps Check now off a frequency control and out of setup", () => {
    const settings = readFileSync(path.join(srcRoot, "app/settings/page.tsx"), "utf8");
    const week = readFileSync(path.join(srcRoot, "app/week/page.tsx"), "utf8");
    const card = readFileSync(path.join(srcRoot, "components/bot-check-frequency.tsx"), "utf8");
    const wakeSettings = readFileSync(path.join(srcRoot, "components/bot-wake-settings.tsx"), "utf8");
    const wake = readFileSync(path.join(srcRoot, "components/use-bot-wake.ts"), "utf8");
    const wizard = readFileSync(path.join(srcRoot, "components/setup-wizard.tsx"), "utf8");
    const setupPage = readFileSync(path.join(srcRoot, "app/setup/page.tsx"), "utf8");

    expect(settings).toContain("BotWakeSettings");
    expect(settings).not.toContain("BotCheckFrequency");
    expect(settings).not.toContain("bot-check-frequency");
    expect(wakeSettings).toContain("BotCheckNow");
    expect(week).toContain("WaitingBotCheck");
    expect(week).toContain("waiting-for-bot");
    expect(week).toContain("EMPTY_WEEK_WAITING_TITLE");
    expect(card).not.toContain('role="radiogroup"');
    expect(card).not.toContain("BOT_CHECK_SECTION_LABEL");
    expect(card).not.toContain("bot-check-cadence");
    expect(card).toContain("BOT_CHECK_NOW_HINT");
    expect(card).not.toContain("Force sync");
    expect(card).not.toMatch(/APNs|Instant push|phone push/);
    expect(card).not.toContain("fetch(");
    expect(wake).toContain("BOT_WAKE_SOFT_FAIL");
    expect(wake).not.toMatch(/APNs|Instant push|phone push/);
    expect(card).not.toContain("WeeklyBudgetField");
    expect(wizard).not.toContain("bot-check-frequency");
    expect(wizard).not.toContain("BotCheckFrequency");
    expect(setupPage).not.toContain("BotCheckFrequency");
    expect(settings).not.toContain("Force sync");
    expect(week).not.toContain("Force sync");
  });
});

describe("bot check migration and shared-bot docs", () => {
  it("stores adaptive by default and a nullable 1/3/6 interval on the household", () => {
    const sql = readFileSync(
      path.join(repoRoot, "supabase/migrations/20260927040000_bot_check_cadence.sql"),
      "utf8",
    );
    expect(sql).toMatch(/bot_check_mode text not null default 'adaptive'/);
    expect(sql).toMatch(/bot_check_interval_hours smallint/);
    expect(sql).toMatch(/bot_check_mode = 'adaptive' and bot_check_interval_hours is null/);
    expect(sql).toMatch(/bot_check_mode = 'fixed' and bot_check_interval_hours in \(1, 3, 6\)/);
    expect(sql).toMatch(/households_member_read/);
    expect(sql).toMatch(/households_owner_update/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/to anon/i);
    expect(sql).not.toMatch(/service_role/i);
  });

  it("tells a shared bot to wake and fulfill needs_work without an hour schedule", () => {
    const docs = readFileSync(path.join(repoRoot, "docs/bot-routines.md"), "utf8");
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
    const agents = readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
    const route = readFileSync(path.join(srcRoot, "app/api/bot/status/route.ts"), "utf8");
    const paste = grokBotPastePrompt({
      householdName: "Our house",
      nightHeadcounts: PLATES,
      storeNames: ["Harmons"],
      weeklyBudgetCents: null,
    });

    expect(docs).toMatch(/Wake on app event/);
    expect(docs).toMatch(/required before Create this week's meals/);
    expect(docs).not.toMatch(/@every/);
    expect(docs).not.toMatch(/Adaptive/);
    expect(docs).not.toMatch(/Bot check frequency/);
    expect(docs).toMatch(/\/api\/bot\/status/);
    expect(docs).toMatch(/needs_work/);
    expect(docs).toMatch(/fill_pending/);
    expect(docs).toMatch(/options_pending/);
    expect(docs).toMatch(/submit_week_options/);
    expect(docs).toMatch(/stay silent/i);
    expect(docs).toMatch(/Never invent grocery prices/);
    expect(docs).not.toMatch(/Force sync/);
    expect(readme).toMatch(/Wake on app event/);
    expect(readme).toMatch(/do (?:\*\*)?not(?:\*\*)? create Adaptive/i);
    expect(readme).not.toMatch(/House → Bot check frequency/);
    expect(readme).not.toMatch(/silent backend fallback/);
    expect(readme).not.toMatch(/about every hour while/);
    expect(readme).not.toMatch(/every 6 hours when the week is settled/);
    expect(agents).toMatch(/docs\/bot-routines\.md/);
    expect(paste).toMatch(/required before Create this week's meals/);
    expect(paste).not.toMatch(/Adaptive/i);
    expect(paste).not.toMatch(/@every/);
    expect(paste).not.toMatch(/Bot check frequency/);
    expect(paste).not.toMatch(/silent backend fallback/);
    expect(paste).toMatch(/\/api\/bot\/status/);
    expect(paste).toMatch(/stay silent/i);
    expect(paste).not.toContain("dual-approve");
    expect(route).toContain("export async function GET");
    expect(route).toContain("createSupabaseForRequest");
    expect(route).toContain("supabaseBotCheckStatus");
    expect(route).not.toMatch(/service.role/i);
    expect(route).not.toContain("Force sync");
  });
});

type QueryResult = { data: unknown; error: { message: string } | null };

function query(result: QueryResult, onSelect?: (columns: string) => void) {
  const builder = {
    select(columns: string) {
      onSelect?.(columns);
      return builder;
    },
    eq() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    in() {
      return builder;
    },
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
    then(onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function statusClient(input: {
  user?: { id: string } | null;
  membership?: { household_id: string } | null;
  household?: Record<string, unknown> | null;
  week?: { id: string; status?: string; starts_on?: string; ballot_mode?: string } | null;
  mealOptions?: Array<Record<string, unknown>>;
  optionRequests?: Array<Record<string, unknown>>;
  ballot?: Record<string, unknown> | null;
  meals?: Array<Record<string, unknown>>;
  recipes?: Array<Record<string, unknown>>;
  ingredients?: Array<Record<string, unknown>>;
  shoppingList?: { id: string } | null;
  shoppingItems?: Array<Record<string, unknown>>;
  selects: string[];
}): SupabaseClient {
  let membershipReads = 0;
  const record = (table: string) => (columns: string) => input.selects.push(`${table}:${columns}`);
  return {
    auth: {
      getUser: async () => ({ data: { user: input.user === undefined ? { id: "user-1" } : input.user } }),
    },
    from(table: string) {
      if (table === "recipes") return query({ data: input.recipes ?? [], error: null }, record(table));
      if (table === "recipe_ingredients") {
        return query({ data: input.ingredients ?? [], error: null }, record(table));
      }
      if (table === "shopping_lists") {
        return query({ data: input.shoppingList ?? null, error: null }, record(table));
      }
      if (table === "shopping_items") {
        return query({ data: input.shoppingItems ?? [], error: null }, record(table));
      }
      if (table === "memberships") {
        membershipReads += 1;
        const data = membershipReads === 1 ? (input.membership === undefined ? { household_id: "hid" } : input.membership) : [];
        return query({ data, error: null });
      }
      if (table === "households") {
        return query(
          {
            data: input.household ?? {
              bot_check_mode: "adaptive",
              bot_check_interval_hours: null,
              setup_step: 8,
              household_size: 4,
              night_headcounts: PLATES,
              couple_nights: [5, 6],
              family_size: 4,
              couple_size: 2,
            },
            error: null,
          },
          (columns) => input.selects.push(`households:${columns}`),
        );
      }
      if (table === "weeks") {
        return query(
          { data: input.week === undefined ? { id: "week-1" } : input.week, error: null },
          record(table),
        );
      }
      if (table === "ballot_requests") return query({ data: input.ballot ?? null, error: null });
      if (table === "meals") return query({ data: input.meals ?? [], error: null });
      if (table === "votes") return query({ data: [], error: null });
      if (table === "meal_options") {
        return query({ data: input.mealOptions ?? [], error: null }, record(table));
      }
      if (table === "meal_option_requests") {
        return query({ data: input.optionRequests ?? [], error: null }, record(table));
      }
      if (table === "household_stores") {
        return query({ data: [], error: null }, record(table));
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("supabaseBotCheckStatus", () => {
  it("requires a household member and returns a small adaptive idle body", async () => {
    const selects: string[] = [];
    await expect(
      supabaseBotCheckStatus(statusClient({ user: null, selects })),
    ).resolves.toEqual({ ok: false, error: "unauthorized" });

    await expect(
      supabaseBotCheckStatus(statusClient({ membership: null, selects })),
    ).resolves.toEqual({ ok: false, error: "no_household" });

    const idle = await supabaseBotCheckStatus(statusClient({ selects }));
    expect(idle).toEqual({
      ok: true,
      body: {
        needs_work: false,
        reason: "idle",
        cadence: { mode: "adaptive", interval_hours: 6, phase: "idle" },
      },
    });
    expect(selects.some((columns) => columns.includes("bot_check_mode"))).toBe(true);
    expect(selects.some((columns) => columns.includes("*"))).toBe(false);
    expect(selects.some((columns) => columns.startsWith("recipes:"))).toBe(false);
    expect(selects.some((columns) => columns.startsWith("shopping_"))).toBe(false);
    expect(selects.some((columns) => columns.startsWith("recipe_ingredients:"))).toBe(false);
  });

  it("flags a pending ballot and keeps a fixed interval on a quiet wake", async () => {
    const pending = await supabaseBotCheckStatus(
      statusClient({
        selects: [],
        ballot: {
          status: "pending",
          household_size: 4,
          night_headcounts: PLATES,
        },
      }),
    );
    expect(pending).toMatchObject({
      ok: true,
      body: {
        needs_work: true,
        reason: "pending_ballot",
        cadence: { mode: "adaptive", interval_hours: 1, phase: "active" },
      },
    });

    const fixed = await supabaseBotCheckStatus(
      statusClient({
        selects: [],
        household: {
          bot_check_mode: "fixed",
          bot_check_interval_hours: 3,
          setup_step: 8,
          household_size: 4,
          night_headcounts: PLATES,
          couple_nights: [5, 6],
          family_size: 4,
          couple_size: 2,
        },
      }),
    );
    expect(fixed).toMatchObject({
      ok: true,
      body: {
        needs_work: false,
        reason: "idle",
        cadence: { mode: "fixed", interval_hours: 3, phase: "idle" },
      },
    });
  });

  it("reports fill_pending after lock when recipes or the list are empty, and idle once both are ready", async () => {
    const dinner = {
      id: "m1",
      title: "Lemon roast chicken",
      servings: 4,
      night_date: "2026-09-28",
    };
    const lockedWeek = { id: "week-1", status: "locked" };

    const missingSelects: string[] = [];
    const missing = await supabaseBotCheckStatus(
      statusClient({ selects: missingSelects, week: lockedWeek, meals: [dinner] }),
    );
    expect(missing).toMatchObject({
      ok: true,
      body: {
        needs_work: true,
        reason: "fill_pending",
        cadence: { mode: "adaptive", interval_hours: 1, phase: "active" },
      },
    });
    expect(missingSelects).toContain("recipes:id, meal_id, steps");
    expect(missingSelects).toContain("shopping_lists:id");
    expect(missingSelects.some((columns) => columns.startsWith("recipe_ingredients:"))).toBe(false);
    expect(missingSelects.some((columns) => columns.includes("*"))).toBe(false);
    expect(JSON.stringify(missing)).not.toMatch(/price|smith/i);

    const emptyListSelects: string[] = [];
    const emptyList = await supabaseBotCheckStatus(
      statusClient({
        selects: emptyListSelects,
        week: lockedWeek,
        meals: [dinner],
        recipes: [{ id: "r1", meal_id: "m1", steps: ["Roast the chicken."] }],
        ingredients: [{ recipe_id: "r1" }],
        shoppingList: { id: "list-1" },
        shoppingItems: [],
      }),
    );
    expect(emptyList).toMatchObject({
      ok: true,
      body: { needs_work: true, reason: "fill_pending" },
    });
    expect(emptyListSelects).toContain("shopping_items:id");

    const votingSelects: string[] = [];
    const voting = await supabaseBotCheckStatus(
      statusClient({
        selects: votingSelects,
        week: { id: "week-1", status: "voting" },
        meals: [dinner],
      }),
    );
    expect(voting).toMatchObject({ ok: true, body: { needs_work: false, reason: "idle" } });
    expect(votingSelects.some((columns) => columns.startsWith("recipes:"))).toBe(false);

    const ready = await supabaseBotCheckStatus(
      statusClient({
        selects: [],
        week: lockedWeek,
        meals: [dinner],
        recipes: [{ id: "r1", meal_id: "m1", steps: ["Roast the chicken."] }],
        ingredients: [{ recipe_id: "r1" }],
        shoppingList: { id: "list-1" },
        shoppingItems: [{ id: "item-1" }],
      }),
    );
    expect(ready).toMatchObject({
      ok: true,
      body: {
        needs_work: false,
        reason: "idle",
        cadence: { mode: "adaptive", interval_hours: 6, phase: "idle" },
      },
    });
    expect(JSON.stringify(ready)).not.toMatch(/price|smith/i);

    const nothingToBuy = await supabaseBotCheckStatus(
      statusClient({
        selects: [],
        week: lockedWeek,
        meals: [dinner],
        recipes: [{ id: "r1", meal_id: "m1", steps: ["Heat and serve."] }],
        ingredients: [],
        shoppingList: { id: "list-1" },
        shoppingItems: [],
      }),
    );
    expect(nothingToBuy).toMatchObject({
      ok: true,
      body: { needs_work: false, reason: "idle" },
    });
  });

  it("lists choice3 option gaps with narrow selects and skips those tables on a single week", async () => {
    const selects: string[] = [];
    const body = await supabaseBotCheckStatus(
      statusClient({
        selects,
        week: {
          id: "week-1",
          status: "voting",
          starts_on: "2026-10-04",
          ballot_mode: "choice3",
        },
        ballot: { status: "fulfilled", household_size: 4, night_headcounts: PLATES },
        mealOptions: [{ day_index: 0 }, { day_index: 0 }, { day_index: 0 }],
        optionRequests: [{ day_index: 1, note: "Want tacos" }],
      }),
    );
    expect(body).toMatchObject({
      ok: true,
      body: {
        needs_work: true,
        reason: "options_pending",
        work: { ballot_mode: "choice3", week_id: "week-1" },
      },
    });
    expect(selects).toContain(
      "weeks:id, status, starts_on, ballot_mode, finalized_at, night_headcounts, editable_from",
    );
    expect(selects).toContain("meal_options:day_index");
    expect(selects).toContain("meal_option_requests:day_index, note");
    expect(selects.some((columns) => columns.includes("*"))).toBe(false);

    const singleSelects: string[] = [];
    await supabaseBotCheckStatus(statusClient({ selects: singleSelects }));
    expect(singleSelects.some((columns) => columns.startsWith("meal_options:"))).toBe(false);
    expect(singleSelects.some((columns) => columns.startsWith("meal_option_requests:"))).toBe(false);
  });
});
