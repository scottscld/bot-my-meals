import type { HouseholdSnapshot, Recipe, ShoppingList, WeekScope } from "./types";

function redactScope(scope: WeekScope): WeekScope {
  if (scope.week.status === "locked") return scope;
  return {
    ...scope,
    recipes: [] as Recipe[],
    shoppingList: null as ShoppingList | null,
  };
}

/** Recipes and the shopping list stay hidden until that week itself is locked. */
export function redactUntilLocked(snapshot: HouseholdSnapshot): HouseholdSnapshot {
  const cooking = redactScope({
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
  });
  const planning = snapshot.planning ? redactScope(snapshot.planning) : snapshot.planning;
  return {
    ...snapshot,
    week: cooking.week,
    meals: cooking.meals,
    votes: cooking.votes,
    recipes: cooking.recipes,
    shoppingList: cooking.shoppingList,
    ballotRequest: cooking.ballotRequest,
    options: cooking.options,
    picks: cooking.picks,
    submissions: cooking.submissions,
    optionRequests: cooking.optionRequests,
    planning,
  };
}
