import { describe, expect, it } from "vitest";
import { weekdayLabelFromNight } from "./dates";
import {
  LAST_WRITER_WINS_TOAST,
  canActOnBallot,
  checkWeekLock,
  isNightOff,
  lastWriterWinsToast,
  latestVoteForMeal,
  migrateVoteChoice,
  nightLifecycle,
  pendingAddLockReason,
  voterProgressSummary,
  weekVoterProgress,
} from "./lock";
import type { Meal, Membership, Vote } from "./types";

const voters: Membership[] = [
  {
    id: "alex",
    householdId: "h",
    userId: "u1",
    role: "owner",
    displayName: "Alex Rivera",
    email: "alex@example.com",
  },
  {
    id: "sam",
    householdId: "h",
    userId: "u2",
    role: "voter",
    displayName: "Sam",
    email: "sam@example.com",
  },
];

const meals: Meal[] = [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => ({
  id: `m${dayIndex}`,
  householdId: "h",
  weekId: "w",
  dayIndex,
  nightDate: `2026-08-3${dayIndex}`,
  title: `Meal ${dayIndex}`,
  pitch: "",
  audience: dayIndex >= 5 ? "couple" : "family",
  servings: dayIndex >= 5 ? 2 : 4,
  prepMinutes: 30,
  isLeftovers: false,
  leftoverOfMealId: null,
  estimatedCostCents: null,
  estimatedCostSource: null,
  estimatedCostAsOf: null,
  sourceOptionId: null,
}));

function vote(
  membershipId: string,
  mealId: string,
  choice: Vote["choice"],
  updatedAt = "2026-09-02T00:00:00.000Z",
): Vote {
  return {
    id: `${membershipId}-${mealId}-${updatedAt}`,
    householdId: "h",
    mealId,
    membershipId,
    choice,
    note: choice === "swap" ? "too heavy" : "",
    updatedAt,
  };
}

describe("migrateVoteChoice", () => {
  it("maps skip to remove and drops approve", () => {
    expect(migrateVoteChoice("skip")).toBe("remove");
    expect(migrateVoteChoice("remove")).toBe("remove");
    expect(migrateVoteChoice("swap")).toBe("swap");
    expect(migrateVoteChoice("request_new_meal")).toBe("request_new_meal");
    expect(migrateVoteChoice("approve")).toBeNull();
  });
});

describe("nightLifecycle", () => {
  it("treats absence of a vote as passive approve", () => {
    expect(nightLifecycle(meals[0], [], voters)).toBe("passive");
  });

  it("uses last writer for swapped, removed, and pending add", () => {
    expect(nightLifecycle(meals[0], [vote("alex", "m0", "swap")], voters)).toBe("swapped");
    expect(nightLifecycle(meals[1], [vote("sam", "m1", "remove")], voters)).toBe("removed");
    expect(nightLifecycle(meals[2], [vote("alex", "m2", "request_new_meal")], voters)).toBe(
      "request_new_meal",
    );
    expect(
      nightLifecycle(
        meals[0],
        [vote("alex", "m0", "swap", "2026-09-02T00:00:00.000Z"), vote("sam", "m0", "remove", "2026-09-02T01:00:00.000Z")],
        voters,
      ),
    ).toBe("removed");
  });
});

describe("checkWeekLock", () => {
  it("blocks lock when a night has an open swap", () => {
    const votes = [vote("alex", "m2", "swap")];
    const result = checkWeekLock(meals, votes, voters);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([{ mealId: "m2", status: "swapped" }]);
    expect(result.reason).toBe("One night still has a swap request.");
  });

  it("blocks lock when a night has a pending add", () => {
    const votes = [vote("sam", "m4", "request_new_meal")];
    const result = checkWeekLock(meals, votes, voters);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([{ mealId: "m4", status: "request_new_meal" }]);
    expect(result.reason).toBe(
      pendingAddLockReason(1, weekdayLabelFromNight(meals[4].nightDate)),
    );
    expect(result.reason).toBe(
      `Waiting on a new dinner for ${weekdayLabelFromNight(meals[4].nightDate)}.`,
    );
  });

  it("names the count when several dinner requests are open", () => {
    const votes = [vote("sam", "m4", "request_new_meal"), vote("alex", "m5", "request_new_meal")];
    const result = checkWeekLock(meals, votes, voters);
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("2 dinner requests still open.");
    expect(pendingAddLockReason(2)).toBe("2 dinner requests still open.");
  });

  it("is ready when nights are only passive and removed", () => {
    const votes = [vote("alex", "m6", "remove")];
    const result = checkWeekLock(meals, votes, voters);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(isNightOff("m6", votes, voters)).toBe(true);
    expect(isNightOff("m0", votes, voters)).toBe(false);
  });

  it("is ready with no vote rows — absence is passive approve", () => {
    expect(checkWeekLock(meals, [], voters).ready).toBe(true);
  });

  it("ignores eaters when deciding lock", () => {
    const withEater: Membership[] = [
      ...voters,
      {
        id: "kid",
        householdId: "h",
        userId: "u3",
        role: "eater",
        displayName: "Jordan",
        email: "",
      },
    ];
    expect(checkWeekLock(meals, [], withEater).ready).toBe(true);
    expect(
      checkWeekLock(meals, [vote("kid", "m0", "swap")], withEater).ready,
    ).toBe(true);
  });

  it("asks for dinners before lock when the week has no night slots", () => {
    const result = checkWeekLock([], [], voters);
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("Add dinners before you can lock this week.");
  });

  it("needs at least one voting member", () => {
    const eatersOnly: Membership[] = [
      {
        id: "kid",
        householdId: "h",
        userId: "u3",
        role: "eater",
        displayName: "Jordan",
        email: "",
      },
    ];
    const result = checkWeekLock(meals, [], eatersOnly);
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("This household needs at least one voter.");
  });
});

describe("canActOnBallot and last writer", () => {
  it("lets owner or voter act and keeps eaters read-only", () => {
    expect(canActOnBallot("owner")).toBe(true);
    expect(canActOnBallot("voter")).toBe(true);
    expect(canActOnBallot("eater")).toBe(false);
    expect(canActOnBallot(null)).toBe(false);
  });

  it("toasts when a later writer overwrites someone else", () => {
    const previous = vote("alex", "m0", "swap");
    expect(LAST_WRITER_WINS_TOAST).toBe("Updated for this night.");
    expect(lastWriterWinsToast(previous, "sam")).toBe("Updated for this night.");
    expect(lastWriterWinsToast(previous, "alex")).toBeUndefined();
    expect(lastWriterWinsToast(undefined, "sam")).toBeUndefined();
    expect(latestVoteForMeal([previous, vote("sam", "m0", "remove", "2026-09-03T00:00:00.000Z")], "m0")?.membershipId).toBe(
      "sam",
    );
  });
});

describe("weekVoterProgress", () => {
  it("counts household blockers, not missing approve rows", () => {
    const votes = [vote("sam", "m0", "swap")];
    const progress = weekVoterProgress(meals.slice(0, 2), votes, voters);
    expect(progress).toEqual([
      {
        membershipId: "alex",
        displayName: "Alex Rivera",
        initials: "AR",
        done: false,
        remaining: 1,
        completed: 1,
        total: 2,
      },
      {
        membershipId: "sam",
        displayName: "Sam",
        initials: "SA",
        done: false,
        remaining: 1,
        completed: 1,
        total: 2,
      },
    ]);
    expect(voterProgressSummary(progress)).toBe("0 of 2 voters done.");
  });

  it("treats a fully passive week as everyone in", () => {
    const progress = weekVoterProgress(meals, [], voters);
    expect(progress.every((item) => item.done)).toBe(true);
    expect(voterProgressSummary(progress)).toBe("Every voter is in.");
  });

  it("ignores eaters and treats removed nights as done", () => {
    const eater: Membership = {
      id: "kid",
      householdId: "h",
      userId: "u-kid",
      role: "eater",
      displayName: "Jordan",
      email: "jordan@example.com",
    };
    const votes = [vote("alex", "m6", "remove")];
    const progress = weekVoterProgress(meals, votes, [...voters, eater]);
    expect(progress.map((item) => item.displayName)).toEqual(["Alex Rivera", "Sam"]);
    expect(progress.every((item) => item.done)).toBe(true);
    expect(voterProgressSummary(progress)).toBe("Every voter is in.");
  });
});
