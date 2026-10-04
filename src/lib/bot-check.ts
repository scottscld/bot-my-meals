import { choiceNights } from "./choice-ballot";
import { headcountForNight, normalizeNightHeadcounts } from "./headcount";
import { clampHouseholdSize, isHouseSetupComplete, parseBallotRequestStatus } from "./house-setup";
import { nightLifecycle } from "./lock";
import { awaitingMealSlot } from "./ballot";
import { isPendingBotFill } from "./post-lock-waiting";
import type {
  BallotRequest,
  BallotRequestStatus,
  BotCheckIntervalHours,
  BotCheckMode,
  Household,
  HouseholdSnapshot,
  Meal,
  MealOption,
  Membership,
  OptionRequest,
  NightLifecycle,
  Recipe,
  Vote,
  Week,
} from "./types";

export type BotCheckHousehold = Pick<
  Household,
  | "botCheckMode"
  | "botCheckIntervalHours"
  | "setupStep"
  | "householdSize"
  | "nightHeadcounts"
  | "coupleNights"
  | "familySize"
  | "coupleSize"
>;

export type BotCheckMeal = Pick<Meal, "id" | "title" | "servings" | "nightDate">;

export const BOT_CHECK_SECTION_LABEL = "Bot check frequency";
export const BOT_CHECK_HELPER = "How often Bot My Meals looks for updates from your Bot.";
export const BOT_CHECK_ADAPTIVE_LABEL = "Adaptive (recommended)";
export const BOT_CHECK_ADAPTIVE_SUB =
  "Every hour while you\u2019re setting up or waiting; every 6 hours when nothing is waiting.";
export const BOT_CHECK_EVERY_HOUR = "Every hour";
export const BOT_CHECK_EVERY_3_HOURS = "Every 3 hours";
export const BOT_CHECK_EVERY_6_HOURS = "Every 6 hours";
export const BOT_CHECK_NOW_LABEL = "Check now";
export const BOT_CHECK_NOW_HINT =
  "Message your Bot My Meals Grok Bot and ask it to sync. This isn\u2019t a push from the app.";
export const BOT_CHECK_WAITING_ADAPTIVE = "Checks about every hour while you\u2019re waiting.";

export const BOT_CHECK_CHOICES = ["adaptive", "1", "3", "6"] as const;
export type BotCheckChoice = (typeof BOT_CHECK_CHOICES)[number];

export const BOT_CHECK_OPTIONS: ReadonlyArray<{
  choice: BotCheckChoice;
  label: string;
  detail: string | null;
}> = [
  { choice: "adaptive", label: BOT_CHECK_ADAPTIVE_LABEL, detail: BOT_CHECK_ADAPTIVE_SUB },
  { choice: "1", label: BOT_CHECK_EVERY_HOUR, detail: null },
  { choice: "3", label: BOT_CHECK_EVERY_3_HOURS, detail: null },
  { choice: "6", label: BOT_CHECK_EVERY_6_HOURS, detail: null },
];

/** Stable reasons for GET /api/bot/status. First match wins. */
export const BOT_WORK_REASONS = [
  "pending_ballot",
  "options_pending",
  "meal_pending",
  "plate_or_people_change",
  "portion_pending",
  "fill_pending",
  "setup_incomplete",
  "idle",
] as const;
export type BotWorkReason = (typeof BOT_WORK_REASONS)[number];

export type BotCheckPhase = "active" | "idle";

export type BotWorkNight = {
  day_index: number;
  night_date: string;
  plates: number;
  need: "options" | "new_options";
  note?: string;
};

export type BotWork = {
  week_id: string;
  starts_on: string | null;
  ballot_mode: "single" | "choice3";
  nights?: BotWorkNight[];
};

export type BotCheckStatus = {
  needs_work: boolean;
  reason: BotWorkReason;
  cadence: {
    mode: BotCheckMode;
    interval_hours: BotCheckIntervalHours;
    phase: BotCheckPhase;
  };
  /** Present only when this week needs work and the week id is known. */
  work?: BotWork;
};

export type BotWorkMeal = {
  lifecycle: NightLifecycle;
  servings: number;
  expectedServings: number;
  /** Blank dinner slot waiting for a title. A removed night is not this. */
  awaitingTitle?: boolean;
};

const ADAPTIVE_ACTIVE_HOURS = 1;
const ADAPTIVE_IDLE_HOURS = 6;

export function parseBotCheckIntervalHours(value: unknown): BotCheckIntervalHours | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  switch (n) {
    case 1:
    case 3:
    case 6:
      return n;
    default:
      return null;
  }
}

export function normalizeBotCheckSetting(
  mode: unknown,
  intervalHours: unknown,
): { mode: BotCheckMode; intervalHours: BotCheckIntervalHours | null } {
  const interval = parseBotCheckIntervalHours(intervalHours);
  if (mode === "fixed" && interval) return { mode: "fixed", intervalHours: interval };
  return { mode: "adaptive", intervalHours: null };
}

export function botCheckWrite(
  mode: BotCheckMode,
  intervalHours: BotCheckIntervalHours | null,
): { mode: BotCheckMode; intervalHours: BotCheckIntervalHours | null } {
  switch (mode) {
    case "adaptive":
      return { mode: "adaptive", intervalHours: null };
    case "fixed": {
      const interval = parseBotCheckIntervalHours(intervalHours);
      if (!interval) throw new Error("Pick every 1, 3, or 6 hours.");
      return { mode: "fixed", intervalHours: interval };
    }
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function botCheckUpdateColumns(patch: {
  botCheckMode?: BotCheckMode;
  botCheckIntervalHours?: BotCheckIntervalHours | null;
}): {
  bot_check_mode?: BotCheckMode;
  bot_check_interval_hours?: BotCheckIntervalHours | null;
} {
  if (patch.botCheckMode === undefined && patch.botCheckIntervalHours === undefined) return {};
  const mode = patch.botCheckMode ?? (patch.botCheckIntervalHours == null ? "adaptive" : "fixed");
  const written = botCheckWrite(mode, patch.botCheckIntervalHours ?? null);
  return {
    bot_check_mode: written.mode,
    bot_check_interval_hours: written.intervalHours,
  };
}

export function botCheckChoiceFromSetting(
  mode: BotCheckMode,
  intervalHours: BotCheckIntervalHours | null,
): BotCheckChoice {
  if (mode !== "fixed") return "adaptive";
  switch (intervalHours) {
    case 1:
      return "1";
    case 3:
      return "3";
    case 6:
      return "6";
    default:
      return "adaptive";
  }
}

export function botCheckSettingFromChoice(choice: BotCheckChoice): {
  botCheckMode: BotCheckMode;
  botCheckIntervalHours: BotCheckIntervalHours | null;
} {
  switch (choice) {
    case "adaptive":
      return { botCheckMode: "adaptive", botCheckIntervalHours: null };
    case "1":
      return { botCheckMode: "fixed", botCheckIntervalHours: 1 };
    case "3":
      return { botCheckMode: "fixed", botCheckIntervalHours: 3 };
    case "6":
      return { botCheckMode: "fixed", botCheckIntervalHours: 6 };
    default: {
      const _exhaustive: never = choice;
      return _exhaustive;
    }
  }
}

function sameHeadcounts(ballot: number[] | null, current: number[]): boolean {
  if (!ballot) return true;
  const left = normalizeNightHeadcounts(ballot);
  const right = normalizeNightHeadcounts(current);
  return left.every((count, index) => count === right[index]);
}

function dinnerNeedsPortions(meal: BotWorkMeal): boolean {
  switch (meal.lifecycle) {
    case "passive":
    case "proposed":
      return meal.servings !== meal.expectedServings;
    case "swapped":
    case "removed":
    case "request_new_meal":
      return false;
    default: {
      const _exhaustive: never = meal.lifecycle;
      return _exhaustive;
    }
  }
}

/**
 * Plate or people drift is bot work only while a dinner's servings still
 * disagree with the current plates. Once servings match, the change is applied
 * and the bot stays quiet.
 */
export function botWorkReason(input: {
  setupComplete: boolean;
  ballotStatus: BallotRequestStatus | null;
  ballotHouseholdSize: number | null;
  ballotNightHeadcounts: number[] | null;
  householdSize: number;
  nightHeadcounts: number[];
  meals: BotWorkMeal[];
  /** Locked week still missing recipes and/or a shopping list. */
  fillPending?: boolean;
  /** Choice3 nights still missing 3 options or waiting on a new set. */
  optionNightsNeeded?: number;
}): BotWorkReason {
  const portionGap = input.meals.some(dinnerNeedsPortions);
  const ballotWritten = input.ballotStatus === "fulfilled" || input.ballotStatus === "cancelled";
  const sizeDrift =
    input.ballotHouseholdSize != null &&
    clampHouseholdSize(input.ballotHouseholdSize) !== clampHouseholdSize(input.householdSize);
  const plateDrift = ballotWritten && (sizeDrift || !sameHeadcounts(input.ballotNightHeadcounts, input.nightHeadcounts));

  if (input.ballotStatus === "pending") return "pending_ballot";
  if ((input.optionNightsNeeded ?? 0) > 0) return "options_pending";
  if (
    input.meals.some(
      (meal) =>
        meal.awaitingTitle === true ||
        meal.lifecycle === "swapped" ||
        meal.lifecycle === "request_new_meal",
    )
  ) {
    return "meal_pending";
  }
  if (plateDrift && portionGap) return "plate_or_people_change";
  if (portionGap) return "portion_pending";
  if (input.fillPending) return "fill_pending";
  if (!input.setupComplete) return "setup_incomplete";
  return "idle";
}

export function botWorkNeedsAction(reason: BotWorkReason): boolean {
  switch (reason) {
    case "pending_ballot":
    case "options_pending":
    case "meal_pending":
    case "plate_or_people_change":
    case "portion_pending":
    case "fill_pending":
      return true;
    case "setup_incomplete":
    case "idle":
      return false;
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

export function botCheckPhase(reason: BotWorkReason): BotCheckPhase {
  switch (reason) {
    case "idle":
      return "idle";
    case "pending_ballot":
    case "options_pending":
    case "meal_pending":
    case "plate_or_people_change":
    case "portion_pending":
    case "fill_pending":
    case "setup_incomplete":
      return "active";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

export function effectiveIntervalHours(input: {
  mode: BotCheckMode;
  intervalHours: BotCheckIntervalHours | null;
  phase: BotCheckPhase;
}): BotCheckIntervalHours {
  switch (input.mode) {
    case "fixed":
      return input.intervalHours ?? (input.phase === "active" ? ADAPTIVE_ACTIVE_HOURS : ADAPTIVE_IDLE_HOURS);
    case "adaptive":
      return input.phase === "active" ? ADAPTIVE_ACTIVE_HOURS : ADAPTIVE_IDLE_HOURS;
    default: {
      const _exhaustive: never = input.mode;
      return _exhaustive;
    }
  }
}

export function deriveBotCheckStatus(input: {
  mode: unknown;
  intervalHours: unknown;
  setupComplete: boolean;
  ballotStatus: BallotRequestStatus | null;
  ballotHouseholdSize: number | null;
  ballotNightHeadcounts: number[] | null;
  householdSize: number;
  nightHeadcounts: number[];
  meals: BotWorkMeal[];
  fillPending?: boolean;
  optionNightsNeeded?: number;
}): BotCheckStatus {
  const setting = normalizeBotCheckSetting(input.mode, input.intervalHours);
  const reason = botWorkReason({
    setupComplete: input.setupComplete,
    ballotStatus: input.ballotStatus,
    ballotHouseholdSize: input.ballotHouseholdSize,
    ballotNightHeadcounts: input.ballotNightHeadcounts,
    householdSize: input.householdSize,
    nightHeadcounts: input.nightHeadcounts,
    meals: input.meals,
    fillPending: input.fillPending,
    optionNightsNeeded: input.optionNightsNeeded,
  });
  const phase = botCheckPhase(reason);
  return {
    needs_work: botWorkNeedsAction(reason),
    reason,
    cadence: {
      mode: setting.mode,
      interval_hours: effectiveIntervalHours({
        mode: setting.mode,
        intervalHours: setting.intervalHours,
        phase,
      }),
      phase,
    },
  };
}

export function fixedWaitingCadenceLine(hours: BotCheckIntervalHours): string {
  switch (hours) {
    case 1:
      return "Checks every 1 hour.";
    case 3:
      return "Checks every 3 hours.";
    case 6:
      return "Checks every 6 hours.";
    default: {
      const _exhaustive: never = hours;
      return _exhaustive;
    }
  }
}

/** Cadence line for Waiting. Null when nothing is waiting (idle). */
export function waitingCadenceLine(
  status: BotCheckStatus,
  options?: { pendingWorkOnly?: boolean },
): string | null {
  if (status.cadence.phase !== "active") return null;
  if (options?.pendingWorkOnly && !status.needs_work) return null;
  switch (status.cadence.mode) {
    case "adaptive":
      return BOT_CHECK_WAITING_ADAPTIVE;
    case "fixed":
      return fixedWaitingCadenceLine(status.cadence.interval_hours);
    default: {
      const _exhaustive: never = status.cadence.mode;
      return _exhaustive;
    }
  }
}

/** Pending work on any open week wins. A settled cooking week does not hide a planning ballot. */
export function preferBotCheckStatus(statuses: readonly BotCheckStatus[]): BotCheckStatus {
  const list = statuses.filter((status) => status != null);
  const first = list[0];
  if (!first) {
    throw new Error("No week to check.");
  }
  for (const reason of BOT_WORK_REASONS) {
    if (!botWorkNeedsAction(reason)) continue;
    const match = list.find((status) => status.reason === reason);
    if (match) return match;
  }
  const setup = list.find((status) => status.reason === "setup_incomplete");
  if (setup) return setup;
  return first;
}

export function botCheckForHousehold(
  snapshot: Pick<
    HouseholdSnapshot,
    | "household"
    | "meals"
    | "votes"
    | "memberships"
    | "ballotRequest"
    | "week"
    | "recipes"
    | "shoppingList"
    | "planning"
    | "options"
    | "optionRequests"
  >,
): BotCheckStatus {
  const cooking = botCheckForSnapshot(snapshot);
  if (!snapshot.planning) return cooking;
  const planning = botCheckForSnapshot({
    household: snapshot.household,
    meals: snapshot.planning.meals,
    votes: snapshot.planning.votes,
    memberships: snapshot.memberships,
    ballotRequest: snapshot.planning.ballotRequest,
    week: snapshot.planning.week,
    recipes: snapshot.planning.recipes,
    shoppingList: snapshot.planning.shoppingList,
    options: snapshot.planning.options,
    optionRequests: snapshot.planning.optionRequests,
  });
  return preferBotCheckStatus([cooking, planning]);
}

function savedWeekPlates(week?: { nightHeadcounts?: number[] | null }): number[] | null {
  const saved = week?.nightHeadcounts;
  if (Array.isArray(saved) && saved.length === 7) return normalizeNightHeadcounts(saved);
  return null;
}

function mealFacts(
  household: BotCheckHousehold,
  weekPlates: number[] | null,
  meals: BotCheckMeal[],
  votes: Vote[],
  memberships: Membership[],
): BotWorkMeal[] {
  const source = weekPlates ? { ...household, nightHeadcounts: weekPlates } : null;
  return meals.map((meal) => ({
    lifecycle: nightLifecycle(meal, votes, memberships),
    awaitingTitle: awaitingMealSlot(meal, votes, memberships),
    servings: meal.servings,
    expectedServings: source
      ? headcountForNight(source, meal.nightDate)
      : meal.servings,
  }));
}

type ChoiceWeek = Pick<Week, "status"> & {
  id?: string;
  startsOn?: string | null;
  ballotMode?: Week["ballotMode"];
  finalizedAt?: string | null;
  nightHeadcounts?: number[] | null;
  editableFrom?: string | null;
};

function choiceWeekOpen(week: ChoiceWeek | undefined, ballotStatus: BallotRequest["status"] | null): boolean {
  return (
    week?.ballotMode === "choice3" &&
    week.status === "voting" &&
    !week.finalizedAt &&
    ballotStatus != null &&
    ballotStatus !== "pending"
  );
}

function choiceWorkNights(
  snapshot: {
    household: BotCheckHousehold;
    week: ChoiceWeek;
    options?: readonly MealOption[];
    optionRequests?: readonly OptionRequest[];
  },
  reason: BotWorkReason,
): BotWorkNight[] | undefined {
  if (snapshot.week.ballotMode !== "choice3" || !snapshot.week.startsOn) return undefined;
  const nights = choiceNights({
    week: {
      startsOn: snapshot.week.startsOn,
      editableFrom: snapshot.week.editableFrom ?? null,
      nightHeadcounts: snapshot.week.nightHeadcounts ?? null,
    },
    household: snapshot.household,
    options: snapshot.options ?? [],
    optionRequests: snapshot.optionRequests ?? [],
  });
  if (reason === "pending_ballot") {
    return nights.map((night) => ({
      day_index: night.dayIndex,
      night_date: night.nightDate,
      plates: night.plates,
      need: "options" as const,
    }));
  }
  if (reason === "options_pending") {
    return nights.flatMap((night): BotWorkNight[] => {
      if (night.pendingRequest) {
        return [{
          day_index: night.dayIndex,
          night_date: night.nightDate,
          plates: night.plates,
          need: "new_options" as const,
          note: night.pendingRequest.note,
        }];
      }
      if (night.options.length !== 3) {
        return [{
          day_index: night.dayIndex,
          night_date: night.nightDate,
          plates: night.plates,
          need: "options" as const,
        }];
      }
      return [];
    });
  }
  return undefined;
}

export function botCheckForSnapshot(snapshot: {
  household: BotCheckHousehold;
  meals: BotCheckMeal[];
  votes: Vote[];
  memberships: Membership[];
  ballotRequest?: Pick<BallotRequest, "status" | "householdSize" | "nightHeadcounts"> | null;
  week?: ChoiceWeek;
  recipes?: Recipe[];
  shoppingList?: { items: readonly unknown[] } | null;
  options?: readonly MealOption[];
  optionRequests?: readonly OptionRequest[];
}): BotCheckStatus {
  const household = snapshot.household;
  const weekPlates = savedWeekPlates(snapshot.week);
  const ballot = snapshot.ballotRequest ?? null;
  const ballotStatus = ballot ? parseBallotRequestStatus(ballot.status) : null;
  const fillPending = snapshot.week
    ? isPendingBotFill({
        weekStatus: snapshot.week.status,
        meals: snapshot.meals,
        votes: snapshot.votes,
        memberships: snapshot.memberships,
        recipes: snapshot.recipes ?? [],
        shoppingList: snapshot.shoppingList ?? null,
      })
    : false;
  const nights = snapshot.week
    ? choiceNights({
        week: {
          startsOn: snapshot.week.startsOn ?? "",
          editableFrom: snapshot.week.editableFrom ?? null,
          nightHeadcounts: snapshot.week.nightHeadcounts ?? null,
        },
        household,
        options: snapshot.options ?? [],
        optionRequests: snapshot.optionRequests ?? [],
      })
    : [];
  const optionNightsNeeded = choiceWeekOpen(snapshot.week, ballotStatus)
    ? nights.filter((night) => night.pendingRequest || night.options.length !== 3).length
    : 0;
  const status = deriveBotCheckStatus({
    mode: household.botCheckMode,
    intervalHours: household.botCheckIntervalHours,
    setupComplete: isHouseSetupComplete(household.setupStep),
    ballotStatus,
    ballotHouseholdSize: ballot?.householdSize ?? null,
    ballotNightHeadcounts: ballot?.nightHeadcounts ?? null,
    householdSize: household.householdSize,
    nightHeadcounts: weekPlates ?? ballot?.nightHeadcounts ?? household.nightHeadcounts,
    meals: mealFacts(household, weekPlates, snapshot.meals, snapshot.votes, snapshot.memberships),
    fillPending,
    optionNightsNeeded,
  });
  if (!status.needs_work || !snapshot.week?.id) return status;
  const workNights = choiceWorkNights(
    {
      household,
      week: snapshot.week,
      options: snapshot.options,
      optionRequests: snapshot.optionRequests,
    },
    status.reason,
  );
  return {
    ...status,
    work: {
      week_id: snapshot.week.id,
      starts_on: snapshot.week.startsOn ?? null,
      ballot_mode: snapshot.week.ballotMode ?? "single",
      ...(workNights ? { nights: workNights } : {}),
    },
  };
}
