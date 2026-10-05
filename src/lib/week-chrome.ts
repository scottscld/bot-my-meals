import { weekdayLabelFromNight } from "./dates";
import { listStatusCopy } from "./list-review";
import { LOCK_SUCCESS_LIST_CTA } from "./lock-success";
import { isNightOff, nightLifecycle } from "./lock";
import { recipeNightsForWeek } from "./recipes";
import type { ListStatus, Meal, Membership, ShoppingPrompt, Vote, WeekStatus } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseShoppingPrompt(value: unknown): ShoppingPrompt {
  switch (value) {
    case "done":
    case "dismissed":
    case "open":
      return value;
    default:
      return "open";
  }
}

export function parseEditableFrom(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

export function shoppingPromptClosed(prompt: ShoppingPrompt): boolean {
  switch (prompt) {
    case "done":
    case "dismissed":
      return true;
    case "open":
      return false;
    default: {
      const _exhaustive: never = prompt;
      return _exhaustive;
    }
  }
}

/** Fully locked weeks lock every night. After unlock, only nights before `editableFrom` stay locked. */
export function nightStaysLocked(input: {
  weekStatus: WeekStatus;
  nightDate: string;
  editableFrom: string | null;
}): boolean {
  switch (input.weekStatus) {
    case "locked":
      return true;
    case "voting": {
      const from = input.editableFrom;
      return from != null && input.nightDate < from;
    }
    default: {
      const _exhaustive: never = input.weekStatus;
      return _exhaustive;
    }
  }
}

/** A strip night is selectable only when it still has a dinner. Removed, blank, and pending nights stay visible but inert. */
export function nightHasStripMeal(
  meal: Pick<Meal, "id" | "title">,
  votes: Vote[],
  memberships?: Membership[],
): boolean {
  const lifecycle = nightLifecycle(meal, votes, memberships);
  switch (lifecycle) {
    case "passive":
    case "swapped":
    case "proposed":
      return true;
    case "removed":
    case "request_new_meal":
      return false;
    default: {
      const _exhaustive: never = lifecycle;
      return _exhaustive;
    }
  }
}

/** Past strip cells mute only after a mid-week unlock, not while the whole week is locked. */
export function stripCellMuted(input: {
  weekStatus: WeekStatus;
  nightDate: string;
  editableFrom: string | null;
}): boolean {
  switch (input.weekStatus) {
    case "locked":
      return false;
    case "voting": {
      const from = input.editableFrom;
      return from != null && input.nightDate < from;
    }
    default: {
      const _exhaustive: never = input.weekStatus;
      return _exhaustive;
    }
  }
}

/** Review CTA while the list is in review and still has something to buy. Later statuses use the short order label. */
export function showOpenShoppingList(input: {
  weekStatus: WeekStatus;
  pendingFill: boolean;
  listStatus: ListStatus | null;
  activeCount: number;
}): string | null {
  if (input.pendingFill) return null;
  if (input.weekStatus !== "locked") return null;
  if (!input.listStatus) return null;
  if (input.listStatus === "review") {
    return input.activeCount > 0 ? LOCK_SUCCESS_LIST_CTA : null;
  }
  return listStatusCopy({ status: input.listStatus }, "short");
}

/** Today or later, with a title, and not removed. Advances once that night's date is past in the house timezone. */
export function upcomingDinner(meals: readonly Meal[], votes: Vote[], todayIso: string): Meal | undefined {
  return recipeNightsForWeek([...meals]).find((meal) => {
    if (meal.nightDate < todayIso) return false;
    if (!meal.title.trim()) return false;
    if (isNightOff(meal.id, votes)) return false;
    return true;
  });
}

export function showFirstMealRow(input: {
  weekStatus: WeekStatus;
  pendingFill: boolean;
  meal: Meal | undefined;
}): boolean {
  if (input.pendingFill) return false;
  if (input.weekStatus !== "locked") return false;
  return Boolean(input.meal?.title.trim());
}

/**
 * Featured blue-card eyebrow on /week. `todayIso` is the household calendar
 * date (`todayInTimeZone`). The featured night is that meal's `nightDate`.
 */
export function featuredMealEyebrow(nightDate: string, todayIso: string): string {
  if (nightDate === todayIso) return "Tonight’s meal";
  return `${weekdayLabelFromNight(nightDate)}’s meal`;
}
