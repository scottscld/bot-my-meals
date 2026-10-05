import { describe, expect, it } from "vitest";
import { emptyHousehold } from "@/lib/seed";
import type { HouseholdSnapshot, Meal, ShoppingItem, ShoppingList } from "@/lib/types";
import {
  LIST_CHECK_SAVE_ERROR,
  applyOptimistic,
  dropOptimistic,
  patchHousehold,
  patchItemAdded,
  patchItemRemoved,
  patchListStatus,
  patchMealProposal,
  patchMemberRole,
  patchPick,
  patchStoreAdded,
  patchStoreRemoved,
  patchVote,
  queueOptimistic,
} from "@/lib/optimistic";

const blankOrder: ShoppingList["order"] = {
  statusAt: null,
  orderedAt: null,
  windowStart: null,
  windowEnd: null,
  label: null,
  subtotalCents: null,
  totalCents: null,
  number: null,
  cartUrl: null,
  message: null,
  overGuard: false,
};

function snapshot(): HouseholdSnapshot {
  const base = emptyHousehold("House", {
    id: "user-1",
    email: "a@example.com",
    displayName: "Alex",
  });
  const meal: Meal = {
    id: "meal-1",
    householdId: base.household.id,
    weekId: base.week.id,
    dayIndex: 0,
    nightDate: "2026-09-27",
    title: "Chili",
    pitch: "A pot of chili.",
    audience: "family",
    servings: 4,
    prepMinutes: 40,
    isLeftovers: false,
    leftoverOfMealId: null,
    estimatedCostCents: null,
    estimatedCostSource: null,
    estimatedCostAsOf: null,
    sourceOptionId: null,
  };
  const item: ShoppingItem = {
    id: "item-1",
    householdId: base.household.id,
    shoppingListId: "list-1",
    storeId: base.stores[0]?.id ?? "store",
    name: "Beans",
    quantity: 2,
    unit: "can",
    priceCents: null,
    priceSource: null,
    pricedAt: null,
    checked: false,
    source: "recipe",
    note: null,
    addedBy: null,
    removedAt: null,
    removedBy: null,
    cart: null,
  };
  return {
    ...base,
    meals: [meal],
    shoppingList: {
      id: "list-1",
      householdId: base.household.id,
      weekId: base.week.id,
      generatedAt: "2026-09-27T00:00:00.000Z",
      status: "review",
      approvedAt: null,
      approvedBy: null,
      order: blankOrder,
      items: [item],
    },
  };
}

describe("optimistic snapshot patches", () => {
  it("uses the lock’s short list-check error", () => {
    expect(LIST_CHECK_SAVE_ERROR).toBe("Couldn\u2019t save \u2014 try again.");
  });

  it("removes and restores a shopping item on the cooking list and the planning list", () => {
    const base = snapshot();
    const cookingItem = base.shoppingList?.items[0];
    if (!cookingItem || !base.shoppingList) throw new Error("missing list");
    const planItem: ShoppingItem = { ...cookingItem, id: "plan-item", shoppingListId: "plan-list" };
    const withPlanning: HouseholdSnapshot = {
      ...base,
      planning: {
        week: { ...base.week, id: "plan-week" },
        meals: [],
        votes: [],
        recipes: [],
        shoppingList: {
          ...base.shoppingList,
          id: "plan-list",
          weekId: "plan-week",
          items: [planItem],
        },
        ballotRequest: null,
        options: [],
        picks: [],
        submissions: [],
        optionRequests: [],
      },
    };
    const removed = patchItemRemoved(withPlanning, "item-1", "2026-10-06T00:00:00.000Z", "mem-1");
    expect(removed.shoppingList?.items[0]?.removedAt).toBe("2026-10-06T00:00:00.000Z");
    expect(removed.shoppingList?.items[0]?.removedBy).toBe("mem-1");
    expect(removed.planning?.shoppingList?.items[0]?.removedAt).toBeNull();
    expect(patchItemRemoved(removed, "item-1", null, null).shoppingList?.items[0]?.removedAt).toBeNull();
    const planRemoved = patchItemRemoved(withPlanning, "plan-item", "2026-10-06T00:00:00.000Z", "mem-1");
    expect(planRemoved.planning?.shoppingList?.items[0]?.removedAt).toBe("2026-10-06T00:00:00.000Z");
    expect(planRemoved.shoppingList?.items[0]?.removedAt).toBeNull();

    const added: ShoppingItem = { ...cookingItem, id: "item-2", name: "Paper towels", source: "manual" };
    expect(patchItemAdded(withPlanning, "list-1", added).shoppingList?.items.map((item) => item.id)).toEqual([
      "item-1",
      "item-2",
    ]);
    const planAdded: ShoppingItem = { ...planItem, id: "plan-2", name: "Milk" };
    expect(
      patchItemAdded(withPlanning, "plan-list", planAdded).planning?.shoppingList?.items.map((item) => item.name),
    ).toEqual(["Beans", "Milk"]);
    expect(patchListStatus(withPlanning, "plan-list", "approved").planning?.shoppingList?.status).toBe("approved");
    expect(patchListStatus(withPlanning, "list-1", "failed").shoppingList?.status).toBe("failed");
  });

  it("keeps a swap note and drops a remove note", () => {
    const base = snapshot();
    const memberId = base.memberships[0]?.id ?? "";
    const swapped = patchVote(base, {
      mealId: "meal-1",
      membershipId: memberId,
      householdId: base.household.id,
      choice: "swap",
      note: "Too spicy",
    });
    expect(swapped.votes[0]).toMatchObject({ choice: "swap", note: "Too spicy" });
    const removed = patchVote(swapped, {
      mealId: "meal-1",
      membershipId: memberId,
      householdId: base.household.id,
      choice: "remove",
      note: "Too spicy",
    });
    expect(removed.votes).toHaveLength(1);
    expect(removed.votes[0]).toMatchObject({ choice: "remove", note: "" });
  });

  it("updates house plate defaults without rewriting this week's meals", () => {
    const base = snapshot();
    const servings = base.meals[0]?.servings;
    const next = patchHousehold(base, {
      nightHeadcounts: [3, 4, 4, 4, 4, 2, 2],
    });
    expect(next.household.nightHeadcounts[0]).toBe(3);
    expect(next.meals[0]?.servings).toBe(servings);
    expect(next.meals).toBe(base.meals);
    expect(next.household.nightsPlanned).toBe(7);
    const checkout = patchHousehold(base, {
      hebCheckoutMode: "auto",
      deliveryDays: [2, 4],
      deliveryWindowStart: "16:00",
      deliveryWindowEnd: "19:00",
      orderMaxCents: 25000,
      listApproverRole: "voter",
    });
    expect(checkout.household.hebCheckoutMode).toBe("auto");
    expect(checkout.household.deliveryDays).toEqual([2, 4]);
    expect(checkout.household.orderMaxCents).toBe(25000);
    expect(checkout.household.listApproverRole).toBe("voter");
  });

  it("adds and removes a store", () => {
    const base = snapshot();
    const added = patchStoreAdded(base, { id: "store-new", name: "WinCo", slug: "winco" });
    expect(added.stores.map((store) => store.slug)).toContain("winco");
    expect(patchStoreAdded(added, { id: "store-new", name: "WinCo", slug: "winco" }).stores).toHaveLength(
      added.stores.length,
    );
    expect(patchStoreRemoved(added, "store-new").stores.map((store) => store.id)).not.toContain(
      "store-new",
    );
  });

  it("flips a member role and a proposed meal", () => {
    const base = snapshot();
    const memberId = base.memberships[0]?.id ?? "";
    const voted = patchVote(base, {
      mealId: "meal-1",
      membershipId: memberId,
      householdId: base.household.id,
      choice: "swap",
      note: "",
    });
    expect(patchMemberRole(voted, memberId, "voter").memberships[0]?.role).toBe("voter");
    const proposed = patchMealProposal(voted, "meal-1", {
      title: "Tacos",
      pitch: "Tuesday tacos.",
      prepMinutes: 25,
    });
    expect(proposed.meals[0]).toMatchObject({ title: "Tacos", pitch: "Tuesday tacos.", prepMinutes: 25 });
    expect(proposed.votes).toHaveLength(0);
  });

  it("lets a newer patch replace an older one and rolls back when that patch is dropped", () => {
    let pending = queueOptimistic<boolean>([], "item:1", 1, () => true);
    pending = queueOptimistic(pending, "item:1", 2, () => false);
    expect(applyOptimistic(true, pending)).toBe(false);
    pending = dropOptimistic(pending, 1);
    expect(applyOptimistic(true, pending)).toBe(false);
    pending = dropOptimistic(pending, 2);
    expect(applyOptimistic(true, pending)).toBe(true);
  });

  it("replaces the caller's pick for that night only", () => {
    const base = snapshot();
    const first = patchPick(base, {
      id: "pick-1",
      weekId: base.week.id,
      dayIndex: 0,
      optionId: "opt-a",
      membershipId: "mem-1",
      updatedAt: "2026-10-04T00:00:00.000Z",
    });
    const otherNight = patchPick(first, {
      id: "pick-2",
      weekId: base.week.id,
      dayIndex: 1,
      optionId: "opt-b",
      membershipId: "mem-1",
      updatedAt: "2026-10-04T00:00:00.000Z",
    });
    const otherPerson = patchPick(otherNight, {
      id: "pick-3",
      weekId: base.week.id,
      dayIndex: 0,
      optionId: "opt-c",
      membershipId: "mem-2",
      updatedAt: "2026-10-04T00:00:00.000Z",
    });
    const moved = patchPick(otherPerson, {
      id: "pick-4",
      weekId: base.week.id,
      dayIndex: 0,
      optionId: "opt-d",
      membershipId: "mem-1",
      updatedAt: "2026-10-04T01:00:00.000Z",
    });
    expect(moved.picks).toEqual([
      expect.objectContaining({ dayIndex: 0, optionId: "opt-d", membershipId: "mem-1" }),
      expect.objectContaining({ dayIndex: 1, optionId: "opt-b", membershipId: "mem-1" }),
      expect.objectContaining({ dayIndex: 0, optionId: "opt-c", membershipId: "mem-2" }),
    ]);
    expect(moved.picks.filter((pick) => pick.membershipId === "mem-1" && pick.dayIndex === 0)).toHaveLength(1);
  });
});
