import { addDays, formatWeekRange, weekdayIndexFromDate } from "./dates";
import { saturdayOfWeek } from "./meal-history";
import type { HouseholdSnapshot, WeekRole, WeekScope, WeekStatus } from "./types";

export const THIS_WEEK_LABEL = "This week";
export const NEXT_WEEK_LABEL = "Next week";
export const PLAN_NEXT_WEEK_LABEL = "Plan next week";

export type DatedWeek = {
  startsOn: string | null;
  status: WeekStatus;
};

export function weekStartOn(todayIso: string, weekStartsOn: number): string {
  const day = weekdayIndexFromDate(todayIso);
  const diff = (day - weekStartsOn + 7) % 7;
  return addDays(todayIso, -diff);
}

export function weekIsFinished(week: DatedWeek, today: string): boolean {
  if (week.status !== "locked" || !week.startsOn) return false;
  return today > saturdayOfWeek(week.startsOn);
}

/**
 * Cooking is the house's calendar week when that row exists.
 * Planning is exactly seven days after cooking, and only when that row is still open.
 * A week further out is ignored — the cap is one cooking week and one planning week.
 */
export function splitOpenWeeks<T extends DatedWeek>(
  weeks: readonly T[],
  today: string,
  weekStartsOn: number,
): { cooking: T | null; planning: T | null } {
  const cookingStart = weekStartOn(today, weekStartsOn);
  const open = weeks.filter((week) => !weekIsFinished(week, today));
  const dated = open.filter((week) => week.startsOn);
  const undated = open.filter((week) => !week.startsOn);

  const datedBefore = dated
    .filter((week) => week.startsOn != null && week.startsOn <= cookingStart)
    .sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""));
  const datedAsc = [...dated].sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""));

  const cooking =
    dated.find((week) => week.startsOn === cookingStart) ??
    datedBefore[0] ??
    undated[0] ??
    datedAsc[0] ??
    null;

  if (!cooking?.startsOn) {
    return { cooking, planning: null };
  }

  const nextStart = addDays(cooking.startsOn, 7);
  const planning = dated.find((week) => week !== cooking && week.startsOn === nextStart) ?? null;
  return { cooking, planning };
}

export function cookingScope(snapshot: HouseholdSnapshot): WeekScope {
  return {
    week: snapshot.week,
    meals: snapshot.meals,
    votes: snapshot.votes,
    recipes: snapshot.recipes,
    shoppingList: snapshot.shoppingList,
    ballotRequest: snapshot.ballotRequest ?? null,
    options: snapshot.options,
    picks: snapshot.picks,
    submissions: snapshot.submissions,
    optionRequests: snapshot.optionRequests,
  };
}

export function scopeForRole(snapshot: HouseholdSnapshot, role: WeekRole): WeekScope {
  switch (role) {
    case "planning":
      return snapshot.planning ?? cookingScope(snapshot);
    case "cooking":
      return cookingScope(snapshot);
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

export function scopeForMeal(
  snapshot: HouseholdSnapshot,
  mealId: string,
): { role: WeekRole; scope: WeekScope } | null {
  if (snapshot.meals.some((meal) => meal.id === mealId)) {
    return { role: "cooking", scope: cookingScope(snapshot) };
  }
  if (snapshot.planning?.meals.some((meal) => meal.id === mealId)) {
    return { role: "planning", scope: snapshot.planning };
  }
  return null;
}

/** Saved Request always aims at the planning week, creating that start when the row is missing. */
export function planningTargetStarts(snapshot: Pick<HouseholdSnapshot, "week" | "planning">): string {
  return snapshot.planning?.week.startsOn ?? addDays(snapshot.week.startsOn, 7);
}

export function weekHomeTitle(role: WeekRole): string {
  switch (role) {
    case "cooking":
      return THIS_WEEK_LABEL;
    case "planning":
      return NEXT_WEEK_LABEL;
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

export function shoppingListTitle(role: WeekRole): string {
  switch (role) {
    case "cooking":
      return "Shopping · This week";
    case "planning":
      return "Shopping · Next week";
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

/**
 * Names the week on Waiting when both weeks are open.
 * Next week always carries its range. This week only when a planning week exists too.
 */
export function waitingWeekCue(
  role: WeekRole,
  startsOn: string,
  options?: { bothOpen?: boolean },
): string | null {
  switch (role) {
    case "cooking":
      if (!options?.bothOpen) return null;
      return `This week · ${formatWeekRange(startsOn)}`;
    case "planning":
      return `Next week · ${formatWeekRange(startsOn)}`;
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}
