import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PostLockWaitingCard, RecipePendingNotice } from "@/components/post-lock-waiting";
import {
  POST_LOCK_BOT_CHECK_SETTINGS,
  POST_LOCK_GET_RECIPES_HINT,
  POST_LOCK_GET_RECIPES_LABEL,
  POST_LOCK_WAITING_BODY,
  POST_LOCK_WAITING_TITLE,
  RECIPE_PENDING_BODY,
  RECIPE_PENDING_HINT,
  RECIPE_PENDING_TITLE,
  dinnerRecipeReady,
  isPendingBotFill,
  lockedDinnerTap,
  nightShowsRecipePending,
  type PendingBotFillInput,
} from "./post-lock-waiting";
import type { Meal, Membership, Recipe, ShoppingItem, Vote } from "./types";

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
    isLeftovers: false,
    leftoverOfMealId: null,
    estimatedCostCents: null,
    estimatedCostSource: null,
    estimatedCostAsOf: null,
    sourceOptionId: null,
  };
}

function recipe(mealId: string, steps: string[], ingredientCount = 1): Recipe {
  return {
    id: `r-${mealId}`,
    mealId,
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    steps,
    ingredients: Array.from({ length: ingredientCount }, (_, index) => ({
      id: `ing-${mealId}-${index}`,
      name: "Onion",
      quantity: 1,
      unit: "ct",
      storeId: "store",
    })),
  };
}

const voter: Membership = {
  id: "mem",
  householdId: "h",
  userId: "user",
  role: "owner",
  displayName: "Ada",
  email: "ada@example.com",
};

function removeVote(mealId: string): Vote {
  return {
    id: `v-${mealId}`,
    householdId: "h",
    mealId,
    membershipId: voter.id,
    choice: "remove",
    note: "",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

const grocery = { id: "item" } as ShoppingItem;

function fill(overrides: Partial<PendingBotFillInput> = {}): PendingBotFillInput {
  return {
    weekStatus: "locked",
    meals: [meal(0, "Lemon roast chicken")],
    votes: [],
    memberships: [voter],
    recipes: [],
    shoppingList: null,
    ...overrides,
  };
}

describe("pending bot fill", () => {
  it("waits after lock until every dinner has a recipe body and the list has items", () => {
    const dinners = [meal(0, "Lemon roast chicken"), meal(1, "Bean tacos")];
    expect(isPendingBotFill(fill({ weekStatus: "voting", meals: dinners }))).toBe(false);
    expect(isPendingBotFill(fill({ meals: dinners }))).toBe(true);
    expect(dinnerRecipeReady(dinners[0], [])).toBe(false);
    expect(dinnerRecipeReady(dinners[0], [recipe("m0", ["  "])])).toBe(false);

    const readyRecipes = [recipe("m0", ["Roast the chicken."]), recipe("m1", ["Warm the tortillas."])];
    expect(
      isPendingBotFill(fill({ meals: dinners, recipes: readyRecipes, shoppingList: null })),
    ).toBe(true);
    expect(
      isPendingBotFill(
        fill({ meals: dinners, recipes: readyRecipes, shoppingList: { items: [grocery] } }),
      ),
    ).toBe(false);
    expect(
      isPendingBotFill(
        fill({
          meals: dinners,
          recipes: [readyRecipes[0], recipe("m1", [])],
          shoppingList: { items: [grocery] },
        }),
      ),
    ).toBe(true);
  });

  it("treats an empty list as ready when no locked dinner needs groceries", () => {
    const dinners = [meal(0, "Leftover soup")];
    const stepsOnly = [recipe("m0", ["Heat and serve."], 0)];
    expect(isPendingBotFill(fill({ meals: dinners, recipes: stepsOnly, shoppingList: null }))).toBe(false);

    const removed = meal(1, "Skipped pasta");
    expect(
      isPendingBotFill(
        fill({
          meals: [dinners[0], removed],
          votes: [removeVote(removed.id)],
          recipes: stepsOnly,
          shoppingList: { items: [] },
        }),
      ),
    ).toBe(false);
  });

  it("opens a waiting sheet while pending and the real recipe once the bot has written it", () => {
    const dinners = [meal(0, "Lemon roast chicken"), meal(1, "Bean tacos")];
    const input = fill({
      meals: dinners,
      recipes: [recipe("m0", ["Roast the chicken."])],
      shoppingList: null,
    });
    expect(nightShowsRecipePending({ ...input, mealId: "m0" })).toBe(false);
    expect(nightShowsRecipePending({ ...input, mealId: "m1" })).toBe(true);
    expect(nightShowsRecipePending({ ...input, weekStatus: "voting", mealId: "m1" })).toBe(false);
    expect(lockedDinnerTap({ locked: true, pending: true, presentation: "ballot" })).toBe("waiting");
    expect(lockedDinnerTap({ locked: true, pending: false, presentation: "ballot" })).toBe("recipe");
    expect(lockedDinnerTap({ locked: true, pending: true, presentation: "locked_empty" })).toBe("none");
    expect(lockedDinnerTap({ locked: false, pending: false, presentation: "ballot" })).toBe("none");
  });
});

describe("post-lock waiting copy", () => {
  it("matches the lock and does not invent a cart, a price, or a push", () => {
    expect(POST_LOCK_WAITING_TITLE).toBe("Waiting for your Bot");
    expect(POST_LOCK_WAITING_BODY).toBe(
      "Recipes and your shopping list show up after your Bot My Meals bot runs.",
    );
    expect(POST_LOCK_GET_RECIPES_LABEL).toBe("Get recipes now");
    expect(POST_LOCK_GET_RECIPES_HINT).toBe(
      "Message your Bot My Meals Grok Bot and ask it to fill recipes and the shopping list for this week. This isn\u2019t a push from the app.",
    );
    expect(POST_LOCK_BOT_CHECK_SETTINGS).toBe("Bot check settings");
    expect(RECIPE_PENDING_TITLE).toBe("Waiting for your Bot");
    expect(RECIPE_PENDING_BODY).toBe("Your bot hasn\u2019t saved this recipe yet.");
    expect(RECIPE_PENDING_HINT).toBe(
      "Message your Bot My Meals Grok Bot and ask it to fill recipes for this week.",
    );

    const blob = [
      POST_LOCK_WAITING_TITLE,
      POST_LOCK_WAITING_BODY,
      POST_LOCK_GET_RECIPES_HINT,
      RECIPE_PENDING_BODY,
      RECIPE_PENDING_HINT,
    ]
      .join(" ")
      .toLowerCase();
    expect(blob).not.toContain("grandma");
    expect(blob).not.toContain("worker");
    expect(blob).not.toContain("cron");
    expect(blob).not.toContain("supabase");
    expect(blob).not.toContain("cart");
    expect(blob).not.toContain("$");
    expect(blob).not.toContain("no recipe was saved");
  });

  it("renders the waiting card and the recipe pending notice", () => {
    const card = renderToStaticMarkup(
      createElement(PostLockWaitingCard, { wakeConfigured: false }),
    );
    expect(card).toContain("Waiting for your Bot");
    expect(card).toContain("Recipes and your shopping list show up after your Bot My Meals bot runs.");
    expect(card).not.toContain("Checks about every hour");
    expect(card).not.toContain("Checks every");
    expect(card).not.toContain("Checks every 1 hour.");
    expect(card).not.toContain("Next check");
    expect(card).not.toContain("Next check in about");
    expect(card).not.toContain("Adaptive");
    expect(card).toContain("Get recipes now");
    expect(card).toContain("This isn\u2019t a push from the app.");
    expect(card).toContain('href="/settings#wake-your-bot"');
    expect(card).not.toContain('href="/settings#bot-check"');
    expect(card).not.toContain("Open shopping list");
    expect(card).not.toContain("See recipes");
    expect(card).not.toContain("No recipe was saved");

    const webhookOn = renderToStaticMarkup(
      createElement(PostLockWaitingCard, { wakeConfigured: true }),
    );
    expect(webhookOn).toContain("Waiting for your Bot");
    expect(webhookOn).toContain("Get recipes now");
    expect(webhookOn).toContain("Wakes your bot to fill recipes and the shopping list.");
    expect(webhookOn).toContain('href="/settings#wake-your-bot"');
    expect(webhookOn).toContain("Wake your Bot");
    expect(webhookOn).not.toContain("post-lock-cadence");
    expect(webhookOn).not.toContain("Checks about every hour");
    expect(webhookOn).not.toContain("Checks every");
    expect(webhookOn).not.toContain("Next check in about");
    expect(webhookOn).not.toContain("Adaptive");
    expect(webhookOn).not.toContain('href="/settings#bot-check"');

    const notice = renderToStaticMarkup(createElement(RecipePendingNotice));
    expect(notice).toContain("Your bot hasn\u2019t saved this recipe yet.");
    expect(notice).toContain("ask it to fill recipes for this week.");
    expect(notice).not.toContain("No recipe was saved");
  });

  it("wires This week, the night page, and the list to the pending flag", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const lockBar = readFileSync(path.join(root, "components/lock-bar.tsx"), "utf8");
    const week = readFileSync(path.join(root, "app/week/page.tsx"), "utf8");
    const meal = readFileSync(path.join(root, "app/week/[mealId]/page.tsx"), "utf8");
    const list = readFileSync(path.join(root, "app/list/page.tsx"), "utf8");
    const recipes = readFileSync(path.join(root, "app/recipes/page.tsx"), "utf8");
    const block = readFileSync(path.join(root, "components/recipe-view.tsx"), "utf8");

    const chrome = readFileSync(path.join(root, "components/week-chrome.tsx"), "utf8");

    expect(week).toContain("isPendingBotFill");
    expect(week).toContain("PostLockWaitingCard");
    expect(week).toContain('data-state="pending"');
    expect(chrome).toContain('data-slot="lock-success-list"');
    expect(chrome).toContain('data-slot="lock-success-recipes"');
    expect(lockBar).toContain('data-state="ready"');
    expect(lockBar).not.toContain("Open shopping list");
    expect(week).toContain("LockedNightFrame");
    expect(week).toContain("PostLockWaitingSheet");
    expect(week).toContain("lockedDinnerTap");
    expect(meal).toContain("RecipePendingNotice");
    expect(meal).toContain('backHref="/week"');
    expect(meal).toContain("weekHomeTitle(weekRole)");
    expect(meal).not.toContain("Back to This week");
    expect(meal).not.toContain('backLabel="This week"');
    expect(recipes).toContain("weekHomeTitle(role)");
    expect(recipes).not.toContain("Back to This week");
    expect(recipes).not.toContain('backLabel="This week"');
    expect(meal).toContain("<RecipeBlock recipe={recipe} servings={meal.servings} />");
    expect(meal).not.toContain("No recipe was saved for this night");
    expect(list).toContain("pendingFill && (!list || list.items.length === 0)");
    expect(list).toContain("LIST_NOTHING_TO_BUY");
    expect(recipes).toContain("PostLockWaitingCard");
    expect(recipes).toContain('data-slot="recipe-night"');
    expect(block).toContain("No recipe was saved for this night");
  });
});
