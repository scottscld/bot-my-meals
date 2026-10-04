import { weekdayLabelFromNight } from "./dates";
import { memberInitials } from "./initials";
import { memberName } from "./names";
import type { Meal, Membership, NightLifecycle, Role, Vote, VoteChoice } from "./types";

export const LAST_WRITER_WINS_TOAST = "Updated for this night.";

export function votingMembers(memberships: Membership[]): Membership[] {
  return memberships.filter((member) => member.role === "owner" || member.role === "voter");
}

export function canActOnBallot(role: Role | null | undefined): boolean {
  return role === "owner" || role === "voter";
}

export function voteFor(
  votes: Vote[],
  mealId: string,
  membershipId: string,
): Vote | undefined {
  return votes.find((vote) => vote.mealId === mealId && vote.membershipId === membershipId);
}

/** Map stored/legacy choices. `skip` → `remove`. `approve` drops (absence = passive). */
export function migrateVoteChoice(choice: string | null | undefined): VoteChoice | null {
  switch (choice) {
    case "swap":
      return "swap";
    case "remove":
    case "skip":
      return "remove";
    case "request_new_meal":
      return "request_new_meal";
    case "approve":
    case null:
    case undefined:
      return null;
    default:
      return null;
  }
}

export function latestVoteForMeal(
  votes: Vote[],
  mealId: string,
  memberships?: Membership[],
): Vote | undefined {
  const allowed = memberships
    ? new Set(votingMembers(memberships).map((member) => member.id))
    : null;
  return votes
    .filter((vote) => {
      if (vote.mealId !== mealId) return false;
      if (allowed && !allowed.has(vote.membershipId)) return false;
      return migrateVoteChoice(vote.choice) != null;
    })
    .sort((a, b) => {
      const byTime = a.updatedAt.localeCompare(b.updatedAt);
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
    })
    .at(-1);
}

export function lastWriterWinsToast(
  previous: Vote | undefined,
  nextMembershipId: string,
): string | undefined {
  if (previous && previous.membershipId !== nextMembershipId) {
    return LAST_WRITER_WINS_TOAST;
  }
  return undefined;
}

export const LOCK_OK_LIFECYCLES: readonly NightLifecycle[] = [
  "passive",
  "removed",
  "proposed",
];

export const LOCK_BLOCK_LIFECYCLES: readonly NightLifecycle[] = [
  "swapped",
  "request_new_meal",
];

export function isLockBlockingLifecycle(lifecycle: NightLifecycle): boolean {
  switch (lifecycle) {
    case "swapped":
    case "request_new_meal":
      return true;
    case "passive":
    case "removed":
    case "proposed":
      return false;
    default: {
      const _exhaustive: never = lifecycle;
      return _exhaustive;
    }
  }
}

export function nightLifecycle(
  meal: Pick<Meal, "id" | "title">,
  votes: Vote[],
  memberships?: Membership[],
): NightLifecycle {
  const latest = latestVoteForMeal(votes, meal.id, memberships);
  const choice = latest ? migrateVoteChoice(latest.choice) : null;
  if (choice) {
    switch (choice) {
      case "swap":
        return "swapped";
      case "remove":
        return "removed";
      case "request_new_meal":
        return "request_new_meal";
      default: {
        const _exhaustive: never = choice;
        return _exhaustive;
      }
    }
  }
  return meal.title.trim() ? "passive" : "removed";
}

export type LockBlockerStatus = "swapped" | "request_new_meal";

export type LockCheck = {
  ready: boolean;
  reason: string;
  blockers: Array<{ mealId: string; status: LockBlockerStatus }>;
};

export function pendingAddLockReason(count: number, dayLabel?: string): string {
  if (count === 1) {
    return `Waiting on a new dinner for ${dayLabel}.`;
  }
  return `${count} dinner requests still open.`;
}

function lockReason(input: {
  voters: number;
  nightSlots: number;
  swapCount: number;
  pendingAddCount: number;
  pendingAddDay?: string;
}): string {
  if (!input.voters) return "This household needs at least one voter.";
  if (!input.nightSlots) return "Add dinners before you can lock this week.";
  if (input.swapCount && input.pendingAddCount) {
    return `${input.swapCount} open swap${input.swapCount === 1 ? "" : "s"} and ${input.pendingAddCount} pending meal${input.pendingAddCount === 1 ? "" : "s"} still block lock.`;
  }
  if (input.swapCount) {
    return input.swapCount === 1
      ? "One night still has a swap request."
      : `${input.swapCount} nights still have swap requests.`;
  }
  if (input.pendingAddCount) {
    return pendingAddLockReason(input.pendingAddCount, input.pendingAddDay);
  }
  return "Nights are set. No open swaps or pending meals.";
}

export function checkWeekLock(
  meals: Meal[],
  votes: Vote[],
  memberships: Membership[],
): LockCheck {
  const voters = votingMembers(memberships);
  const blockers: LockCheck["blockers"] = [];

  for (const meal of meals) {
    const lifecycle = nightLifecycle(meal, votes, memberships);
    if (lifecycle === "swapped" || lifecycle === "request_new_meal") {
      blockers.push({ mealId: meal.id, status: lifecycle });
    }
  }

  const swapCount = blockers.filter((item) => item.status === "swapped").length;
  const pendingAddIds = new Set(
    blockers.filter((item) => item.status === "request_new_meal").map((item) => item.mealId),
  );
  const pendingAddCount = pendingAddIds.size;
  const pendingAddMeal = meals.find((meal) => pendingAddIds.has(meal.id));

  return {
    ready: blockers.length === 0 && voters.length > 0 && meals.length > 0,
    reason: lockReason({
      voters: voters.length,
      nightSlots: meals.length,
      swapCount,
      pendingAddCount,
      pendingAddDay: pendingAddMeal ? weekdayLabelFromNight(pendingAddMeal.nightDate) : undefined,
    }),
    blockers,
  };
}

export function isNightOff(
  mealId: string,
  votes: Vote[],
  memberships?: Membership[],
): boolean {
  const latest = latestVoteForMeal(votes, mealId, memberships);
  return migrateVoteChoice(latest?.choice) === "remove";
}

export type VoterProgress = {
  membershipId: string;
  displayName: string;
  email?: string;
  initials: string;
  done: boolean;
  remaining: number;
  completed: number;
  total: number;
};

export function weekVoterProgress(
  meals: Meal[],
  votes: Vote[],
  memberships: Membership[],
): VoterProgress[] {
  const voters = votingMembers(memberships);
  const total = meals.length;
  const remaining = meals.filter((meal) =>
    isLockBlockingLifecycle(nightLifecycle(meal, votes, memberships)),
  ).length;
  return voters.map((voter) => ({
    membershipId: voter.id,
    displayName: memberName(voter),
    email: voter.email,
    initials: memberInitials(memberName(voter)),
    done: remaining === 0 && total > 0,
    remaining,
    completed: total - remaining,
    total,
  }));
}

export function voterProgressSummary(progress: VoterProgress[]): string {
  const outstanding = progress.filter((item) => !item.done);
  if (progress.length === 0) return "Add a voting member to start.";
  if (outstanding.length === 0) {
    return progress[0]?.total === 0 ? "Add dinners so voting can start." : "Every voter is in.";
  }
  if (outstanding.length === 1) {
    const person = outstanding[0];
    return person.remaining === 1
      ? `${person.displayName} has 1 night left.`
      : `${person.displayName} has ${person.remaining} nights left.`;
  }
  const doneCount = progress.length - outstanding.length;
  return `${doneCount} of ${progress.length} voters done.`;
}
