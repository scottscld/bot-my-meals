import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WeekChromeView } from "@/components/week-chrome";
import { WeekStrip } from "@/components/week-strip";
import { UNLOCK_WEEK_CONFIRM } from "./lock-success";
import type { Meal, Vote } from "./types";
import {
  featuredMealEyebrow,
  nightHasStripMeal,
  nightStaysLocked,
  showFirstMealRow,
  showOpenShoppingList,
  stripCellMuted,
  upcomingDinner,
} from "./week-chrome";

const startsOn = "2026-09-27";
const nights = [
  { id: "sun", nightDate: "2026-09-27", hasMeal: true },
  { id: "mon", nightDate: "2026-09-28", hasMeal: true },
  { id: "tue", nightDate: "2026-09-29", hasMeal: true },
];

function meal(id: string, nightDate: string, title: string): Meal {
  return {
    id,
    householdId: "h",
    weekId: "w",
    dayIndex: 0,
    nightDate,
    title,
    pitch: "",
    audience: "family",
    servings: 4,
    prepMinutes: 20,
    isLeftovers: false,
    leftoverOfMealId: null,
    estimatedCostCents: null,
    estimatedCostSource: null,
    estimatedCostAsOf: null,
  };
}

describe("featured meal eyebrow", () => {
  it("uses Tonight’s meal when the featured night is today in the house timezone", () => {
    expect(featuredMealEyebrow("2026-09-30", "2026-09-30")).toBe("Tonight’s meal");
    expect(featuredMealEyebrow("2026-09-30", "2026-09-30")).not.toContain("·");
    expect(featuredMealEyebrow("2026-09-30", "2026-09-30")).not.toContain("Wednesday");
    expect(featuredMealEyebrow("2026-09-30", "2026-09-30")).not.toContain("First meal");
  });

  it("uses the full weekday and a curly apostrophe when the featured night is not today", () => {
    expect(featuredMealEyebrow("2026-10-01", "2026-09-30")).toBe("Thursday’s meal");
    expect(featuredMealEyebrow("2026-09-27", "2026-09-30")).toBe("Sunday’s meal");
    expect(featuredMealEyebrow("2026-10-03", "2026-09-30")).toBe("Saturday’s meal");
    expect(featuredMealEyebrow("2026-10-01", "2026-09-30")).not.toContain("Tonight");
    expect(featuredMealEyebrow("2026-10-01", "2026-09-30")).not.toContain("·");
    expect(featuredMealEyebrow("2026-10-01", "2026-09-30")).not.toContain("First meal");
    expect(featuredMealEyebrow("2026-10-01", "2026-09-30")).toContain("\u2019");
  });
});

describe("week chrome lock rules", () => {
  it("keeps past nights read-only after a mid-week unlock and locks every night while the week is locked", () => {
    expect(
      nightStaysLocked({ weekStatus: "locked", nightDate: "2026-09-29", editableFrom: null }),
    ).toBe(true);
    expect(
      nightStaysLocked({ weekStatus: "voting", nightDate: "2026-09-27", editableFrom: "2026-09-28" }),
    ).toBe(true);
    expect(
      nightStaysLocked({ weekStatus: "voting", nightDate: "2026-09-28", editableFrom: "2026-09-28" }),
    ).toBe(false);
    expect(
      nightStaysLocked({ weekStatus: "voting", nightDate: "2026-09-27", editableFrom: null }),
    ).toBe(false);
  });

  it("mutes past strip cells only after mid-week unlock", () => {
    expect(
      stripCellMuted({ weekStatus: "locked", nightDate: "2026-09-27", editableFrom: null }),
    ).toBe(false);
    expect(
      stripCellMuted({ weekStatus: "voting", nightDate: "2026-09-27", editableFrom: "2026-09-28" }),
    ).toBe(true);
    expect(
      stripCellMuted({ weekStatus: "voting", nightDate: "2026-09-28", editableFrom: "2026-09-28" }),
    ).toBe(false);
  });

  it("hides Open shopping list after done, dismiss, all checked, unlock, or an empty list", () => {
    const open = {
      weekStatus: "locked" as const,
      shoppingPrompt: "open" as const,
      pendingFill: false,
      items: [{ checked: false }],
    };
    expect(showOpenShoppingList(open)).toBe(true);
    expect(showOpenShoppingList({ ...open, shoppingPrompt: "done" })).toBe(false);
    expect(showOpenShoppingList({ ...open, shoppingPrompt: "dismissed" })).toBe(false);
    expect(showOpenShoppingList({ ...open, items: [{ checked: true }] })).toBe(false);
    expect(showOpenShoppingList({ ...open, weekStatus: "voting" })).toBe(false);
    expect(showOpenShoppingList({ ...open, items: [] })).toBe(false);
    expect(showOpenShoppingList({ ...open, pendingFill: true })).toBe(false);
  });

  it("advances the first meal after that night ends and hides when none remain", () => {
    const meals = [
      meal("sun", "2026-09-27", "Lemon roast chicken"),
      meal("mon", "2026-09-28", ""),
      meal("tue", "2026-09-29", "Tacos"),
    ];
    const removed: Vote[] = [
      {
        id: "v",
        householdId: "h",
        mealId: "sun",
        membershipId: "a",
        choice: "remove",
        note: "",
        updatedAt: "2026-09-27T00:00:00.000Z",
      },
    ];
    expect(upcomingDinner(meals, [], "2026-09-27")?.title).toBe("Lemon roast chicken");
    expect(upcomingDinner(meals, removed, "2026-09-27")?.title).toBe("Tacos");
    expect(upcomingDinner(meals, [], "2026-09-28")?.title).toBe("Tacos");
    expect(upcomingDinner(meals, [], "2026-09-30")).toBeUndefined();
    expect(nightHasStripMeal(meals[0], [])).toBe(true);
    expect(nightHasStripMeal(meals[1], [])).toBe(false);
    expect(nightHasStripMeal(meals[0], removed)).toBe(false);
    expect(
      nightHasStripMeal(meals[2], [
        {
          id: "swap",
          householdId: "h",
          mealId: "tue",
          membershipId: "a",
          choice: "swap",
          note: "",
          updatedAt: "2026-09-27T00:00:00.000Z",
        },
      ]),
    ).toBe(true);
    expect(
      nightHasStripMeal(meals[2], [
        {
          id: "add",
          householdId: "h",
          mealId: "tue",
          membershipId: "a",
          choice: "request_new_meal",
          note: "",
          updatedAt: "2026-09-27T00:00:00.000Z",
        },
      ]),
    ).toBe(false);
    expect(
      showFirstMealRow({
        weekStatus: "locked",
        pendingFill: false,
        meal: upcomingDinner(meals, [], "2026-09-29"),
      }),
    ).toBe(true);
    expect(
      showFirstMealRow({
        weekStatus: "voting",
        pendingFill: false,
        meal: upcomingDinner(meals, [], "2026-09-29"),
      }),
    ).toBe(false);
  });
});

describe("week chrome markup", () => {
  it("renders one locked chip path, equal strip cells, and stacked rows without a See recipes prefix", () => {
    const strip = renderToStaticMarkup(
      createElement(WeekStrip, {
        startsOn,
        nights,
        selectedMealId: "mon",
        todayIso: "2026-09-28",
        locked: true,
        mutedDates: ["2026-09-27"],
        onSelect: () => undefined,
      }),
    );
    expect(strip).toContain('data-locked="true"');
    expect(strip).toContain("h-[44px]");
    expect(strip).toContain("min-h-[44px]");
    expect(strip).toContain("min-w-[44px]");
    expect(strip).toContain("gap-2");
    expect(strip).toContain("py-1");
    expect(strip).not.toContain("py-3");
    expect(strip).not.toContain(">&nbsp;<");
    expect(strip).toContain('data-today="true"');
    expect(strip).toContain("bg-primary");
    expect(strip).toContain('data-past="true"');
    expect(strip).toContain("Sun · Sep 27, read only");
    expect(strip).not.toContain(", locked");
    expect(strip).not.toContain("<svg");

    const both = renderToStaticMarkup(
      createElement(WeekChromeView, {
        startsOn,
        nights,
        selectedMealId: "mon",
        todayIso: "2026-09-28",
        locked: true,
        mutedDates: [],
        showShoppingList: true,
        firstMeal: { id: "tue", title: "Lemon roast chicken", nightDate: "2026-09-29" },
        onSelect: () => undefined,
        onStep: () => false,
        planNext: null,
      }),
    );
    expect(both).toContain("Open shopping list");
    expect(both).toContain("Tuesday’s meal");
    expect(both).toContain("Lemon roast chicken");
    expect(both).toContain("text-white");
    expect(both).toContain("truncate");
    expect(both).toContain('href="/list"');
    expect(both).toContain('href="/week/tue"');
    expect(both.indexOf("Open shopping list")).toBeLessThan(both.indexOf("Tuesday’s meal"));
    expect(both).not.toContain("See recipes");
    expect(both).not.toContain("First meal");
    expect(both).not.toContain("Tonight");
    expect(both).not.toContain("Tuesday’s meal ·");

    const mealOnly = renderToStaticMarkup(
      createElement(WeekChromeView, {
        startsOn,
        nights,
        selectedMealId: null,
        todayIso: "2026-09-28",
        locked: true,
        mutedDates: [],
        showShoppingList: false,
        firstMeal: { id: "tue", title: "Tacos", nightDate: "2026-09-29" },
        onSelect: () => undefined,
        onStep: () => false,
        planNext: null,
      }),
    );
    expect(mealOnly).not.toContain("Open shopping list");
    expect(mealOnly).toContain("Tuesday’s meal");
    expect(mealOnly).toContain("Tacos");
    expect(mealOnly).not.toContain("First meal");
    expect(mealOnly).not.toContain("Tuesday’s meal ·");

    const tonight = renderToStaticMarkup(
      createElement(WeekChromeView, {
        startsOn,
        nights,
        selectedMealId: "mon",
        todayIso: "2026-09-28",
        locked: true,
        mutedDates: [],
        showShoppingList: false,
        firstMeal: { id: "mon", title: "Soup", nightDate: "2026-09-28" },
        onSelect: () => undefined,
        onStep: () => false,
        planNext: null,
      }),
    );
    expect(tonight).toContain("Tonight’s meal");
    expect(tonight).toContain("Soup");
    expect(tonight).not.toContain("Monday’s meal");
    expect(tonight).not.toContain("First meal");
    expect(tonight).not.toContain("Tonight’s meal ·");
  });

  it("puts Unlock week beside the Locked chip with a confirm spinner", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const control = readFileSync(path.join(root, "components/unlock-week-control.tsx"), "utf8");
    const week = readFileSync(path.join(root, "app/week/page.tsx"), "utf8");
    const list = readFileSync(path.join(root, "app/list/page.tsx"), "utf8");
    expect(UNLOCK_WEEK_CONFIRM).toBe("Unlock so you can edit what’s left?");
    expect(control).toContain("{UNLOCK_WEEK_CONFIRM}");
    expect(control).toContain('data-slot="week-locked-chip"');
    expect(control).toContain('data-slot="unlock-week"');
    expect(control).toContain("disabled={busy}");
    expect(control).toContain("animate-spin");
    expect(week).toContain('titleAside={locked ? <UnlockWeekControl variant="inline" /> : undefined}');
    expect(list).toContain('data-slot="done-shopping"');
    expect(list).toContain('data-slot="dismiss-shopping"');
    expect(list).toContain("closeShoppingPrompt");
    expect(list).not.toContain("cart");
  });
});
