import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASK_FOR_NEW_OPTIONS,
  EVERYONE_IN,
  LOCK_IN_CONFIRM_ACTION,
  LOCK_IN_CONFIRM_BODY,
  LOCK_IN_CONFIRM_TITLE,
  LOCK_IN_KEEP,
  LOCK_IN_LABEL,
  LOCKED_IN_SELF,
  NEW_OPTIONS_PENDING,
  NONE_OF_THESE,
  NONE_OF_THESE_SHEET_TITLE,
  REOPEN_VOTE_LABEL,
  RESULTS_TITLE,
  TIE_ADMIN_LABEL,
  TIE_BOT_LABEL,
  choiceNights,
  lockInReady,
  myPicksByNight,
  pickProgress,
  pickProgressLabel,
  tallyNight,
  waitingOn,
  waitingOnLabel,
  winnerForNight,
} from "./choice-ballot";
import type { Household, MealOption, MealPick, Membership, OptionRequest, Week } from "./types";

const household: Pick<Household, "nightHeadcounts" | "coupleNights" | "familySize" | "coupleSize"> = {
  nightHeadcounts: [0, 4, 0, 2, 4, 2, 0],
  coupleNights: [5],
  familySize: 4,
  coupleSize: 2,
};

function week(overrides: Partial<Week> = {}): Week {
  return {
    id: "week-1",
    householdId: "house",
    startsOn: "2026-10-04",
    status: "voting",
    lockedAt: null,
    editableFrom: null,
    shoppingPrompt: "open",
    peopleConfirmedAt: "2026-10-01T00:00:00.000Z",
    nightHeadcounts: household.nightHeadcounts,
    specialInstructions: null,
    ballotMode: "choice3",
    finalizedAt: null,
    ...overrides,
  };
}

function option(dayIndex: number, rank: number, id = `opt-${dayIndex}-${rank}`): MealOption {
  return {
    id,
    householdId: "house",
    weekId: "week-1",
    dayIndex,
    nightDate: "2026-10-04",
    rank,
    title: `Dish ${rank}`,
    pitch: "",
    servings: 4,
    prepMinutes: 20,
    recipeKey: null,
  };
}

function member(
  id: string,
  role: Membership["role"],
  name: string,
  createdAt?: string,
): Membership & { createdAt?: string } {
  return {
    id,
    householdId: "house",
    userId: id,
    role,
    displayName: name,
    email: `${id}@example.com`,
    createdAt,
  };
}

function pick(optionId: string, membershipId: string, dayIndex = 0): MealPick {
  return {
    id: `${optionId}-${membershipId}`,
    weekId: "week-1",
    dayIndex,
    optionId,
    membershipId,
    updatedAt: "2026-10-04T00:00:00.000Z",
  };
}

describe("choice nights", () => {
  it("skips off nights and frozen nights and maps plates by weekday", () => {
    const sunday = choiceNights({
      week: week(),
      household,
      options: [],
      optionRequests: [],
    });
    expect(sunday.map((night) => [night.nightDate, night.plates])).toEqual([
      ["2026-10-05", 4],
      ["2026-10-07", 2],
      ["2026-10-08", 4],
      ["2026-10-09", 2],
    ]);

    const wednesday = choiceNights({
      week: week({ startsOn: "2026-10-07" }),
      household,
      options: [],
      optionRequests: [],
    });
    expect(wednesday.map((night) => [night.nightDate, night.plates])).toEqual([
      ["2026-10-07", 2],
      ["2026-10-08", 4],
      ["2026-10-09", 2],
      ["2026-10-12", 4],
    ]);

    const frozen = choiceNights({
      week: week({ editableFrom: "2026-10-07" }),
      household,
      options: [option(1, 1)],
      optionRequests: [],
    });
    expect(frozen.map((night) => night.nightDate)).toEqual([
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
    expect(frozen[0]?.options).toEqual([]);
  });
});

describe("pick progress and lock in", () => {
  const fivePlates = [4, 4, 4, 4, 4, 0, 0];
  const nights = choiceNights({
    week: week({ nightHeadcounts: fivePlates }),
    household: { ...household, nightHeadcounts: fivePlates },
    options: [],
    optionRequests: [],
  });
  const readyNights = nights.map((night) => ({
    ...night,
    options: [option(night.dayIndex, 1), option(night.dayIndex, 2), option(night.dayIndex, 3)],
  }));

  it("labels an empty set and a full set", () => {
    expect(pickProgressLabel(pickProgress(readyNights, new Map()))).toContain("0 of 5");
    const full = myPicksByNight(
      readyNights.map((night) => pick(`opt-${night.dayIndex}-1`, "me", night.dayIndex)),
      "me",
    );
    expect(pickProgressLabel(pickProgress(readyNights, full))).toContain("5 of 5");
  });

  it("stays closed for a missing night, a pending request, a short set, a submit, and an eater", () => {
    const picks = myPicksByNight(
      readyNights.slice(0, 3).map((night) => pick(`opt-${night.dayIndex}-1`, "me", night.dayIndex)),
      "me",
    );
    expect(lockInReady({ nights: readyNights, myPicks: picks, submitted: false, canVote: true })).toBe(
      false,
    );
    const pending: OptionRequest = {
      id: "req",
      weekId: "week-1",
      dayIndex: readyNights[0]?.dayIndex ?? 0,
      requestedBy: "me",
      note: "tacos",
      status: "pending",
    };
    const withPending = readyNights.map((night, index) =>
      index === 0 ? { ...night, pendingRequest: pending } : night,
    );
    const all = myPicksByNight(
      readyNights.map((night) => pick(`opt-${night.dayIndex}-1`, "me", night.dayIndex)),
      "me",
    );
    expect(lockInReady({ nights: withPending, myPicks: all, submitted: false, canVote: true })).toBe(
      false,
    );
    const short = readyNights.map((night, index) =>
      index === 0 ? { ...night, options: night.options.slice(0, 2) } : night,
    );
    expect(lockInReady({ nights: short, myPicks: all, submitted: false, canVote: true })).toBe(false);
    expect(lockInReady({ nights: readyNights, myPicks: all, submitted: true, canVote: true })).toBe(
      false,
    );
    expect(lockInReady({ nights: readyNights, myPicks: all, submitted: false, canVote: false })).toBe(
      false,
    );
    expect(lockInReady({ nights: readyNights, myPicks: all, submitted: false, canVote: true })).toBe(
      true,
    );
  });
});

describe("waiting on voters", () => {
  const owner = member("o", "owner", "Sam");
  const voter = member("v", "voter", "Alex");
  const late = member("n", "voter", "Jo");
  const eater = member("e", "eater", "Pat");

  it("ignores eaters and includes a voter added mid-vote", () => {
    const waiting = waitingOn([owner, voter, late, eater], [
      { weekId: "week-1", membershipId: "o", submittedAt: "2026-10-04T00:00:00.000Z" },
    ]);
    expect(waiting.map((person) => person.displayName)).toEqual(["Alex", "Jo"]);
  });

  it("names one, two, and three people", () => {
    expect(waitingOnLabel(["Sam"])).toBe("Waiting on Sam");
    expect(waitingOnLabel(["Sam", "Alex"])).toBe("Waiting on Sam and Alex");
    expect(waitingOnLabel(["Sam", "Alex", "Jo"])).toBe("Waiting on Sam, Alex, and Jo");
  });
});

describe("tally and winner", () => {
  const options = [option(0, 1, "a"), option(0, 2, "b")];
  const early = member("early", "owner", "Sam", "2020-01-01T00:00:00.000Z");
  const late = member("late", "owner", "Alex", "2024-01-01T00:00:00.000Z");
  const voter = member("voter", "voter", "Jo");
  const eater = member("eater", "eater", "Pat");

  it("picks the clear winner and ignores an eater", () => {
    const picks = [pick("a", "voter"), pick("a", "early"), pick("b", "eater")];
    expect(tallyNight(options, picks, [early, voter, eater])).toEqual([
      { optionId: "a", votes: 2, voterIds: ["voter", "early"] },
      { optionId: "b", votes: 0, voterIds: [] },
    ]);
    expect(winnerForNight(options, picks, [early, voter, eater])?.option.id).toBe("a");
  });

  it("breaks a 1–1 tie with the earliest owner's pick, else rank 1", () => {
    const tied = [pick("b", "early"), pick("a", "late")];
    const ownerWin = winnerForNight(options, tied, [early, late]);
    expect(ownerWin?.option.id).toBe("b");
    expect(ownerWin?.tie).toBe("admin");
    const botWin = winnerForNight(options, [pick("a", "voter"), pick("b", "voter-2")], [
      early,
      voter,
      member("voter-2", "voter", "Nia"),
    ]);
    expect(botWin?.option.id).toBe("a");
    expect(botWin?.tie).toBe("bot");
  });
});

describe("choice copy", () => {
  it("avoids approve, skip, prices, and cart language", () => {
    const copy = [
      LOCK_IN_LABEL,
      LOCK_IN_CONFIRM_TITLE,
      LOCK_IN_CONFIRM_BODY,
      LOCK_IN_CONFIRM_ACTION,
      LOCK_IN_KEEP,
      LOCKED_IN_SELF,
      NONE_OF_THESE,
      NONE_OF_THESE_SHEET_TITLE,
      NEW_OPTIONS_PENDING,
      RESULTS_TITLE,
      REOPEN_VOTE_LABEL,
      EVERYONE_IN,
      ASK_FOR_NEW_OPTIONS,
      TIE_ADMIN_LABEL,
      TIE_BOT_LABEL,
    ].join(" ");
    expect(copy.toLowerCase()).not.toContain("approve");
    expect(copy.toLowerCase()).not.toContain("skip");
    expect(copy).not.toContain("$");
    expect(copy.toLowerCase()).not.toContain("cart");
  });

  it("keeps the carousel, lock-in bar, and week page wired", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const carousel = readFileSync(path.join(root, "components/option-carousel.tsx"), "utf8");
    const bar = readFileSync(path.join(root, "components/lock-in-bar.tsx"), "utf8");
    const week = readFileSync(path.join(root, "app/week/page.tsx"), "utf8");
    expect(carousel).toContain("snap-x snap-mandatory");
    expect(carousel).toContain("overscroll-x-contain");
    expect(carousel).toContain('role="radiogroup"');
    expect(carousel).toContain("aria-checked");
    expect(carousel).toContain("stopPropagation");
    expect(bar).toContain("LOCK_IN_LABEL");
    expect(bar).toContain("LOCK_IN_CONFIRM_TITLE");
    expect(bar).toContain("Dialog");
    expect(week).toContain("ChoiceBallot");
    expect(week).toContain("LockInBar");
  });
});
