import { addDays, weekdayShortFromNight } from "./dates";
import { headcountForNight } from "./headcount";
import { votingMembers } from "./lock";
import type {
  Household,
  MealOption,
  MealPick,
  Membership,
  OptionRequest,
  VoteSubmission,
  Week,
} from "./types";

export const LOCK_IN_LABEL = "Lock in my vote";
export const LOCK_IN_CONFIRM_TITLE = "Lock in your picks?";
export const LOCK_IN_CONFIRM_BODY =
  "You can\u2019t change them after this unless an Admin reopens your vote.";
export const LOCK_IN_CONFIRM_ACTION = "Lock in";
export const LOCK_IN_KEEP = "Keep picking";
export const LOCKED_IN_SELF = "You\u2019re locked in.";
export const NONE_OF_THESE = "None of these";
export const NONE_OF_THESE_SHEET_TITLE = "Ask for 3 new options";
export const NEW_OPTIONS_PENDING = "New options on the way\u2026";
export const RESULTS_TITLE = "How the house voted";
export const REOPEN_VOTE_LABEL = "Reopen vote";
export const EVERYONE_IN = "Everyone\u2019s in";
export const ASK_FOR_NEW_OPTIONS = "Ask for new options";
export const TIE_ADMIN_LABEL = "Tie \u00b7 Admin\u2019s pick";
export const TIE_BOT_LABEL = "Tie \u00b7 Bot\u2019s first pick";

export function isChoiceVoting(
  week: Pick<Week, "ballotMode" | "status" | "finalizedAt">,
): boolean {
  return week.ballotMode === "choice3" && week.status === "voting" && !week.finalizedAt;
}

export type ChoiceNight = {
  dayIndex: number;
  nightDate: string;
  plates: number;
  options: MealOption[];
  pendingRequest: OptionRequest | null;
};

export function choiceNights(input: {
  week: Pick<Week, "startsOn" | "editableFrom" | "nightHeadcounts">;
  household: Pick<Household, "nightHeadcounts" | "coupleNights" | "familySize" | "coupleSize">;
  options: readonly MealOption[];
  optionRequests: readonly OptionRequest[];
}): ChoiceNight[] {
  if (!input.week.startsOn) return [];
  const platesSource = {
    nightHeadcounts:
      input.week.nightHeadcounts && input.week.nightHeadcounts.length === 7
        ? input.week.nightHeadcounts
        : input.household.nightHeadcounts,
    coupleNights: input.household.coupleNights,
    familySize: input.household.familySize,
    coupleSize: input.household.coupleSize,
  };
  const nights: ChoiceNight[] = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const nightDate = addDays(input.week.startsOn, dayIndex);
    if (input.week.editableFrom && nightDate < input.week.editableFrom) continue;
    const plates = headcountForNight(platesSource, nightDate);
    if (plates <= 0) continue;
    const options = input.options
      .filter((option) => option.dayIndex === dayIndex)
      .slice()
      .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
    const pendingRequest =
      input.optionRequests.find(
        (request) => request.dayIndex === dayIndex && request.status === "pending",
      ) ?? null;
    nights.push({ dayIndex, nightDate, plates, options, pendingRequest });
  }
  return nights;
}

export function myPicksByNight(
  picks: readonly MealPick[],
  membershipId: string | null | undefined,
): Map<number, string> {
  const map = new Map<number, string>();
  if (!membershipId) return map;
  for (const pick of picks) {
    if (pick.membershipId === membershipId) map.set(pick.dayIndex, pick.optionId);
  }
  return map;
}

export function pickProgress(
  nights: readonly ChoiceNight[],
  myPicks: ReadonlyMap<number, string>,
): { picked: number; total: number } {
  return {
    picked: nights.filter((night) => myPicks.has(night.dayIndex)).length,
    total: nights.length,
  };
}

export function pickProgressLabel(progress: { picked: number; total: number }): string {
  return `${progress.picked} of ${progress.total} nights picked`;
}

export function lockInReady(input: {
  nights: readonly ChoiceNight[];
  myPicks: ReadonlyMap<number, string>;
  submitted: boolean;
  canVote: boolean;
}): boolean {
  if (!input.canVote || input.submitted || input.nights.length === 0) return false;
  if (input.nights.some((night) => night.pendingRequest || night.options.length !== 3)) return false;
  return input.nights.every((night) => input.myPicks.has(night.dayIndex));
}

export function lockInHint(
  nights: readonly ChoiceNight[],
  myPicks: ReadonlyMap<number, string>,
): string | null {
  const blocked = nights.find((night) => night.pendingRequest || night.options.length !== 3);
  if (blocked) {
    const day = weekdayShortFromNight(blocked.nightDate);
    return blocked.pendingRequest
      ? `Waiting on new options for ${day}`
      : `Waiting on options for ${day}`;
  }
  const missing = nights.filter((night) => !myPicks.has(night.dayIndex)).length;
  if (missing <= 0) return null;
  return missing === 1 ? "Pick 1 more night" : `Pick ${missing} more nights`;
}

export function waitingOn(
  memberships: readonly Membership[],
  submissions: readonly VoteSubmission[],
): Membership[] {
  const submitted = new Set(submissions.map((row) => row.membershipId));
  return votingMembers([...memberships]).filter((member) => !submitted.has(member.id));
}

export function waitingOnLabel(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `Waiting on ${names[0]}`;
  if (names.length === 2) return `Waiting on ${names[0]} and ${names[1]}`;
  return `Waiting on ${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export type NightTally = {
  optionId: string;
  votes: number;
  voterIds: string[];
};

export function tallyNight(
  options: readonly MealOption[],
  picks: readonly MealPick[],
  memberships: readonly Membership[],
): NightTally[] {
  const voters = new Set(votingMembers([...memberships]).map((member) => member.id));
  return options.map((option) => {
    const voterIds = picks
      .filter((pick) => pick.optionId === option.id && voters.has(pick.membershipId))
      .map((pick) => pick.membershipId);
    return { optionId: option.id, votes: voterIds.length, voterIds };
  });
}

type OwnerClock = Membership & { createdAt?: string | null };

function earliestOwnerAt(
  optionId: string,
  picks: readonly MealPick[],
  memberships: readonly OwnerClock[],
): string | null {
  const pickers = new Set(
    picks.filter((pick) => pick.optionId === optionId).map((pick) => pick.membershipId),
  );
  const stamps = memberships
    .filter((member) => member.role === "owner" && pickers.has(member.id) && member.createdAt)
    .map((member) => member.createdAt as string)
    .sort();
  return stamps[0] ?? null;
}

export function winnerForNight(
  options: readonly MealOption[],
  picks: readonly MealPick[],
  memberships: readonly OwnerClock[],
): { option: MealOption; votes: number; tie: "admin" | "bot" | null } | null {
  if (options.length === 0) return null;
  const tallies = tallyNight(options, picks, memberships);
  const votesOf = (optionId: string) =>
    tallies.find((row) => row.optionId === optionId)?.votes ?? 0;
  const ranked = [...options].sort((a, b) => {
    const voteGap = votesOf(b.id) - votesOf(a.id);
    if (voteGap !== 0) return voteGap;
    const ownerA = earliestOwnerAt(a.id, picks, memberships);
    const ownerB = earliestOwnerAt(b.id, picks, memberships);
    if (ownerA == null && ownerB != null) return 1;
    if (ownerA != null && ownerB == null) return -1;
    if (ownerA != null && ownerB != null && ownerA !== ownerB) return ownerA.localeCompare(ownerB);
    return a.rank - b.rank;
  });
  const winner = ranked[0];
  if (!winner) return null;
  const votes = votesOf(winner.id);
  const tied = ranked.filter((option) => votesOf(option.id) === votes);
  const tie =
    tied.length > 1
      ? earliestOwnerAt(winner.id, picks, memberships) != null
        ? "admin"
        : "bot"
      : null;
  return { option: winner, votes, tie };
}

export function tieBreakLabel(tie: "admin" | "bot" | null): string | null {
  if (tie === "admin") return TIE_ADMIN_LABEL;
  if (tie === "bot") return TIE_BOT_LABEL;
  return null;
}
