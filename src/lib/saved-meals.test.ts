import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatNightDate } from "@/lib/dates";
import { todayInTimeZone } from "@/lib/meal-history";
import { emptyHousehold } from "@/lib/seed";
import {
  patchSavedMealAdded,
  patchSavedMealRemoved,
  patchSavedMealRequest,
} from "@/lib/optimistic";
import type { Membership, Recipe, Vote } from "@/lib/types";
import {
  ALREADY_REQUESTED_TOAST,
  REMOVE_SAVED_LABEL,
  REQUEST_NEXT_WEEK_LABEL,
  REQUESTED_LABEL,
  REQUESTED_TOAST,
  SAVE_LABEL,
  SAVE_TOAST,
  SAVE_WAIT_TIP,
  SAVED_LABEL,
  SAVED_MEAL_COOLDOWN_DAYS,
  SAVED_MEALS_EMPTY_BODY,
  SAVED_MEALS_EMPTY_TITLE,
  SAVED_MEALS_HELPER,
  SAVED_MEALS_LABEL,
  SAVED_MEALS_ROW_SUB,
  UNSAVE_TOAST,
  cookNightInstant,
  lastCookedAtForSave,
  mealRecipeKey,
  mealSaveAvailability,
  nextWeekStartsOn,
  parseSavedMeals,
  savedMealBallotRole,
  savedMealCooldownLabel,
  savedMealInCooldown,
  savedMealRequestActive,
  savedMealWhenLine,
  savedMealsForBallot,
  sortSavedMeals,
  type SavedMeal,
} from "@/lib/saved-meals";

const srcRoot = path.resolve(import.meta.dirname, "..");

function meal(partial: Partial<SavedMeal> & Pick<SavedMeal, "recipeKey" | "title">): SavedMeal {
  return {
    id: partial.recipeKey,
    householdId: "house",
    savedAt: partial.savedAt ?? "2026-09-01T00:00:00.000Z",
    lastLockedAt: partial.lastLockedAt ?? null,
    requestedForWeek: partial.requestedForWeek ?? null,
    sourceRecipeId: partial.sourceRecipeId ?? null,
    ...partial,
  };
}

describe("saved meal identity", () => {
  it("prefers a stamped recipe key and otherwise normalizes the title", () => {
    expect(mealRecipeKey({ title: "  Taco  Tuesday ", recipeKey: " recipe-9 " })).toBe("recipe-9");
    expect(mealRecipeKey({ title: "  Taco   Tuesday ", recipeKey: "  " })).toBe("taco tuesday");
    expect(mealRecipeKey({ title: "Chili" })).toBe("chili");
  });
});

describe("saved meal cool-down", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");

  it("waits 21 days after the last locked cook and not after the save tap", () => {
    expect(SAVED_MEAL_COOLDOWN_DAYS).toBe(21);
    const justLocked = new Date(now.getTime() - 60_000).toISOString();
    expect(savedMealInCooldown(justLocked, now)).toBe(true);
    expect(savedMealCooldownLabel(justLocked, now)).toBe("Available in ~3 wk");

    const twentyDays = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
    expect(savedMealInCooldown(twentyDays, now)).toBe(true);

    const twentyOneDays = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString();
    expect(savedMealInCooldown(twentyOneDays, now)).toBe(false);
    expect(savedMealCooldownLabel(twentyOneDays, now)).toBeNull();
    expect(savedMealInCooldown(null, now)).toBe(false);
  });

  it("lets a request for the target week bypass cool-down", () => {
    const locked = now.toISOString();
    expect(
      savedMealBallotRole({
        lastLockedAt: locked,
        requestedForWeek: "2026-10-04",
        targetWeekStartsOn: "2026-10-04",
        now,
      }),
    ).toBe("requested");
    expect(
      savedMealBallotRole({
        lastLockedAt: null,
        requestedForWeek: null,
        targetWeekStartsOn: "2026-10-04",
        now,
      }),
    ).toBe("pool");
    expect(
      savedMealBallotRole({
        lastLockedAt: locked,
        requestedForWeek: null,
        targetWeekStartsOn: "2026-10-04",
        now,
      }),
    ).toBe("cooldown");
    expect(
      savedMealBallotRole({
        lastLockedAt: null,
        requestedForWeek: "2026-10-11",
        targetWeekStartsOn: "2026-10-04",
        now,
      }),
    ).toBe("cooldown");
  });

  it("splits a ballot into requested and random pool", () => {
    const rows = [
      meal({ recipeKey: "chili", title: "Chili", lastLockedAt: now.toISOString(), requestedForWeek: "2026-10-04" }),
      meal({ recipeKey: "tacos", title: "Tacos", lastLockedAt: null }),
      meal({ recipeKey: "stew", title: "Stew", lastLockedAt: now.toISOString() }),
    ];
    const split = savedMealsForBallot(rows, "2026-10-04", now);
    expect(split.requested.map((row) => row.recipeKey)).toEqual(["chili"]);
    expect(split.pool.map((row) => row.recipeKey)).toEqual(["tacos"]);
  });
});

describe("saved meal list", () => {
  it("sorts recently saved first and shows last cooked, else saved date", () => {
    const rows = sortSavedMeals([
      meal({ recipeKey: "a", title: "A", savedAt: "2026-09-01T00:00:00.000Z" }),
      meal({ recipeKey: "b", title: "B", savedAt: "2026-09-20T00:00:00.000Z" }),
    ]);
    expect(rows.map((row) => row.recipeKey)).toEqual(["b", "a"]);
    expect(
      savedMealWhenLine(
        meal({
          recipeKey: "a",
          title: "A",
          lastLockedAt: "2026-09-14T19:00:00.000Z",
          savedAt: "2026-09-01T00:00:00.000Z",
        }),
        "America/Los_Angeles",
      ),
    ).toBe("Last cooked Sep 14");
    expect(
      savedMealWhenLine(
        meal({ recipeKey: "a", title: "A", savedAt: "2026-09-20T18:00:00.000Z" }),
        "America/Los_Angeles",
      ),
    ).toBe("Saved Sep 20");
  });

  it("shows the dinner night, not the day the week was locked", () => {
    const zone = "America/Los_Angeles";
    const night = "2026-09-29";
    const cooked = lastCookedAtForSave({
      weekStatus: "locked",
      nightDate: night,
      timeZone: zone,
    });
    const sundayLock = "2026-09-27T22:00:00.000Z";

    expect(lastCookedAtForSave({ weekStatus: "voting", nightDate: night, timeZone: zone })).toBeNull();
    expect(cooked).toBe(cookNightInstant(night, zone));
    expect(cooked).not.toBeNull();
    expect(todayInTimeZone(new Date(cooked ?? ""), zone)).toBe(night);
    expect(
      savedMealWhenLine(
        meal({ recipeKey: "sausage", title: "Sheet-pan sausage & peppers", lastLockedAt: cooked, savedAt: sundayLock }),
        zone,
      ),
    ).toBe(`Last cooked ${formatNightDate(night)}`);
    expect(
      savedMealWhenLine(
        meal({ recipeKey: "sausage", title: "Sheet-pan sausage & peppers", lastLockedAt: sundayLock }),
        zone,
      ),
    ).toBe("Last cooked Sep 27");

    // UTC midnight of the night is the previous evening in Pacific. Do not store that.
    expect(todayInTimeZone(new Date("2026-09-29T00:00:00.000Z"), zone)).toBe("2026-09-28");
    expect(savedMealWhenLine(meal({ recipeKey: "sausage", title: "Sausage", lastLockedAt: night }), zone)).toBe(
      "Last cooked Sep 29",
    );

    for (const boundary of ["America/New_York", "Pacific/Honolulu", "Pacific/Auckland"]) {
      const instant = cookNightInstant(night, boundary);
      expect(instant).not.toBeNull();
      expect(todayInTimeZone(new Date(instant ?? ""), boundary)).toBe(night);
      expect(
        savedMealWhenLine(meal({ recipeKey: "sausage", title: "Sausage", lastLockedAt: instant }), boundary),
      ).toBe("Last cooked Sep 29");
    }

    for (const dstNight of ["2026-03-08", "2026-11-01"]) {
      const instant = cookNightInstant(dstNight, zone);
      expect(todayInTimeZone(new Date(instant ?? ""), zone)).toBe(dstNight);
      expect(
        savedMealWhenLine(meal({ recipeKey: "sausage", title: "Sausage", lastLockedAt: instant }), zone),
      ).toBe(`Last cooked ${formatNightDate(dstNight)}`);
    }

    expect(cookNightInstant("2026-02-31", zone)).toBeNull();
    expect(lastCookedAtForSave({ weekStatus: "locked", nightDate: "nope", timeZone: zone })).toBeNull();
  });

  it("keeps one household row and clears a request on remove", () => {
    const base = emptyHousehold("House", {
      id: "user-1",
      email: "a@example.com",
      displayName: "Alex",
    });
    const added = patchSavedMealAdded(base, meal({ recipeKey: "chili", title: "Chili", requestedForWeek: null }));
    const again = patchSavedMealAdded(added, meal({ recipeKey: "chili", title: "Chili night" }));
    expect(again.savedMeals).toHaveLength(1);
    expect(again.savedMeals[0]?.title).toBe("Chili night");
    const requested = patchSavedMealRequest(again, "chili", "2026-10-04");
    expect(requested.savedMeals[0]?.requestedForWeek).toBe("2026-10-04");
    expect(patchSavedMealRemoved(requested, "chili").savedMeals).toEqual([]);
  });

  it("parses rows and ignores junk", () => {
    expect(
      parseSavedMeals([
        {
          id: "1",
          household_id: "h",
          recipe_key: "chili",
          title: "Chili",
          saved_at: "2026-09-02T00:00:00.000Z",
          last_locked_at: null,
          requested_for_week: "2026-10-04",
          source_recipe_id: "r1",
        },
        { title: "" },
      ]),
    ).toEqual([
      {
        id: "1",
        householdId: "h",
        recipeKey: "chili",
        title: "Chili",
        savedAt: "2026-09-02T00:00:00.000Z",
        lastLockedAt: null,
        requestedForWeek: "2026-10-04",
        sourceRecipeId: "r1",
      },
    ]);
    expect(parseSavedMeals(null)).toEqual([]);
  });

  it("treats a request as active until that week is behind the one on screen", () => {
    expect(nextWeekStartsOn("2026-09-28")).toBe("2026-10-05");
    expect(savedMealRequestActive({ requestedForWeek: "2026-10-05" }, "2026-09-28")).toBe(true);
    expect(savedMealRequestActive({ requestedForWeek: "2026-09-28" }, "2026-09-28")).toBe(true);
    expect(savedMealRequestActive({ requestedForWeek: "2026-09-21" }, "2026-09-28")).toBe(false);
    expect(savedMealRequestActive({ requestedForWeek: null }, "2026-09-28")).toBe(false);
  });
});

describe("save availability", () => {
  const voters: Membership[] = [
    {
      id: "mem",
      householdId: "h",
      userId: "u",
      role: "voter",
      displayName: "Sam",
      email: "s@example.com",
    },
  ];

  function vote(choice: Vote["choice"]): Vote {
    return {
      id: "v",
      householdId: "h",
      mealId: "m",
      membershipId: "mem",
      choice,
      note: "",
      updatedAt: "2026-09-28T00:00:00.000Z",
    };
  }

  const readyRecipe: Recipe = {
    id: "r",
    mealId: "m",
    servings: 2,
    prepMinutes: 10,
    cookMinutes: 20,
    steps: ["Simmer."],
    ingredients: [],
  };

  it("is ready only when the recipe has steps", () => {
    const night = { id: "m", title: "Chili" };
    expect(
      mealSaveAvailability({ meal: night, votes: [], memberships: voters, recipes: [readyRecipe] }),
    ).toBe("ready");
    expect(
      mealSaveAvailability({ meal: night, votes: [], memberships: voters, recipes: [] }),
    ).toBe("wait");
    expect(
      mealSaveAvailability({
        meal: night,
        votes: [vote("remove")],
        memberships: voters,
        recipes: [readyRecipe],
      }),
    ).toBe("hidden");
    expect(
      mealSaveAvailability({
        meal: night,
        votes: [vote("request_new_meal")],
        memberships: voters,
        recipes: [readyRecipe],
      }),
    ).toBe("hidden");
  });
});

describe("saved meals surfaces", () => {
  it("locks the household copy", () => {
    expect(SAVED_MEALS_LABEL).toBe("Saved meals");
    expect(SAVED_MEALS_ROW_SUB).toBe("Meals your house kept for later");
    expect(SAVED_MEALS_HELPER).toBe(
      "Your bot may suggest these again after a break. Request one anytime for next week.",
    );
    expect(SAVED_MEALS_EMPTY_TITLE).toBe("No saved meals yet");
    expect(SAVED_MEALS_EMPTY_BODY).toBe(
      "Open a dinner\u2019s recipe and tap Save when you want it back later.",
    );
    expect(SAVE_LABEL).toBe("Save");
    expect(SAVED_LABEL).toBe("Saved");
    expect(SAVE_TOAST).toBe("Saved for your house.");
    expect(UNSAVE_TOAST).toBe("Removed from saved.");
    expect(SAVE_WAIT_TIP).toBe("Save when the recipe is ready.");
    expect(REQUEST_NEXT_WEEK_LABEL).toBe("Request for next week");
    expect(REQUESTED_LABEL).toBe("Requested");
    expect(REQUESTED_TOAST).toBe("Requested for next week.");
    expect(ALREADY_REQUESTED_TOAST).toBe("Already requested for next week.");
    expect(REMOVE_SAVED_LABEL).toBe("Remove");
  });

  it("puts Save on meal detail and the list under House, not on week cards or Past weeks", () => {
    const detail = readFileSync(path.join(srcRoot, "app/week/[mealId]/page.tsx"), "utf8");
    const week = readFileSync(path.join(srcRoot, "app/week/page.tsx"), "utf8");
    const card = readFileSync(path.join(srcRoot, "components/ballot-card.tsx"), "utf8");
    const night = readFileSync(path.join(srcRoot, "components/night-card.tsx"), "utf8");
    const settings = readFileSync(path.join(srcRoot, "app/settings/page.tsx"), "utf8");
    const listPage = readFileSync(path.join(srcRoot, "app/settings/saved/page.tsx"), "utf8");
    const list = readFileSync(path.join(srcRoot, "components/saved-meals.tsx"), "utf8");
    const history = readFileSync(path.join(srcRoot, "components/past-weeks.tsx"), "utf8");
    const shell = readFileSync(path.join(srcRoot, "components/app-shell.tsx"), "utf8");
    const shopping = readFileSync(path.join(srcRoot, "app/list/page.tsx"), "utf8");

    expect(detail).toContain("SaveMealControl");
    expect(detail).toContain("toggleSavedMeal");
    expect(detail).toContain("SAVE_TOAST");
    expect(detail).toContain("UNSAVE_TOAST");
    expect(week).not.toContain("SaveMealControl");
    expect(week).not.toContain('data-slot="save-meal"');
    expect(card).not.toContain("SaveMealControl");
    expect(night).not.toContain("SaveMealControl");
    expect(history).not.toContain("SaveMealControl");
    expect(shopping).not.toContain("SaveMealControl");
    expect(shell.match(/href: "\//g)).toHaveLength(4);

    expect(settings).toContain('data-slot="saved-meals-row"');
    expect(settings).toContain('href="/settings/saved"');
    expect(settings).toContain("SAVED_MEALS_LABEL");
    expect(settings).toContain('data-slot="past-weeks-row"');
    expect(listPage).toContain('backHref="/settings"');
    expect(listPage).toContain('backLabel="House"');
    expect(list).toContain("SAVED_MEALS_EMPTY_TITLE");
    expect(list).toContain("SAVED_MEALS_EMPTY_BODY");
    expect(list).toContain('data-slot="saved-meal-request"');
    expect(list).toContain('data-slot="saved-meal-remove"');
    expect(list).toContain("SAVED_MEALS_HELPER");

    const ui = `${detail}\n${settings}\n${listPage}\n${list}`;
    expect(ui).not.toMatch(/grandma/i);
    expect(ui).not.toMatch(/instacart|add to cart|\$\d/i);
  });

  it("stores the pool for household voters and wires requests into the ballot propose path", () => {
    const migration = readFileSync(
      path.resolve(import.meta.dirname, "../../supabase/migrations/20260928183000_saved_meals.sql"),
      "utf8",
    );
    const repo = readFileSync(path.join(srcRoot, "lib/supabase/repo.ts"), "utf8");
    const provider = readFileSync(path.join(srcRoot, "components/supper-provider.tsx"), "utf8");
    const cookNight = readFileSync(
      path.resolve(import.meta.dirname, "../../supabase/migrations/20260930040000_saved_meal_cook_night.sql"),
      "utf8",
    );
    const readme = readFileSync(path.resolve(import.meta.dirname, "../../README.md"), "utf8");
    const docs = readFileSync(path.resolve(import.meta.dirname, "../../docs/saved-meals.md"), "utf8");

    expect(migration).toContain("create table if not exists public.saved_meals");
    expect(migration).toContain("recipe_key text not null");
    expect(migration).toContain("saved_at timestamptz not null");
    expect(migration).toContain("last_locked_at timestamptz");
    expect(migration).toContain("requested_for_week date");
    expect(migration).toContain("unique (household_id, recipe_key)");
    expect(migration).toContain("saved_meals_member_read");
    expect(migration).toContain("saved_meals_voter_write");
    expect(migration).toContain("m.role in ('owner', 'voter')");
    expect(migration).toContain("interval '21 days'");
    expect(migration).toContain("saved_recipe_keys");
    expect(migration).toContain("saved_pool_keys");
    expect(migration).toContain("public.saved_meal_pool");
    expect(migration).toContain("function public.request_week_ballot()");
    expect(migration).toContain("weeks_stamp_saved_meals");
    expect(migration).not.toMatch(/grandma/i);

    expect(repo).toContain('from("saved_meals")');
    expect(repo).toContain("supabaseSaveMeal");
    expect(repo).toContain("supabaseRemoveSavedMeal");
    expect(repo).toContain("supabaseRequestSavedMeal");
    expect(provider).toContain("attachHouseholdLive");
    const live = readFileSync(path.join(srcRoot, "lib/household-live.ts"), "utf8");
    expect(live).toContain('"saved_meals"');
    expect(provider).toContain("toggleSavedMeal");
    expect(provider).toContain("lastCookedAtForSave");
    expect(provider).not.toContain("week.lockedAt");
    expect(cookNight).toContain("private.cook_night_instant");
    expect(cookNight).toContain("m.night_date");
    expect(cookNight).not.toContain("coalesce(new.locked_at, now())");
    expect(readme).toContain("20260928183000_saved_meals.sql");
    expect(readme).toContain("20260930040000_saved_meal_cook_night.sql");
    expect(readme).toContain("saved_meals");
    expect(docs).toContain("saved_recipe_keys");
    expect(docs).toContain("21 days");
    expect(docs).not.toMatch(/grandma/i);
  });
});
