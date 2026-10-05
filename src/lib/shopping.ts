import { isNightOff } from "./lock";
import type { Meal, Recipe, ShoppingItem, Store, Vote } from "./types";

export function normalizeItemName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

export function mergeQuantities(items: ShoppingItem[]): ShoppingItem[] {
  const groups = new Map<string, ShoppingItem>();

  for (const item of items) {
    const key = `${item.storeId}::${normalizeItemName(item.name)}::${item.unit.toLowerCase()}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...item });
      continue;
    }
    existing.quantity = roundQuantity(existing.quantity + item.quantity);
    if (!existing.priceCents && item.priceCents != null) {
      existing.priceCents = item.priceCents;
      existing.priceSource = item.priceSource;
      existing.pricedAt = item.pricedAt;
    }
  }

  return [...groups.values()];
}

export function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildShoppingItems(input: {
  householdId: string;
  shoppingListId: string;
  meals: Meal[];
  recipes: Recipe[];
  votes: Vote[];
}): ShoppingItem[] {
  const draft: ShoppingItem[] = [];

  for (const meal of input.meals) {
    if (isNightOff(meal.id, input.votes)) continue;
    const recipe = input.recipes.find((item) => item.mealId === meal.id);
    if (!recipe) continue;

    for (const ingredient of recipe.ingredients) {
      draft.push({
        id: `shop_${meal.id}_${ingredient.id}`,
        householdId: input.householdId,
        shoppingListId: input.shoppingListId,
        storeId: ingredient.storeId,
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
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
      });
    }
  }

  return mergeQuantities(draft).map((item, index) => ({
    ...item,
    id: `${input.shoppingListId}_${index}`,
  }));
}

/** Locked-list sticky headers. Known slugs keep their catalog names. Never a cart. */
export const STORE_LABEL_TRADER_JOES = "Trader Joe's";
export const STORE_LABEL_SMITHS = "Smith's";

export function listStoreLabel(store: Pick<Store, "slug" | "name">): string {
  switch (store.slug) {
    case "trader-joes":
    case "trader-joe-s":
      return STORE_LABEL_TRADER_JOES;
    case "smiths":
    case "smith-s":
      return STORE_LABEL_SMITHS;
    default:
      return store.name.trim() || "Other";
  }
}

export function groupItemsByStore(
  items: ShoppingItem[],
  stores: Store[],
): Array<{ store: Store; items: ShoppingItem[] }> {
  const sortedStores = [...stores].sort((a, b) => a.sortOrder - b.sortOrder);
  return sortedStores
    .map((store) => ({
      store,
      items: items
        .filter((item) => item.storeId === store.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.items.length > 0);
}

/** Post-lock sticky sections. Catalog slugs, plus apostrophe slugs saved before the picker passed a slug. */
export function groupStickyStoreLists(
  items: ShoppingItem[],
  stores: Store[],
): Array<{ store: Store; label: string; items: ShoppingItem[] }> {
  const active = items.filter((item) => item.removedAt == null);
  const groups = groupItemsByStore(active, stores).map((group) => ({
    ...group,
    label: listStoreLabel(group.store),
  }));
  const known = new Set(stores.map((store) => store.id));
  const orphans = active
    .filter((item) => !known.has(item.storeId))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (orphans.length === 0) return groups;
  return [
    ...groups,
    {
      store: {
        id: "other",
        householdId: orphans[0]?.householdId ?? "",
        name: "Other",
        slug: "other",
        sortOrder: Number.MAX_SAFE_INTEGER,
      },
      label: "Other",
      items: orphans,
    },
  ];
}

export function formatQuantity(quantity: number, unit: string): string {
  const shown = Number.isInteger(quantity) ? String(quantity) : String(roundQuantity(quantity));
  return unit ? `${shown} ${unit}` : shown;
}

/** Name + qty only. Prices stay off the list even when a source exists in the model. */
export function listItemDisplay(item: Pick<ShoppingItem, "name" | "quantity" | "unit">): {
  name: string;
  quantity: string;
} {
  return {
    name: item.name,
    quantity: formatQuantity(item.quantity, item.unit),
  };
}
