import { addDays, formatNightDate } from "./dates";
import { nightLifecycle } from "./lock";
import { instantOnCivilDate, todayInTimeZone } from "./meal-history";
import { dinnerRecipeReady } from "./post-lock-waiting";
import type { Meal, Membership, Recipe, SavedMeal, Vote, WeekStatus } from "./types";

export type { SavedMeal };

/** Three weeks after the last locked cook before a random re-suggest. */
export const SAVED_MEAL_COOLDOWN_WEEKS = 3;
export const SAVED_MEAL_COOLDOWN_DAYS = SAVED_MEAL_COOLDOWN_WEEKS * 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export const SAVED_MEALS_LABEL = "Saved meals";
export const SAVED_MEALS_ROW_SUB = "Meals your house kept for later";
export const SAVED_MEALS_HELPER =
  "Your bot may suggest these again after a break. Request one anytime for next week.";
export const SAVED_MEALS_EMPTY_TITLE = "No saved meals yet";
export const SAVED_MEALS_EMPTY_BODY =
  "Open a dinner\u2019s recipe and tap Save when you want it back later.";
export const SAVED_MEALS_EMPTY_BACK = "Back to This week";

export const SAVE_LABEL = "Save";
export const SAVED_LABEL = "Saved";
export const SAVE_TOAST = "Saved for your house.";
export const UNSAVE_TOAST = "Removed from saved.";
export const SAVE_WAIT_TIP = "Save when the recipe is ready.";

export const REQUEST_NEXT_WEEK_LABEL = "Request for next week";
export const REQUESTED_LABEL = "Requested";
export const REQUESTED_TOAST = "Requested for next week.";
export const ALREADY_REQUESTED_TOAST = "Already requested for next week.";
export const REMOVE_SAVED_LABEL = "Remove";

export type MealSaveAvailability = "ready" | "wait" | "hidden";

export type SavedMealBallotRole = "requested" | "pool" | "cooldown";

/**
 * Identity Meal Ops should copy onto `recipes.recipe_key` when re-proposing.
 * A stamped key wins. Otherwise the normalized title is the household meal key.
 */
export function mealRecipeKey(input: { title: string; recipeKey?: string | null }): string {
  const stamped = input.recipeKey?.trim();
  if (stamped) return stamped;
  return input.title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function savedMealForKey(meals: readonly SavedMeal[], recipeKey: string): SavedMeal | undefined {
  if (!recipeKey) return undefined;
  return meals.find((meal) => meal.recipeKey === recipeKey);
}

export function nextWeekStartsOn(currentWeekStartsOn: string): string {
  return addDays(currentWeekStartsOn, 7);
}

/** Outstanding request whose target week has not slipped behind the week on screen. */
export function savedMealRequestActive(
  meal: Pick<SavedMeal, "requestedForWeek">,
  currentWeekStartsOn: string,
): boolean {
  return Boolean(meal.requestedForWeek && meal.requestedForWeek >= currentWeekStartsOn);
}

export function savedMealInCooldown(lastLockedAt: string | null, now: Date): boolean {
  if (!lastLockedAt) return false;
  const locked = Date.parse(lastLockedAt);
  if (Number.isNaN(locked)) return false;
  return now.getTime() < locked + SAVED_MEAL_COOLDOWN_DAYS * DAY_MS;
}

/**
 * Random ballot sampling uses `pool` only.
 * `requested` bypasses cool-down for that target week.
 * `cooldown` stays out of the random pool (including a request aimed at another week).
 */
export function savedMealBallotRole(input: {
  lastLockedAt: string | null;
  requestedForWeek: string | null;
  targetWeekStartsOn: string;
  now: Date;
}): SavedMealBallotRole {
  if (input.requestedForWeek && input.requestedForWeek === input.targetWeekStartsOn) {
    return "requested";
  }
  if (input.requestedForWeek && input.requestedForWeek !== input.targetWeekStartsOn) {
    return "cooldown";
  }
  if (savedMealInCooldown(input.lastLockedAt, input.now)) return "cooldown";
  return "pool";
}

export function savedMealsForBallot<T extends Pick<SavedMeal, "lastLockedAt" | "requestedForWeek">>(
  meals: readonly T[],
  targetWeekStartsOn: string,
  now: Date,
): { requested: T[]; pool: T[] } {
  const requested: T[] = [];
  const pool: T[] = [];
  for (const meal of meals) {
    const role = savedMealBallotRole({
      lastLockedAt: meal.lastLockedAt,
      requestedForWeek: meal.requestedForWeek,
      targetWeekStartsOn,
      now,
    });
    switch (role) {
      case "requested":
        requested.push(meal);
        break;
      case "pool":
        pool.push(meal);
        break;
      case "cooldown":
        break;
      default: {
        const _exhaustive: never = role;
        return _exhaustive;
      }
    }
  }
  return { requested, pool };
}

/** Quiet manage-list badge. Null once the meal can be randomly suggested again. */
export function savedMealCooldownLabel(lastLockedAt: string | null, now: Date): string | null {
  if (!lastLockedAt || !savedMealInCooldown(lastLockedAt, now)) return null;
  const locked = Date.parse(lastLockedAt);
  const remainingMs = locked + SAVED_MEAL_COOLDOWN_DAYS * DAY_MS - now.getTime();
  const weeks = Math.max(1, Math.ceil(remainingMs / (7 * DAY_MS)));
  return `Available in ~${weeks} wk`;
}

const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;

/**
 * Last cooked is the dinner's night on a locked week, not the moment the week locked.
 * Stored at noon in the house timezone so a date-only night does not slip a day.
 * An unlocked save returns null and does not start cool-down.
 */
export function lastCookedAtForSave(input: {
  weekStatus: WeekStatus;
  nightDate: string;
  timeZone: string;
}): string | null {
  switch (input.weekStatus) {
    case "voting":
      return null;
    case "locked":
      return cookNightInstant(input.nightDate, input.timeZone);
    default: {
      const _exhaustive: never = input.weekStatus;
      return _exhaustive;
    }
  }
}

/** Noon on `nightDate` in `timeZone`. Null when the calendar date is not real. */
export function cookNightInstant(nightDate: string, timeZone: string): string | null {
  const match = DATE_ONLY.exec(nightDate.trim().slice(0, 10));
  if (!match) return null;
  const iso = match[1];
  const instant = instantOnCivilDate(iso, timeZone, 12, 0);
  if (Number.isNaN(instant.getTime())) return null;
  if (todayInTimeZone(instant, timeZone) !== iso) return null;
  return instant.toISOString();
}

export function savedMealWhenLine(meal: Pick<SavedMeal, "lastLockedAt" | "savedAt">, timeZone: string): string {
  if (meal.lastLockedAt) {
    return `Last cooked ${formatSavedInstant(meal.lastLockedAt, timeZone)}`;
  }
  return `Saved ${formatSavedInstant(meal.savedAt, timeZone)}`;
}

function formatSavedInstant(iso: string, timeZone: string): string {
  const trimmed = iso.trim();
  const dateOnly = DATE_ONLY.exec(trimmed);
  if (dateOnly) return formatNightDate(dateOnly[1]);
  const parsed = new Date(trimmed);
  const date = Number.isNaN(parsed.getTime()) ? trimmed.slice(0, 10) : todayInTimeZone(parsed, timeZone);
  return formatNightDate(date);
}

/** Recently saved first. Title breaks ties. */
export function sortSavedMeals(meals: readonly SavedMeal[]): SavedMeal[] {
  return [...meals].sort((a, b) => {
    const bySaved = b.savedAt.localeCompare(a.savedAt);
    if (bySaved !== 0) return bySaved;
    return a.title.localeCompare(b.title);
  });
}

export function mealSaveAvailability(input: {
  meal: Pick<Meal, "id" | "title">;
  votes: Vote[];
  memberships: Membership[];
  recipes: Recipe[];
}): MealSaveAvailability {
  const lifecycle = nightLifecycle(input.meal, input.votes, input.memberships);
  switch (lifecycle) {
    case "removed":
    case "request_new_meal":
      return "hidden";
    case "passive":
    case "proposed":
    case "swapped":
      if (!input.meal.title.trim()) return "hidden";
      return dinnerRecipeReady(input.meal, input.recipes) ? "ready" : "wait";
    default: {
      const _exhaustive: never = lifecycle;
      return _exhaustive;
    }
  }
}

function asDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export function parseSavedMeals(rows: unknown): SavedMeal[] {
  if (!Array.isArray(rows)) return [];
  const meals = rows.flatMap((row): SavedMeal[] => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const recipeKey = typeof record.recipe_key === "string" ? record.recipe_key.trim() : "";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!recipeKey || !title || record.id == null || record.household_id == null) return [];
    return [
      {
        id: String(record.id),
        householdId: String(record.household_id),
        recipeKey,
        title,
        savedAt: typeof record.saved_at === "string" ? record.saved_at : "",
        lastLockedAt: typeof record.last_locked_at === "string" ? record.last_locked_at : null,
        requestedForWeek: asDate(record.requested_for_week),
        sourceRecipeId: typeof record.source_recipe_id === "string" ? record.source_recipe_id : null,
      },
    ];
  });
  return sortSavedMeals(meals);
}
