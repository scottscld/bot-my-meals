import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { VoterProgress } from "./lock";
import {
  statusStripCopy,
  statusStripPeople,
  visibleProgressPeople,
  waitingOnCopy,
  waitingOnNames,
  weekStatusStripState,
  weekStatusStripVisible,
} from "./status-strip";

function voter(partial: Partial<VoterProgress> & Pick<VoterProgress, "membershipId" | "displayName">): VoterProgress {
  return {
    initials: partial.displayName.slice(0, 1).toUpperCase(),
    done: false,
    remaining: 1,
    completed: 6,
    total: 7,
    ...partial,
  };
}

const progress = [
  voter({ membershipId: "a", displayName: "Alex", done: true, remaining: 0, completed: 7 }),
  voter({ membershipId: "s", displayName: "Sam", done: false }),
];

describe("status strip copy", () => {
  it("uses the four kit phrases", () => {
    expect(statusStripCopy("your_turn")).toEqual({ title: "Clear swaps and dinner requests." });
    expect(statusStripCopy("waiting_on_others", ["Alex"])).toEqual({
      title: "Waiting on Alex",
    });
    expect(statusStripCopy("ready")).toEqual({ title: "Ready to lock." });
    expect(statusStripCopy("locked")).toEqual({
      title: "This week is locked.",
      secondary: "Recipes and the shopping list are open.",
    });
  });

  it("never says Still voting", () => {
    expect(waitingOnCopy(["Alex", "Sam"])).toBe("Waiting on Alex and Sam");
    expect(waitingOnCopy(["Madison", "Ian"])).toBe("Waiting on Madison and Ian");
    expect(waitingOnCopy(["Alex", "Sam", "Jordan"])).toBe("Waiting on 3 people");
    expect(waitingOnCopy([])).toBe("Waiting on others");
    expect(JSON.stringify(statusStripCopy("waiting_on_others", ["Alex"]))).not.toContain(
      "Still voting",
    );
  });
});

describe("status strip state", () => {
  it("prefers locked, then ready, then whose vote is left", () => {
    expect(
      weekStatusStripState({
        locked: true,
        ready: true,
        currentMembershipId: "a",
        progress,
      }),
    ).toBe("locked");
    expect(
      weekStatusStripState({
        locked: false,
        ready: true,
        currentMembershipId: "a",
        progress,
      }),
    ).toBe("ready");
    expect(
      weekStatusStripState({
        locked: false,
        ready: false,
        currentMembershipId: "s",
        progress,
      }),
    ).toBe("your_turn");
    expect(
      weekStatusStripState({
        locked: false,
        ready: false,
        currentMembershipId: "a",
        progress,
      }),
    ).toBe("waiting_on_others");
  });
});

describe("status strip mid-vote wiring", () => {
  it("maps voter progress to pending and done dots", () => {
    const people = statusStripPeople(progress);
    expect(people).toEqual([
      { id: "a", displayName: "Alex", done: true },
      { id: "s", displayName: "Sam", done: false },
    ]);
    expect(waitingOnNames(progress)).toEqual(["Sam"]);
    const blank = voter({
      membershipId: "m",
      displayName: "",
      email: "madison@example.com",
      done: false,
    });
    expect(waitingOnNames([blank])).toEqual(["madison"]);
    expect(statusStripPeople([blank])[0]?.displayName).toBe("madison");
    expect(weekStatusStripVisible(0)).toBe(false);
    expect(weekStatusStripVisible(7)).toBe(true);
  });

  it("exposes pending/done hooks on the Clear Sky strip", () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, "../components/status-strip.tsx"),
      "utf8",
    );
    expect(source).toContain("data-slot=\"status-strip\"");
    expect(source).toContain("data-slot=\"status-strip-dot\"");
    expect(source).toContain("data-state={state}");
    expect(source).toContain('data-done={person.done ? "true" : "false"}');
    expect(source).toContain("data-[state=your_turn]");
    expect(source).toContain("data-[state=waiting_on_others]");
    expect(source).toContain("data-[state=ready]");
    expect(source).toContain("data-[state=locked]");
    expect(source).toContain("aria-live=\"polite\"");
    expect(source).toContain('aria-label="Week progress"');
    expect(source).toContain("bg-approve text-approve-foreground");
    expect(source).toContain("bg-secondary text-muted-foreground");
    expect(source).toContain("is set");
    expect(source).toContain("still has an open swap or dinner request");
    expect(source).not.toContain("Your vote needed");
    expect(source).not.toContain("has voted");
    expect(source).not.toContain("has not finished voting");
  });

  it("keeps StatusStrip off This week — Ballot-2 killed the tracker", () => {
    const week = readFileSync(path.resolve(import.meta.dirname, "../app/week/page.tsx"), "utf8");
    expect(week).toContain("status={undefined}");
    expect(week).not.toContain("StatusStrip");
    expect(week).not.toContain("weekStatusStripState");
    expect(week).not.toContain("weekVoterProgress");
    expect(week).not.toContain("Your vote needed");
    expect(week).toContain("choice && !showPeopleGate ? (");
    expect(week).toContain("<LockInBar />");
    expect(week).toContain(
      "!choice && !viewingPast && !locked && check.ready && !showPeopleGate ? (",
    );
    expect(week).toContain("<LockBar />");
  });
});

describe("progress overflow", () => {
  it("shows four people then +N", () => {
    const people = ["Alex", "Sam", "Jordan", "Kai", "Nia"].map((displayName, index) => ({
      id: String(index),
      displayName,
    }));
    expect(visibleProgressPeople(people)).toEqual({
      visible: people.slice(0, 4),
      overflow: 1,
    });
    expect(visibleProgressPeople(people.slice(0, 3)).overflow).toBe(0);
  });
});
