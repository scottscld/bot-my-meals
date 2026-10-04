import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatWeekEyebrow } from "./dates";
import { headcountForNight } from "./headcount";
import { firstCookableMeal, recipeNightsForWeek } from "./recipes";
import { applySampleWeek, emptyHousehold } from "./seed";
import type { Meal, Vote } from "./types";

function meal(dayIndex: number, title: string): Meal {
  return {
    id: `m${dayIndex}`,
    householdId: "h",
    weekId: "w",
    dayIndex,
    nightDate: `2026-09-0${dayIndex + 1}`,
    title,
    pitch: "",
    audience: "family",
    servings: 4,
    prepMinutes: 30,
    isLeftovers: dayIndex === 3,
    leftoverOfMealId: dayIndex === 3 ? "m0" : null,
    estimatedCostCents: null,
    estimatedCostSource: null,
    estimatedCostAsOf: null,
    sourceOptionId: null,
  };
}

describe("recipeNightsForWeek", () => {
  it("keeps the full Sun–Sat ballot week, including Thursday and leftovers", () => {
    const snapshot = applySampleWeek(emptyHousehold("Test house"));
    const nights = recipeNightsForWeek(snapshot.meals);
    expect(nights).toHaveLength(7);
    expect(nights.map((item) => item.dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(nights[4]?.title).toBe("Spaghetti and meat sauce");
    expect(nights.some((item) => item.isLeftovers)).toBe(true);
  });

  it("does not drop nights when the input is unsorted", () => {
    const nights = recipeNightsForWeek([
      meal(4, "Thursday soup"),
      meal(0, "Sunday chicken"),
      meal(6, "Saturday pizza"),
    ]);
    expect(nights.map((item) => item.title)).toEqual([
      "Sunday chicken",
      "Thursday soup",
      "Saturday pizza",
    ]);
  });
});

describe("week eyebrow", () => {
  it("appends Locked after lock without extra coaching", () => {
    expect(formatWeekEyebrow("2026-09-07")).toBe("Sep 7 – Sep 13");
    expect(formatWeekEyebrow("2026-09-07", true)).toBe("Sep 7 – Sep 13 · Locked");
    expect(formatWeekEyebrow("2026-09-07", true).toLowerCase()).not.toContain("tap to");
  });
});

describe("firstCookableMeal", () => {
  it("omits removed nights and returns the first remaining dinner", () => {
    const meals = [meal(0, "Sunday"), meal(1, "Monday"), meal(2, "Tuesday")];
    const votes: Vote[] = [
      {
        id: "v",
        householdId: "h",
        mealId: "m0",
        membershipId: "a",
        choice: "remove",
        note: "",
        updatedAt: "2026-09-12T00:00:00.000Z",
      },
    ];
    expect(firstCookableMeal(meals, votes)?.title).toBe("Monday");
  });

  it("skips nights before today in the house timezone", () => {
    const meals = [meal(0, "Sunday"), meal(1, "Monday"), meal(2, "Tuesday")];
    expect(firstCookableMeal(meals, [], "2026-09-03")?.title).toBe("Tuesday");
    expect(firstCookableMeal(meals, [], "2026-09-04")).toBeUndefined();
  });
});

describe("people-per-night servings", () => {
  it("keeps sample-week servings on the household night headcounts", () => {
    const snapshot = applySampleWeek(emptyHousehold("Test house"));
    for (const meal of snapshot.meals) {
      expect(meal.servings).toBe(headcountForNight(snapshot.household, meal.nightDate));
    }
    expect(snapshot.meals[0]?.servings).toBe(4);
    expect(snapshot.meals[5]?.servings).toBe(2);
  });
});

describe("Clear Sky recipe craft", () => {
  it("keeps Sun–Sat nights and RecipeBlock on Clear Sky tokens", () => {
    const recipes = readFileSync(path.resolve(import.meta.dirname, "../app/recipes/page.tsx"), "utf8");
    const block = readFileSync(
      path.resolve(import.meta.dirname, "../components/recipe-view.tsx"),
      "utf8",
    );
    const meal = readFileSync(
      path.resolve(import.meta.dirname, "../app/week/[mealId]/page.tsx"),
      "utf8",
    );

    expect(recipes).toContain("recipeNightsForWeek");
    expect(recipes).toContain('data-slot="recipe-night"');
    expect(recipes).toContain('data-day={meal.dayIndex}');
    expect(recipes).toContain("bg-card-tint");
    expect(recipes).toContain("ring-2 ring-primary");
    expect(recipes).toContain('backHref="/week"');
    expect(block).toContain('data-slot="recipe-block"');
    expect(block).toContain('data-slot="recipe-servings"');
    expect(block).toContain("bg-secondary");
    expect(block).toContain("text-foreground");
    expect(block).toContain("{servings}");
    expect(block).toContain("font-mono");
    expect(meal).toContain("<RecipeBlock recipe={recipe} servings={meal.servings} />");
    expect(meal).toContain("EMPTY_DAY_TITLE");
    expect(meal).toContain("No action — dinner stands");
    expect(meal).toContain("The new dinner stands until someone swaps or removes it.");
    expect(meal).not.toContain("Night off");
    expect(meal).not.toContain("passively approved");
    expect(meal).not.toContain("You approved");
    expect(meal).not.toContain("Your vote needed");
    expect(block).not.toContain("#b35025");
    expect(block).not.toContain("Fraunces");
    expect(block).not.toContain("Clear Sky");
    expect(recipes).not.toContain("Clear Sky");
    expect(recipes).not.toContain("Blue & White");
    expect(recipes).toContain("RECIPES_PRE_LOCK_DESCRIPTION");
    expect(recipes).toContain("RECIPES_EMPTY_WEEK");
    expect(recipes).not.toContain("Seed a week");
    expect(recipes).toContain("removedMealIds");
    expect(recipes).toContain("EMPTY_DAY_TITLE");
    expect(recipes).not.toContain("skippedMealIds");
    expect(recipes).not.toContain("Night off");
    expect(recipes).not.toMatch(/approves or skips/i);
    expect(recipes).not.toContain("Approve");
    expect(recipes).not.toContain("You approved");
    expect(recipes).not.toContain("Your vote needed");
  });
});

