import { weekdayLabelFromNight } from "./dates";
import { isNightOff, nightLifecycle } from "./lock";
import { recipeNightsForWeek } from "./recipes";
import type { Meal, Membership, ShoppingPrompt, Vote, WeekStatus } from "./types";

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

export function showOpenShoppingList(input: {
  weekStatus: WeekStatus;
  shoppingPrompt: ShoppingPrompt;
  pendingFill: boolean;
  items: readonly { checked: boolean }[] | null;
}): boolean {
  if (input.pendingFill) return false;
  if (input.weekStatus !== "locked") return false;
  if (shoppingPromptClosed(input.shoppingPrompt)) return false;
  const items = input.items;
  if (!items || items.length === 0) return false;
  if (items.every((item) => item.checked)) return false;
  return true;
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
