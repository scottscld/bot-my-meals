import { addDays, startOfWeek } from "./dates";
import {
  DEFAULT_COUPLE_SIZE,
  DEFAULT_FAMILY_SIZE,
  audienceFromHeadcount,
  headcountForNight,
  typicalWeekHeadcounts,
} from "./headcount";
import { createId, inviteCode } from "./ids";
import { normalizeEmail } from "./users";
import type {
  Household,
  HouseholdSnapshot,
  Meal,
  Membership,
  Recipe,
  Session,
  Store,
  UserProfile,
  Week,
} from "./types";

export function defaultStores(householdId: string): Store[] {
  return [
    {
      id: createId("store"),
      householdId,
      name: "Trader Joe's",
      slug: "trader-joes",
      sortOrder: 0,
    },
    {
      id: createId("store"),
      householdId,
      name: "Smith's",
      slug: "smiths",
      sortOrder: 1,
    },
  ];
}

export function applySampleWeek(snapshot: HouseholdSnapshot, now = new Date()): HouseholdSnapshot {
  const household = snapshot.household;
  const startsOn = startOfWeek(now, household.weekStartsOn);
  const week: Week = {
    ...snapshot.week,
    startsOn,
    status: "voting",
    lockedAt: null,
    editableFrom: null,
    shoppingPrompt: "open",
    peopleConfirmedAt: null,
    nightHeadcounts: null,
    specialInstructions: null,
    ballotMode: "single",
    finalizedAt: null,
  };
  const stores = snapshot.stores.length > 0 ? snapshot.stores : defaultStores(household.id);
  const storeTj =
    stores.find((store) => store.slug === "trader-joes")?.id ?? stores[0]?.id ?? createId("store");
  const storeSmiths =
    stores.find((store) => store.slug === "smiths")?.id ?? stores[1]?.id ?? storeTj;

  const planned: Array<{
    dayIndex: number;
    title: string;
    pitch: string;
    prepMinutes: number;
    leftoversOf?: number;
    steps: string[];
    ingredients: Array<{ name: string; quantity: number; unit: string; store: "tj" | "smiths" | "trader-joes" }>;
  }> = [
    {
      dayIndex: 0,
      title: "Lemon roast chicken",
      pitch: "One chicken, potatoes, and green beans. Monday will thank you.",
      prepMinutes: 80,
      steps: [
        "Heat the oven to 425°F.",
        "Pat the chicken dry. Rub with olive oil, salt, pepper, and smashed garlic.",
        "Stuff the cavity with lemon halves. Scatter potatoes around the pan.",
        "Roast 60–70 minutes, until the thigh reads 165°F.",
        "In the last 15 minutes, toss green beans with oil and roast on a second sheet.",
        "Rest the chicken 10 minutes. Save leftover meat for Monday.",
      ],
      ingredients: [
        { name: "Whole chicken", quantity: 1, unit: "ct", store: "smiths" },
        { name: "Yukon gold potatoes", quantity: 2, unit: "lb", store: "smiths" },
        { name: "Green beans", quantity: 1, unit: "lb", store: "smiths" },
        { name: "Lemons", quantity: 2, unit: "ct", store: "trader-joes" },
        { name: "Garlic", quantity: 1, unit: "head", store: "trader-joes" },
        { name: "Olive oil", quantity: 3, unit: "tbsp", store: "trader-joes" },
      ],
    },
    {
      dayIndex: 1,
      title: "Chicken tostadas",
      pitch: "Sunday's roast, crisped tortillas, salsa, and a little cheese.",
      leftoversOf: 0,
      prepMinutes: 20,
      steps: [
        "Shred leftover chicken and warm it with a spoon of salsa.",
        "Crisp tortillas in a dry skillet or the oven.",
        "Pile on chicken, cheese, lettuce, and more salsa.",
      ],
      ingredients: [
        { name: "Corn tortillas", quantity: 8, unit: "ct", store: "trader-joes" },
        { name: "Salsa", quantity: 1, unit: "jar", store: "trader-joes" },
        { name: "Shredded Mexican cheese", quantity: 6, unit: "oz", store: "trader-joes" },
        { name: "Romaine lettuce", quantity: 1, unit: "head", store: "smiths" },
      ],
    },
    {
      dayIndex: 2,
      title: "Mandarin orange chicken",
      pitch: "The Trader Joe's bag everyone actually wants, plus rice and broccoli.",
      prepMinutes: 25,
      steps: [
        "Cook rice.",
        "Bake the orange chicken according to the bag.",
        "Steam or roast broccoli until just tender.",
        "Serve chicken over rice with broccoli on the side.",
      ],
      ingredients: [
        { name: "Mandarin orange chicken", quantity: 2, unit: "bags", store: "tj" },
        { name: "Jasmine rice", quantity: 2, unit: "cups", store: "tj" },
        { name: "Broccoli crowns", quantity: 2, unit: "ct", store: "smiths" },
      ],
    },
    {
      dayIndex: 3,
      title: "Sheet-pan sausage and peppers",
      pitch: "Sausage, peppers, onions, and potatoes on one pan.",
      prepMinutes: 40,
      steps: [
        "Heat the oven to 425°F.",
        "Toss sliced potatoes, peppers, and onions with oil and salt.",
        "Nestle sausages on the sheet and roast 25–30 minutes, turning once.",
        "Serve as-is, or tuck into toasted rolls if you have them.",
      ],
      ingredients: [
        { name: "Italian sausage", quantity: 2, unit: "lb", store: "smiths" },
        { name: "Bell peppers", quantity: 3, unit: "ct", store: "smiths" },
        { name: "Yellow onions", quantity: 2, unit: "ct", store: "smiths" },
        { name: "Baby potatoes", quantity: 1.5, unit: "lb", store: "smiths" },
        { name: "Olive oil", quantity: 2, unit: "tbsp", store: "tj" },
      ],
    },
    {
      dayIndex: 4,
      title: "Spaghetti and meat sauce",
      pitch: "A pot of sauce, a box of pasta, a green salad. Thursday solved.",
      prepMinutes: 35,
      steps: [
        "Brown the beef with chopped onion and garlic. Drain if needed.",
        "Stir in the jarred sauce and simmer 15 minutes.",
        "Boil spaghetti in salted water until al dente.",
        "Toss pasta with sauce. Salad on the side.",
      ],
      ingredients: [
        { name: "Ground beef", quantity: 1.5, unit: "lb", store: "smiths" },
        { name: "Spaghetti", quantity: 1, unit: "lb", store: "tj" },
        { name: "Marinara sauce", quantity: 1, unit: "jar", store: "tj" },
        { name: "Yellow onion", quantity: 1, unit: "ct", store: "smiths" },
        { name: "Garlic", quantity: 3, unit: "cloves", store: "tj" },
        { name: "Mixed salad greens", quantity: 1, unit: "bag", store: "tj" },
      ],
    },
    {
      dayIndex: 5,
      title: "Pan-seared salmon",
      pitch: "Two fillets, asparagus, lemon. Date-night energy on a Friday.",
      prepMinutes: 25,
      steps: [
        "Pat salmon dry and season with salt and pepper.",
        "Sear skin-side down in a hot skillet 4 minutes, then flip for 2–3.",
        "Meanwhile, roast asparagus at 425°F with oil and salt, about 12 minutes.",
        "Finish both with lemon.",
      ],
      ingredients: [
        { name: "Salmon fillets", quantity: 2, unit: "ct", store: "smiths" },
        { name: "Asparagus", quantity: 1, unit: "bunch", store: "smiths" },
        { name: "Lemon", quantity: 1, unit: "ct", store: "tj" },
        { name: "Olive oil", quantity: 2, unit: "tbsp", store: "tj" },
      ],
    },
    {
      dayIndex: 6,
      title: "Steak tacos for two",
      pitch: "A small skillet of steak, onions, and tortillas. No leftovers on purpose.",
      prepMinutes: 30,
      steps: [
        "Slice steak thin against the grain. Season well.",
        "Sear in a very hot skillet in batches so it browns.",
        "Cook onions in the same pan until soft.",
        "Warm tortillas and serve with salsa and cilantro.",
      ],
      ingredients: [
        { name: "Flank steak", quantity: 0.75, unit: "lb", store: "smiths" },
        { name: "Flour tortillas", quantity: 6, unit: "ct", store: "tj" },
        { name: "Yellow onion", quantity: 1, unit: "ct", store: "smiths" },
        { name: "Salsa", quantity: 1, unit: "jar", store: "tj" },
        { name: "Cilantro", quantity: 1, unit: "bunch", store: "smiths" },
      ],
    },
  ];

  const mealIds = planned.map(() => createId("meal"));
  const meals: Meal[] = planned.map((plan, index) => {
    const nightDate = addDays(startsOn, plan.dayIndex);
    const servings = headcountForNight(household, nightDate);
    return {
      id: mealIds[index],
      householdId: household.id,
      weekId: week.id,
      dayIndex: plan.dayIndex,
      nightDate,
      title: plan.title,
      pitch: plan.pitch,
      audience: audienceFromHeadcount(servings),
      servings,
      prepMinutes: plan.prepMinutes,
      isLeftovers: plan.leftoversOf != null,
      leftoverOfMealId: plan.leftoversOf != null ? mealIds[plan.leftoversOf] : null,
      estimatedCostCents: null,
      estimatedCostSource: null,
      estimatedCostAsOf: null,
      sourceOptionId: null,
    };
  });

  const recipes: Recipe[] = planned.map((plan, index) => ({
    id: createId("recipe"),
    mealId: meals[index].id,
    servings: meals[index].servings,
    prepMinutes: Math.min(15, plan.prepMinutes),
    cookMinutes: Math.max(0, plan.prepMinutes - 15),
    steps: plan.steps,
    ingredients: plan.ingredients.map((ingredient) => ({
      id: createId("ing"),
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      storeId: ingredient.store === "smiths" ? storeSmiths : storeTj,
    })),
  }));

  return {
    ...snapshot,
    household,
    stores,
    week,
    meals,
    votes: [],
    recipes,
    shoppingList: null,
  };
}

export function emptyHousehold(name: string, owner?: UserProfile): HouseholdSnapshot {
  const household: Household = {
    id: createId("hh"),
    name: name.trim() || "Our house",
    inviteCode: inviteCode(),
    weekStartsOn: 0,
    coupleNights: [5, 6],
    familySize: DEFAULT_FAMILY_SIZE,
    coupleSize: DEFAULT_COUPLE_SIZE,
    nightHeadcounts: typicalWeekHeadcounts(),
    timezone: "America/Los_Angeles",
    setupStep: 8,
    weeklyBudgetCents: null,
    householdSize: DEFAULT_FAMILY_SIZE,
    nightsPlanned: 7,
    postalCode: null,
    botCheckMode: "adaptive",
    botCheckIntervalHours: null,
  };

  const memberships: Membership[] = owner
    ? [
        {
          id: createId("mem"),
          householdId: household.id,
          userId: owner.id,
          role: "owner",
          displayName: owner.displayName,
          email: normalizeEmail(owner.email),
        },
      ]
    : [];

  return {
    household,
    memberships,
    stores: defaultStores(household.id),
    week: {
      id: createId("week"),
      householdId: household.id,
      startsOn: startOfWeek(new Date(), household.weekStartsOn),
      status: "voting",
      lockedAt: null,
      editableFrom: null,
      shoppingPrompt: "open",
      peopleConfirmedAt: null,
      nightHeadcounts: null,
      specialInstructions: null,
      ballotMode: "single",
      finalizedAt: null,
    },
    meals: [],
    votes: [],
    recipes: [],
    shoppingList: null,
    options: [],
    picks: [],
    submissions: [],
    optionRequests: [],
    pendingInvites: [],
    mealHistory: [],
    savedMeals: [],
  };
}

export function bootstrapHousehold(input: {
  householdName: string;
  displayName: string;
  email: string;
}): { snapshot: HouseholdSnapshot; session: Session } {
  const displayName = input.displayName.trim();
  const email = normalizeEmail(input.email);
  if (!displayName) throw new Error("Name is required.");
  if (!email.includes("@")) throw new Error("Email is required.");

  const owner: UserProfile = {
    id: createId("user"),
    email,
    displayName,
  };
  const snapshot = emptyHousehold(input.householdName, owner);
  const member = snapshot.memberships[0];
  if (!member) throw new Error("Could not create the first Admin.");
  return {
    snapshot,
    session: {
      userId: owner.id,
      email,
      displayName,
      membershipId: member.id,
      householdId: snapshot.household.id,
      role: "owner",
    },
  };
}
