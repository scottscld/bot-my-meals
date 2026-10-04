import { addDays, WEEKDAY_LABELS, weekdayIndexFromDate } from "./dates";
import { clampNightHeadcount, normalizeNightHeadcounts } from "./headcount";
import { nightLifecycle } from "./lock";
import { nightStaysLocked } from "./week-chrome";
import type { Meal, Membership, Vote, WeekRole, WeekStatus } from "./types";

export const EDIT_NIGHTS_LABEL = "Edit nights";
export const EDIT_NIGHTS_CANCEL_LABEL = "Cancel";
export const EDIT_NIGHTS_SAVE_ERROR = "Couldn\u2019t save nights. Try again.";
export const EDIT_NIGHTS_ADDED_TOAST = "Saved. Add meals for the new nights when you\u2019re ready.";
export const HOUSE_PEOPLE_DEFAULTS_NOTE =
  "Used when you start a new week. To change nights on This week or Next week, open that week and tap Edit nights.";

export function turnOffDinnerConfirm(weekday: string): string {
  return `Turn off ${weekday}? Removes that dinner from this week.`;
}

export function turnOffChoiceNightConfirm(weekday: string): string {
  return `Turn off ${weekday}? That night\u2019s options go away.`;
}

/** Separate chrome control. The empty planning gate is already this form. */
export function showEditNightsEntry(input: {
  past: boolean;
  locked: boolean;
  canEdit: boolean;
  peopleGate: boolean;
}): boolean {
  return input.canEdit && !input.past && !input.locked && !input.peopleGate;
}

/** Planning weeks always. Cooking only when a week-scoped note is already stored. */
export function showWeekSpecialInstructions(input: {
  role: WeekRole;
  stored: string | null;
}): boolean {
  switch (input.role) {
    case "planning":
      return true;
    case "cooking":
      return Boolean(input.stored?.trim());
    default: {
      const _exhaustive: never = input.role;
      return _exhaustive;
    }
  }
}

/**
 * Saved week plates win. If this week has dinners but no saved plates yet,
 * use those servings. House defaults are only the prefill for a week with neither.
 */
export function prefillWeekHeadcounts(input: {
  saved: number[] | null;
  household: readonly number[];
  meals: readonly Pick<Meal, "nightDate" | "servings">[];
}): number[] {
  if (input.saved && input.saved.length === 7) return normalizeNightHeadcounts(input.saved);
  if (input.meals.length > 0) {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const meal of input.meals) {
      const weekday = weekdayIndexFromDate(meal.nightDate);
      counts[weekday] = clampNightHeadcount(meal.servings);
    }
    return counts;
  }
  return normalizeNightHeadcounts([...input.household]);
}

/** Weekdays whose plates stay put after a mid-week unlock. */
export function frozenWeekdays(input: {
  startsOn: string;
  status: WeekStatus;
  editableFrom: string | null;
}): number[] {
  const frozen: number[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const nightDate = addDays(input.startsOn, offset);
    if (
      nightStaysLocked({
        weekStatus: input.status,
        nightDate,
        editableFrom: input.editableFrom,
      })
    ) {
      frozen.push(weekdayIndexFromDate(nightDate));
    }
  }
  return frozen;
}

export function withFrozenNights(
  previous: readonly number[],
  next: readonly number[],
  frozen: readonly number[],
): number[] {
  const counts = normalizeNightHeadcounts([...next]);
  const prior = normalizeNightHeadcounts([...previous]);
  for (const weekday of frozen) {
    counts[weekday] = prior[weekday] ?? 0;
  }
  return counts;
}

export type WeekNightChange =
  | { weekday: number; action: "open-slot"; servings: number }
  | { weekday: number; action: "remove" }
  | { weekday: number; action: "servings"; servings: number };

/** Meal rows change only once this week already has dinners. A first save only stores plates. */
export function planWeekNightChanges(input: {
  previous: readonly number[];
  next: readonly number[];
  hasMeals: boolean;
}): WeekNightChange[] {
  if (!input.hasMeals) return [];
  const previous = normalizeNightHeadcounts([...input.previous]);
  const next = normalizeNightHeadcounts([...input.next]);
  const changes: WeekNightChange[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const from = previous[weekday] ?? 0;
    const to = next[weekday] ?? 0;
    if (from === 0 && to > 0) changes.push({ weekday, action: "open-slot", servings: to });
    else if (from > 0 && to === 0) changes.push({ weekday, action: "remove" });
    else if (from > 0 && to > 0 && from !== to) {
      changes.push({ weekday, action: "servings", servings: to });
    }
  }
  return changes;
}

export function savedNewNightsToast(changes: readonly WeekNightChange[], hadMeals: boolean): string | null {
  if (!hadMeals) return null;
  return changes.some((change) => change.action === "open-slot") ? EDIT_NIGHTS_ADDED_TOAST : null;
}

function dinnerStillOn(
  meal: Pick<Meal, "id" | "title">,
  votes: Vote[],
  memberships?: Membership[],
): boolean {
  const lifecycle = nightLifecycle(meal, votes, memberships);
  switch (lifecycle) {
    case "passive":
    case "swapped":
    case "proposed":
    case "request_new_meal":
      return true;
    case "removed":
      return false;
    default: {
      const _exhaustive: never = lifecycle;
      return _exhaustive;
    }
  }
}

/** Weekday labels for dinners that would be removed by this save. */
export function dinnersTurningOff(input: {
  previous: readonly number[];
  next: readonly number[];
  meals: readonly Pick<Meal, "id" | "title" | "nightDate">[];
  votes: Vote[];
  memberships?: Membership[];
}): string[] {
  const previous = normalizeNightHeadcounts([...input.previous]);
  const next = normalizeNightHeadcounts([...input.next]);
  const labels: string[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    if ((previous[weekday] ?? 0) <= 0 || (next[weekday] ?? 0) !== 0) continue;
    const dinner = input.meals.some(
      (meal) =>
        weekdayIndexFromDate(meal.nightDate) === weekday &&
        dinnerStillOn(meal, input.votes, input.memberships),
    );
    if (!dinner) continue;
    const label = WEEKDAY_LABELS[weekday];
    if (label) labels.push(label);
  }
  return labels;
}
