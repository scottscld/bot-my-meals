export const LOCK_SUCCESS_LIST_CTA = "Open shopping list";
export const LOCK_SUCCESS_RECIPES_CTA = "See recipes";
export const LOCK_SUCCESS_LIST_KICKER = "Next up";
export const LOCK_SUCCESS_RECIPES_KICKER = "First meal";

export const LOCKED_CHIP_LABEL = "Locked";
export const UNLOCK_WEEK_LABEL = "Unlock week";
export const UNLOCK_WEEK_CONFIRM = "Unlock so you can edit what’s left?";
export const UNLOCK_WEEK_CHOICE_CONFIRM = "Unlock and reopen voting? Everyone locks in again.";
export const DONE_SHOPPING_LABEL = "Done shopping";
export const DISMISS_SHOPPING_LABEL = "Dismiss";

export const LIST_LOCKED_SECONDARY = "Check off as you shop. No prices — just what you need.";

/** Ballot-3 — /list and /recipes pre-lock empties. Brief §5–6 / §7. */
export const LOCK_FIRST_TITLE = "Lock the week first";
export const LIST_PRE_LOCK_DESCRIPTION =
  "The store-split shopping list opens after the week locks. Until then, titles only — no invented prices.";
export const RECIPES_PRE_LOCK_DESCRIPTION =
  "Full recipes stay hidden until after swaps and dinner requests are cleared. Titles only for now — no invented steps or ingredients.";
export const LIST_NO_HOUSEHOLD = "Join a household to see a list after the week locks.";
export const RECIPES_NO_HOUSEHOLD = "Join a household to see recipes after the week locks.";
export const LIST_NOTHING_TO_BUY =
  "Every remaining night is leftovers or was removed. No prices were invented.";
export const RECIPES_EMPTY_WEEK =
  "Ask your Bot My Meals to propose dinners on This week. Lock the week, then recipes will show here.";
export const RECIPES_EMPTY_NEXT_WEEK =
  "Ask your Bot My Meals to propose dinners on Next week. Lock the week, then recipes will show here.";

export function lockSuccessRecipesCta(title?: string | null): string {
  return title ? `${LOCK_SUCCESS_RECIPES_CTA} · ${title}` : LOCK_SUCCESS_RECIPES_CTA;
}

export function lockSuccessRecipesKicker(weekday?: string | null): string {
  return weekday ? `${LOCK_SUCCESS_RECIPES_KICKER} · ${weekday}` : LOCK_SUCCESS_RECIPES_KICKER;
}
