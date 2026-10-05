import { voteNotePersists } from "@/lib/ballot";
import { withDerivedNightSettings } from "@/lib/headcount";
import { nightsPlannedFromHeadcounts } from "@/lib/house-setup";
import type {
  HouseholdSettingsPatch,
  HouseholdSnapshot,
  ListStatus,
  MealPick,
  MealProposalInput,
  Role,
  SavedMeal,
  ShoppingItem,
  ShoppingList,
  ShoppingPrompt,
  Vote,
  VoteChoice,
} from "@/lib/types";

/** Temp ids for a store row the server has not inserted yet. */
export const OPTIMISTIC_STORE_PREFIX = "optimistic-store-";

/** Instant-feedback lock: short revert copy for a list check that fails to save. */
export const LIST_CHECK_SAVE_ERROR = "Couldn\u2019t save \u2014 try again.";

export type OptimisticPatch<T> = (value: T) => T;

export type PendingOptimistic<T> = {
  id: number;
  key: string;
  apply: OptimisticPatch<T>;
};

/** Latest patch for a key wins. Older patches for that key are dropped. */
export function queueOptimistic<T>(
  pending: readonly PendingOptimistic<T>[],
  key: string,
  id: number,
  apply: OptimisticPatch<T>,
): PendingOptimistic<T>[] {
  return [...pending.filter((patch) => patch.key !== key), { id, key, apply }];
}

export function dropOptimistic<T>(
  pending: readonly PendingOptimistic<T>[],
  id: number,
): PendingOptimistic<T>[] {
  return pending.filter((patch) => patch.id !== id);
}

export function applyOptimistic<T>(base: T, pending: readonly PendingOptimistic<T>[]): T {
  return pending.reduce((value, patch) => patch.apply(value), base);
}

export function patchShoppingPrompt(
  snapshot: HouseholdSnapshot,
  shoppingPrompt: ShoppingPrompt,
  weekId?: string,
): HouseholdSnapshot {
  if (weekId && snapshot.planning?.week.id === weekId) {
    return {
      ...snapshot,
      planning: {
        ...snapshot.planning,
        week: { ...snapshot.planning.week, shoppingPrompt },
      },
    };
  }
  return {
    ...snapshot,
    week: { ...snapshot.week, shoppingPrompt },
  };
}

function withItem(
  list: ShoppingList | null,
  itemId: string,
  update: (item: ShoppingItem) => ShoppingItem,
): ShoppingList | null {
  if (!list) return list;
  return {
    ...list,
    items: list.items.map((item) => (item.id === itemId ? update(item) : item)),
  };
}

function patchList(
  snapshot: HouseholdSnapshot,
  listId: string | null,
  itemId: string | null,
  update: (list: ShoppingList) => ShoppingList | null,
): HouseholdSnapshot {
  const planningList = snapshot.planning?.shoppingList;
  const onPlanning =
    snapshot.planning &&
    planningList &&
    ((listId != null && planningList.id === listId) ||
      (itemId != null && planningList.items.some((item) => item.id === itemId)));
  if (onPlanning && snapshot.planning && planningList) {
    return {
      ...snapshot,
      planning: {
        ...snapshot.planning,
        shoppingList: update(planningList),
      },
    };
  }
  if (!snapshot.shoppingList) return snapshot;
  return { ...snapshot, shoppingList: update(snapshot.shoppingList) };
}

export function patchItemRemoved(
  snapshot: HouseholdSnapshot,
  itemId: string,
  removedAt: string | null,
  membershipId: string | null,
): HouseholdSnapshot {
  return patchList(snapshot, null, itemId, (list) =>
    withItem(list, itemId, (item) => ({
      ...item,
      removedAt,
      removedBy: removedAt ? membershipId : null,
    })),
  );
}

export function patchItemAdded(
  snapshot: HouseholdSnapshot,
  listId: string,
  item: ShoppingItem,
): HouseholdSnapshot {
  return patchList(snapshot, listId, null, (list) => {
    if (list.id !== listId) return list;
    if (list.items.some((row) => row.id === item.id)) return list;
    return { ...list, items: [...list.items, item] };
  });
}

export function patchListStatus(
  snapshot: HouseholdSnapshot,
  listId: string,
  status: ListStatus,
): HouseholdSnapshot {
  return patchList(snapshot, listId, null, (list) => (list.id === listId ? { ...list, status } : list));
}

function nextVotes(
  votes: Vote[],
  input: {
    mealId: string;
    membershipId: string;
    householdId: string;
    choice: VoteChoice;
    note: string;
  },
): Vote[] {
  const note = voteNotePersists(input.choice) ? input.note : "";
  const updatedAt = new Date().toISOString();
  const existing = votes.find(
    (vote) => vote.mealId === input.mealId && vote.membershipId === input.membershipId,
  );
  const nextVote: Vote = existing
    ? { ...existing, choice: input.choice, note, updatedAt }
    : {
        id: `optimistic-vote-${input.mealId}-${input.membershipId}`,
        householdId: input.householdId,
        mealId: input.mealId,
        membershipId: input.membershipId,
        choice: input.choice,
        note,
        updatedAt,
      };
  return existing
    ? votes.map((vote) => (vote.id === existing.id ? nextVote : vote))
    : [...votes, nextVote];
}

export function patchVote(
  snapshot: HouseholdSnapshot,
  input: {
    mealId: string;
    membershipId: string;
    householdId: string;
    choice: VoteChoice;
    note: string;
  },
): HouseholdSnapshot {
  if (snapshot.planning?.meals.some((meal) => meal.id === input.mealId)) {
    return {
      ...snapshot,
      planning: {
        ...snapshot.planning,
        votes: nextVotes(snapshot.planning.votes, input),
      },
    };
  }
  return { ...snapshot, votes: nextVotes(snapshot.votes, input) };
}

function nextPicks(picks: MealPick[], pick: MealPick): MealPick[] {
  const existing = picks.find(
    (row) =>
      row.weekId === pick.weekId &&
      row.dayIndex === pick.dayIndex &&
      row.membershipId === pick.membershipId,
  );
  if (!existing) return [...picks, pick];
  return picks.map((row) =>
    row === existing ? { ...existing, optionId: pick.optionId, updatedAt: pick.updatedAt } : row,
  );
}

/** Replaces this voter's pick for one night. Other nights and other people stay. */
export function patchPick(snapshot: HouseholdSnapshot, pick: MealPick): HouseholdSnapshot {
  if (snapshot.planning?.week.id === pick.weekId) {
    return {
      ...snapshot,
      planning: {
        ...snapshot.planning,
        picks: nextPicks(snapshot.planning.picks, pick),
      },
    };
  }
  return { ...snapshot, picks: nextPicks(snapshot.picks, pick) };
}

export function patchHousehold(
  snapshot: HouseholdSnapshot,
  patch: HouseholdSettingsPatch,
): HouseholdSnapshot {
  let household = { ...snapshot.household };
  if (patch.name !== undefined) household = { ...household, name: patch.name };
  if (patch.weekStartsOn !== undefined) household = { ...household, weekStartsOn: patch.weekStartsOn };
  if (patch.familySize !== undefined) household = { ...household, familySize: patch.familySize };
  if (patch.coupleSize !== undefined) household = { ...household, coupleSize: patch.coupleSize };
  if (patch.setupStep !== undefined) household = { ...household, setupStep: patch.setupStep };
  if (patch.weeklyBudgetCents !== undefined) {
    household = { ...household, weeklyBudgetCents: patch.weeklyBudgetCents };
  }
  if (patch.householdSize !== undefined) household = { ...household, householdSize: patch.householdSize };
  if (patch.nightsPlanned !== undefined) household = { ...household, nightsPlanned: patch.nightsPlanned };
  if (patch.postalCode !== undefined) household = { ...household, postalCode: patch.postalCode };
  if (patch.botCheckMode !== undefined) household = { ...household, botCheckMode: patch.botCheckMode };
  if (patch.botCheckIntervalHours !== undefined) {
    household = { ...household, botCheckIntervalHours: patch.botCheckIntervalHours };
  }
  if (patch.hebCheckoutMode !== undefined) household = { ...household, hebCheckoutMode: patch.hebCheckoutMode };
  if (patch.deliveryDays !== undefined) household = { ...household, deliveryDays: patch.deliveryDays };
  if (patch.deliveryWindowStart !== undefined) {
    household = { ...household, deliveryWindowStart: patch.deliveryWindowStart };
  }
  if (patch.deliveryWindowEnd !== undefined) {
    household = { ...household, deliveryWindowEnd: patch.deliveryWindowEnd };
  }
  if (patch.orderMaxCents !== undefined) household = { ...household, orderMaxCents: patch.orderMaxCents };
  if (patch.listApproverRole !== undefined) {
    household = { ...household, listApproverRole: patch.listApproverRole };
  }
  if (patch.coupleNights !== undefined && patch.nightHeadcounts === undefined) {
    household = { ...household, coupleNights: patch.coupleNights };
  }

  if (patch.nightHeadcounts !== undefined) {
    household = withDerivedNightSettings(household, patch.nightHeadcounts);
    household = {
      ...household,
      nightsPlanned: nightsPlannedFromHeadcounts(household.nightHeadcounts),
    };
  }

  return { ...snapshot, household };
}

export function patchStoreAdded(
  snapshot: HouseholdSnapshot,
  store: { id: string; name: string; slug: string },
): HouseholdSnapshot {
  if (snapshot.stores.some((item) => item.id === store.id || item.slug === store.slug)) {
    return snapshot;
  }
  const sortOrder = snapshot.stores.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
  return {
    ...snapshot,
    stores: [
      ...snapshot.stores,
      {
        id: store.id,
        householdId: snapshot.household.id,
        name: store.name,
        slug: store.slug,
        sortOrder,
      },
    ],
  };
}

export function patchStoreRemoved(snapshot: HouseholdSnapshot, storeId: string): HouseholdSnapshot {
  return {
    ...snapshot,
    stores: snapshot.stores.filter((store) => store.id !== storeId),
  };
}

export function patchMemberRole(
  snapshot: HouseholdSnapshot,
  memberId: string,
  role: Role,
): HouseholdSnapshot {
  return {
    ...snapshot,
    memberships: snapshot.memberships.map((member) =>
      member.id === memberId ? { ...member, role } : member,
    ),
  };
}

/** Renames one membership. The caller's other rows in this snapshot stay put. */
export function patchMemberName(
  snapshot: HouseholdSnapshot,
  membershipId: string,
  name: string,
): HouseholdSnapshot {
  return {
    ...snapshot,
    memberships: snapshot.memberships.map((member) =>
      member.id === membershipId ? { ...member, displayName: name } : member,
    ),
  };
}

export function patchSavedMealAdded(snapshot: HouseholdSnapshot, meal: SavedMeal): HouseholdSnapshot {
  const savedMeals = snapshot.savedMeals.filter((item) => item.recipeKey !== meal.recipeKey);
  return { ...snapshot, savedMeals: [meal, ...savedMeals] };
}

export function patchSavedMealRemoved(snapshot: HouseholdSnapshot, recipeKey: string): HouseholdSnapshot {
  return {
    ...snapshot,
    savedMeals: snapshot.savedMeals.filter((meal) => meal.recipeKey !== recipeKey),
  };
}

export function patchSavedMealRequest(
  snapshot: HouseholdSnapshot,
  recipeKey: string,
  requestedForWeek: string,
): HouseholdSnapshot {
  return {
    ...snapshot,
    savedMeals: snapshot.savedMeals.map((meal) =>
      meal.recipeKey === recipeKey ? { ...meal, requestedForWeek } : meal,
    ),
  };
}

function applyProposal(meal: HouseholdSnapshot["meals"][number], proposal: MealProposalInput) {
  return {
    ...meal,
    title: proposal.title,
    pitch: proposal.pitch,
    prepMinutes: proposal.prepMinutes,
    audience: proposal.audience ?? meal.audience,
    servings: proposal.servings ?? meal.servings,
    isLeftovers: false,
    leftoverOfMealId: null,
  };
}

export function patchMealProposal(
  snapshot: HouseholdSnapshot,
  mealId: string,
  proposal: MealProposalInput,
): HouseholdSnapshot {
  if (snapshot.planning?.meals.some((meal) => meal.id === mealId)) {
    return {
      ...snapshot,
      planning: {
        ...snapshot.planning,
        meals: snapshot.planning.meals.map((meal) =>
          meal.id === mealId ? applyProposal(meal, proposal) : meal,
        ),
        votes: snapshot.planning.votes.filter((vote) => vote.mealId !== mealId),
      },
    };
  }
  return {
    ...snapshot,
    meals: snapshot.meals.map((meal) => (meal.id === mealId ? applyProposal(meal, proposal) : meal)),
    votes: snapshot.votes.filter((vote) => vote.mealId !== mealId),
  };
}
