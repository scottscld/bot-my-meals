import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WeekTitleRow } from "@/components/app-shell";
import { EditNightsControl } from "@/components/edit-nights-control";
import { botCheckForSnapshot } from "./bot-check";
import {
  EDIT_NIGHTS_ADDED_TOAST,
  EDIT_NIGHTS_LABEL,
  HOUSE_PEOPLE_DEFAULTS_NOTE,
  dinnersTurningOff,
  frozenWeekdays,
  planWeekNightChanges,
  prefillWeekHeadcounts,
  savedNewNightsToast,
  showEditNightsEntry,
  showWeekSpecialInstructions,
  turnOffDinnerConfirm,
  withFrozenNights,
} from "./edit-nights";
import type { Household, Vote } from "./types";

const housePlates = [4, 4, 4, 4, 4, 2, 2];
const weekPlates = [2, 2, 0, 4, 4, 0, 0];

function household(): Household {
  return {
    id: "house",
    name: "Our house",
    inviteCode: "code",
    weekStartsOn: 0,
    coupleNights: [5, 6],
    familySize: 4,
    coupleSize: 2,
    nightHeadcounts: housePlates,
    timezone: "America/Denver",
    setupStep: 8,
    weeklyBudgetCents: null,
    householdSize: 4,
    nightsPlanned: 7,
    postalCode: null,
    botCheckMode: "adaptive",
    botCheckIntervalHours: null,
    hebCheckoutMode: "review",
    deliveryDays: null,
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    orderMaxCents: null,
    listApproverRole: "owner",
  };
}

describe("edit nights", () => {
  it("shows Edit nights on the viewed week and hides it when locked, past, or the gate is the body", () => {
    expect(EDIT_NIGHTS_LABEL).toBe("Edit nights");
    expect(
      showEditNightsEntry({ past: false, locked: false, canEdit: true, peopleGate: false }),
    ).toBe(true);
    expect(
      showEditNightsEntry({ past: false, locked: true, canEdit: true, peopleGate: false }),
    ).toBe(false);
    expect(
      showEditNightsEntry({ past: true, locked: false, canEdit: true, peopleGate: false }),
    ).toBe(false);
    expect(
      showEditNightsEntry({ past: false, locked: false, canEdit: false, peopleGate: false }),
    ).toBe(false);
    expect(
      showEditNightsEntry({ past: false, locked: false, canEdit: true, peopleGate: true }),
    ).toBe(false);
  });

  it("prefills the viewed week's plates, then meals, then house defaults", () => {
    expect(
      prefillWeekHeadcounts({
        saved: weekPlates,
        household: housePlates,
        meals: [{ nightDate: "2026-09-27", servings: 9 }],
      }),
    ).toEqual(weekPlates);
    expect(
      prefillWeekHeadcounts({
        saved: null,
        household: housePlates,
        meals: [
          { nightDate: "2026-09-27", servings: 3 },
          { nightDate: "2026-09-28", servings: 1 },
        ],
      }),
    ).toEqual([3, 1, 0, 0, 0, 0, 0]);
    expect(
      prefillWeekHeadcounts({ saved: null, household: housePlates, meals: [] }),
    ).toEqual(housePlates);
  });

  it("keeps special instructions on planning and off cooking unless a note is already stored", () => {
    expect(showWeekSpecialInstructions({ role: "planning", stored: null })).toBe(true);
    expect(showWeekSpecialInstructions({ role: "cooking", stored: null })).toBe(false);
    expect(showWeekSpecialInstructions({ role: "cooking", stored: "  " })).toBe(false);
    expect(showWeekSpecialInstructions({ role: "cooking", stored: "No leftovers" })).toBe(true);
  });

  it("plans empty slots, removals, and serving changes only after meals exist", () => {
    const previous = [2, 0, 4, 0, 0, 0, 0];
    const next = [3, 2, 0, 0, 0, 0, 0];
    expect(planWeekNightChanges({ previous, next, hasMeals: false })).toEqual([]);
    expect(planWeekNightChanges({ previous, next, hasMeals: true })).toEqual([
      { weekday: 0, action: "servings", servings: 3 },
      { weekday: 1, action: "open-slot", servings: 2 },
      { weekday: 2, action: "remove" },
    ]);
    expect(savedNewNightsToast(planWeekNightChanges({ previous, next, hasMeals: true }), true)).toBe(
      EDIT_NIGHTS_ADDED_TOAST,
    );
    expect(savedNewNightsToast([], false)).toBeNull();
  });

  it("asks before turning off a night that still has a dinner", () => {
    const meals = [
      { id: "sun", title: "Roast chicken", nightDate: "2026-09-27" },
      { id: "mon", title: "", nightDate: "2026-09-28" },
    ];
    const removed: Vote[] = [
      {
        id: "v",
        householdId: "house",
        mealId: "mon",
        membershipId: "member",
        choice: "remove",
        note: "",
        updatedAt: "2026-09-28T00:00:00.000Z",
      },
    ];
    expect(
      dinnersTurningOff({
        previous: [2, 2, 0, 0, 0, 0, 0],
        next: [0, 0, 0, 0, 1, 0, 0],
        meals,
        votes: removed,
      }),
    ).toEqual(["Sunday"]);
    expect(turnOffDinnerConfirm("Sunday")).toBe(
      "Turn off Sunday? Removes that dinner from this week.",
    );
  });

  it("leaves past nights fixed after a mid-week unlock", () => {
    const frozen = frozenWeekdays({
      startsOn: "2026-09-27",
      status: "voting",
      editableFrom: "2026-09-29",
    });
    expect(frozen).toEqual([0, 1]);
    expect(withFrozenNights([4, 4, 2, 0, 0, 0, 0], [0, 0, 9, 0, 0, 0, 0], frozen)).toEqual([
      4, 4, 9, 0, 0, 0, 0,
    ]);
    expect(
      frozenWeekdays({ startsOn: "2026-09-27", status: "voting", editableFrom: null }),
    ).toEqual([]);
  });

  it("puts Edit nights on the week title row and points House defaults at that control", () => {
    const html = renderToStaticMarkup(
      createElement(WeekTitleRow, {
        title: "Next week",
        titleAside: createElement("span", { "data-slot": "week-locked-chip" }, "Locked"),
        titleAction: createElement(EditNightsControl, { onEdit: () => undefined }),
      }),
    );
    expect(html).toContain('data-slot="week-title-row"');
    expect(html).toContain("justify-between");
    expect(html).toContain('data-slot="edit-nights"');
    expect(html).toContain(EDIT_NIGHTS_LABEL);
    expect(html).toContain("min-h-11");
    expect(html).toContain("min-w-11");
    expect(html.indexOf("Next week")).toBeLessThan(html.indexOf("Locked"));
    expect(html.indexOf("Locked")).toBeLessThan(html.indexOf(EDIT_NIGHTS_LABEL));
    expect(HOUSE_PEOPLE_DEFAULTS_NOTE).toBe(
      "Used when you start a new week. To change nights on This week or Next week, open that week and tap Edit nights.",
    );

    const root = path.resolve(import.meta.dirname, "..");
    const week = readFileSync(path.join(root, "app/week/page.tsx"), "utf8");
    const chrome = readFileSync(path.join(root, "components/week-chrome.tsx"), "utf8");
    expect(week).toContain("titleAction=");
    expect(week).toContain("<EditNightsControl");
    expect(week).toContain("showEditNightsEntry");
    expect(chrome).not.toContain('data-slot="edit-nights"');
    expect(chrome).not.toContain("EDIT_NIGHTS_LABEL");
  });

  it("checks portions against the week's plates after they are saved", () => {
    const home = household();
    const dinner = {
      id: "m1",
      title: "Chili",
      servings: 2,
      nightDate: "2026-09-28",
    };
    const base = {
      household: home,
      meals: [dinner],
      votes: [],
      memberships: [],
      week: { status: "voting" as const, nightHeadcounts: [2, 2, 2, 2, 2, 0, 0] },
    };
    expect(botCheckForSnapshot(base).reason).toBe("idle");
    expect(
      botCheckForSnapshot({
        ...base,
        meals: [{ ...dinner, title: "" }],
      }).reason,
    ).toBe("meal_pending");
    expect(
      botCheckForSnapshot({
        ...base,
        meals: [{ ...dinner, servings: 4 }],
      }).reason,
    ).toBe("portion_pending");
    expect(
      botCheckForSnapshot({
        ...base,
        week: { status: "voting", nightHeadcounts: null },
        meals: [{ ...dinner, servings: 4 }],
      }).reason,
    ).toBe("idle");
  });
});

describe("edit nights wiring", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const repoRoot = path.resolve(import.meta.dirname, "../..");

  it("saves the viewed week without rewriting house defaults", () => {
    const week = readFileSync(path.join(root, "app/week/page.tsx"), "utf8");
    const gate = readFileSync(path.join(root, "components/planning-people-gate.tsx"), "utf8");
    const sheet = readFileSync(path.join(root, "components/edit-nights-sheet.tsx"), "utf8");
    const settings = readFileSync(path.join(root, "app/settings/page.tsx"), "utf8");
    const provider = readFileSync(path.join(root, "components/supper-provider.tsx"), "utf8");
    const repo = readFileSync(path.join(root, "lib/supabase/repo.ts"), "utf8");
    const sql = readFileSync(
      path.join(repoRoot, "supabase/migrations/20260929001000_week_scoped_edit_nights.sql"),
      "utf8",
    );

    expect(week).toContain("EditNightsSheet");
    expect(week).toContain("showEditNightsEntry");
    expect(week).toContain("saveWeekPeople");
    expect(week).toContain("PlanningPeopleGate");
    expect(gate).toContain("compactOffNights={false}");
    expect(gate).toContain("PeoplePerNight");
    expect(sheet).toContain("showWeekSpecialInstructions");
    expect(sheet).toContain("turnOffDinnerConfirm");
    expect(sheet).not.toContain("updateHousehold");
    expect(settings).toContain("HOUSE_PEOPLE_DEFAULTS_NOTE");
    expect(settings).not.toContain("compactOffNights");
    expect(provider).toContain("saveWeekPeople");
    expect(provider).not.toContain("patchWeekPeople");
    expect(repo).toContain('rpc("save_week_people"');
    expect(sql).toContain("function public.save_week_people");
    expect(sql).toContain("function public.save_planning_people");
    expect(sql).toContain("Unlock this week before changing nights.");
    expect(sql).toContain("Set at least one dinner night (plates above zero).");
    expect(sql).toContain("Only this week and next week can change nights.");
    expect(sql).toContain("btrim(coalesce(new.title, '')) = ''");
    expect(sql).not.toContain("update public.households");
    expect(sql.toLowerCase()).not.toContain("grandma");
  });
});
