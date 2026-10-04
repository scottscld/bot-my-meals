export type Role = "owner" | "voter" | "eater";

/** Household actions. Absence of a vote is passive approve — do not store `approve`. */
export const VOTE_CHOICES = ["swap", "remove", "request_new_meal"] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

/** Night state after last-writer-wins. `proposed` is lock-ok like `passive`. */
export const NIGHT_LIFECYCLES = [
  "passive",
  "swapped",
  "removed",
  "request_new_meal",
  "proposed",
] as const;
export type NightLifecycle = (typeof NIGHT_LIFECYCLES)[number];

export type Audience = "couple" | "family";
export type WeekStatus = "voting" | "locked";

/** Cooking is the calendar week you're in. Planning is the single next week, when it exists. */
export type WeekRole = "cooking" | "planning";

/** This week shopping row. `done` and `dismissed` keep it hidden after a re-lock. */
export const SHOPPING_PROMPTS = ["open", "done", "dismissed"] as const;
export type ShoppingPrompt = (typeof SHOPPING_PROMPTS)[number];

export const BOT_CHECK_MODES = ["adaptive", "fixed"] as const;
export type BotCheckMode = (typeof BOT_CHECK_MODES)[number];

export const BOT_CHECK_INTERVAL_HOURS = [1, 3, 6] as const;
export type BotCheckIntervalHours = (typeof BOT_CHECK_INTERVAL_HOURS)[number];

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
};

export type Store = {
  id: string;
  householdId: string;
  name: string;
  slug: string;
  sortOrder: number;
};

export type Membership = {
  id: string;
  householdId: string;
  userId: string;
  role: Role;
  displayName: string;
  email: string;
};

export const BALLOT_REQUEST_STATUSES = ["pending", "fulfilled", "cancelled"] as const;
export type BallotRequestStatus = (typeof BALLOT_REQUEST_STATUSES)[number];

export type Household = {
  id: string;
  name: string;
  inviteCode: string;
  weekStartsOn: number;
  coupleNights: number[];
  familySize: number;
  coupleSize: number;
  nightHeadcounts: number[];
  timezone: string;
  setupStep: number;
  weeklyBudgetCents: number | null;
  householdSize: number;
  nightsPlanned: number;
  postalCode: string | null;
  /** `adaptive` is the default. `fixed` uses `botCheckIntervalHours`. */
  botCheckMode: BotCheckMode;
  /** 1, 3, or 6 when fixed. Null when adaptive. */
  botCheckIntervalHours: BotCheckIntervalHours | null;
};

export type BallotRequest = {
  id: string;
  householdId: string;
  weekId: string;
  status: BallotRequestStatus;
  householdSize: number;
  nightsPlanned: number;
  nightHeadcounts: number[];
  storeNames: string[];
  weeklyBudgetCents: number | null;
  postalCode: string | null;
  requestedBy: string | null;
  createdAt: string;
  updatedAt: string;
  fulfilledAt: string | null;
  /** Optional note for the bot on this week. Null when the house left it blank. */
  specialInstructions: string | null;
};

export type Ingredient = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  storeId: string;
};

export type Recipe = {
  id: string;
  mealId: string;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  steps: string[];
  ingredients: Ingredient[];
  /** Stable id Meal Ops may stamp. Blank means the saved-meal key is the title. */
  recipeKey?: string | null;
};

export type Meal = {
  id: string;
  householdId: string;
  weekId: string;
  dayIndex: number;
  nightDate: string;
  title: string;
  pitch: string;
  audience: Audience;
  servings: number;
  prepMinutes: number;
  isLeftovers: boolean;
  leftoverOfMealId: string | null;
  estimatedCostCents: number | null;
  estimatedCostSource: string | null;
  estimatedCostAsOf: string | null;
  /** Option that won this night on a choice3 week. Null on the old single-dinner flow. */
  sourceOptionId: string | null;
};

export type MealOption = {
  id: string;
  householdId: string;
  weekId: string;
  dayIndex: number;
  nightDate: string;
  rank: number;
  title: string;
  pitch: string;
  servings: number;
  prepMinutes: number;
  recipeKey: string | null;
};

export type MealPick = {
  id: string;
  weekId: string;
  dayIndex: number;
  optionId: string;
  membershipId: string;
  updatedAt: string;
};

export type VoteSubmission = {
  weekId: string;
  membershipId: string;
  submittedAt: string;
};

export type OptionRequest = {
  id: string;
  weekId: string;
  dayIndex: number;
  requestedBy: string | null;
  note: string;
  status: "pending" | "fulfilled" | "cancelled";
};

export type Vote = {
  id: string;
  householdId: string;
  mealId: string;
  membershipId: string;
  choice: VoteChoice;
  note: string;
  updatedAt: string;
};

export type Week = {
  id: string;
  householdId: string;
  startsOn: string;
  status: WeekStatus;
  lockedAt: string | null;
  /** House-local date of a mid-week unlock. Nights before this stay read-only. */
  editableFrom: string | null;
  shoppingPrompt: ShoppingPrompt;
  /** Null until this week's plates are saved. The planning gate stays open while null. */
  peopleConfirmedAt: string | null;
  /** This week's plates. Null until saved. House defaults stay on the household. */
  nightHeadcounts: number[] | null;
  /** Optional bot note for this week. */
  specialInstructions: string | null;
  /** single keeps Swap/Remove. choice3 is 3 options and Lock in my vote. */
  ballotMode: "single" | "choice3";
  /** Set when choice3 winners are written. Null while voting is still open. */
  finalizedAt: string | null;
};

/** Title-only dinner kept after a week finishes. No recipe payload. */
export type MealHistoryNight = {
  nightDate: string;
  title: string;
  plates: number | null;
};

export type MealHistoryWeek = {
  startsOn: string;
  nights: MealHistoryNight[];
};

/** Household-shared save. One row per recipe identity. */
export type SavedMeal = {
  id: string;
  householdId: string;
  recipeKey: string;
  title: string;
  savedAt: string;
  lastLockedAt: string | null;
  requestedForWeek: string | null;
  sourceRecipeId: string | null;
};

export type ShoppingItem = {
  id: string;
  householdId: string;
  shoppingListId: string;
  storeId: string;
  name: string;
  quantity: number;
  unit: string;
  priceCents: number | null;
  priceSource: string | null;
  pricedAt: string | null;
  checked: boolean;
};

export type ShoppingList = {
  id: string;
  householdId: string;
  weekId: string;
  generatedAt: string;
  items: ShoppingItem[];
};

export type Session = {
  userId: string;
  email: string;
  displayName: string;
  membershipId: string | null;
  householdId: string | null;
  role: Role | null;
};

export type MealProposalInput = {
  title: string;
  pitch: string;
  prepMinutes: number;
  audience?: Audience;
  servings?: number;
  steps?: string[];
  ingredients?: Array<{
    name: string;
    quantity: number;
    unit: string;
    storeId: string;
  }>;
};

export type HouseholdSettingsPatch = {
  name?: string;
  weekStartsOn?: number;
  coupleNights?: number[];
  familySize?: number;
  coupleSize?: number;
  nightHeadcounts?: number[];
  setupStep?: number;
  weeklyBudgetCents?: number | null;
  householdSize?: number;
  nightsPlanned?: number;
  postalCode?: string | null;
  botCheckMode?: BotCheckMode;
  botCheckIntervalHours?: BotCheckIntervalHours | null;
};

export type PendingInvite = {
  id: string;
  householdId: string;
  displayName: string;
  email: string;
  role: Role;
};

/** One open week's ballot, nights, recipes, and shopping list. */
export type WeekScope = {
  week: Week;
  meals: Meal[];
  votes: Vote[];
  recipes: Recipe[];
  shoppingList: ShoppingList | null;
  ballotRequest: BallotRequest | null;
  options: MealOption[];
  picks: MealPick[];
  submissions: VoteSubmission[];
  optionRequests: OptionRequest[];
};

export type HouseholdSnapshot = {
  household: Household;
  memberships: Membership[];
  stores: Store[];
  /** Cooking week. Home opens here. */
  week: Week;
  meals: Meal[];
  votes: Vote[];
  recipes: Recipe[];
  shoppingList: ShoppingList | null;
  pendingInvites?: PendingInvite[];
  joinToken?: string | null;
  ballotRequest?: BallotRequest | null;
  options: MealOption[];
  picks: MealPick[];
  submissions: VoteSubmission[];
  optionRequests: OptionRequest[];
  /** The single next week, when that row exists. Absent means only cooking is open. */
  planning?: WeekScope | null;
  mealHistory: MealHistoryWeek[];
  savedMeals: SavedMeal[];
};

export type ReplacementIdea = {
  id: string;
  title: string;
  pitch: string;
  prepMinutes: number;
  audience: Audience;
  steps: string[];
  ingredients: Array<{
    name: string;
    quantity: number;
    unit: string;
    storeSlug: string;
  }>;
};
