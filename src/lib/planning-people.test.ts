import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanningPeopleGate } from "@/components/planning-people-gate";
import { patchPlanningPeople, planningPeopleGateOpen, hasDinnerNight, clampSpecialInstructions, PLANNING_PEOPLE_HELPER, PLANNING_PEOPLE_NEED_NIGHT, PLANNING_PEOPLE_TITLE, PLANNING_SWIPE_TOAST, SPECIAL_INSTRUCTIONS_HELPER, SPECIAL_INSTRUCTIONS_LABEL, SPECIAL_INSTRUCTIONS_MAX, SPECIAL_INSTRUCTIONS_PLACEHOLDER } from "./planning-people";
import type { Household, HouseholdSnapshot } from "./types";

const plates = [0, 2, 2, 4, 4, 0, 0];

function household(): Household {
  return {
    id: "house",
    name: "Our house",
    inviteCode: "code",
    weekStartsOn: 0,
    coupleNights: [1, 2],
    familySize: 4,
    coupleSize: 2,
    nightHeadcounts: plates,
    timezone: "America/Denver",
    setupStep: 8,
    weeklyBudgetCents: null,
    householdSize: 4,
    nightsPlanned: 4,
    postalCode: null,
    botCheckMode: "adaptive",
    botCheckIntervalHours: null,
  };
}

function planningSnapshot(): HouseholdSnapshot {
  const home = household();
  return {
    household: home,
    memberships: [],
    stores: [],
    week: {
      id: "cooking",
      householdId: home.id,
      startsOn: "2026-09-27",
      status: "voting",
      lockedAt: null,
      editableFrom: null,
      shoppingPrompt: "open",
      peopleConfirmedAt: "2026-09-01T00:00:00.000Z",
      nightHeadcounts: null,
      specialInstructions: null,
      ballotMode: "single",
      finalizedAt: null,
    },
    meals: [],
    options: [],
    picks: [],
    submissions: [],
    optionRequests: [],
    votes: [],
    recipes: [],
    shoppingList: null,
    ballotRequest: null,
    planning: {
      week: {
        id: "planning",
        householdId: home.id,
        startsOn: "2026-10-04",
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
      ballotRequest: null,
      options: [],
      picks: [],
      submissions: [],
      optionRequests: [],
    },
    mealHistory: [],
    savedMeals: [],
  };
}

describe("planning people gate", () => {
  it("opens only for an empty planning week whose plates are not saved", () => {
    expect(
      planningPeopleGateOpen({ role: "planning", peopleConfirmedAt: null, mealCount: 0 }),
    ).toBe(true);
    expect(
      planningPeopleGateOpen({
        role: "planning",
        peopleConfirmedAt: "2026-09-28T00:00:00.000Z",
        mealCount: 0,
      }),
    ).toBe(false);
    expect(
      planningPeopleGateOpen({ role: "planning", peopleConfirmedAt: null, mealCount: 2 }),
    ).toBe(false);
    expect(planningPeopleGateOpen({ role: "cooking", peopleConfirmedAt: null, mealCount: 0 })).toBe(
      false,
    );
  });

  it("requires one dinner night and keeps a short optional note", () => {
    expect(hasDinnerNight([0, 0, 0, 0, 0, 0, 0])).toBe(false);
    expect(hasDinnerNight([0, 0, 1, 0, 0, 0, 0])).toBe(true);
    expect(clampSpecialInstructions("  ")).toBeNull();
    expect(clampSpecialInstructions("Guests Thursday")).toBe("Guests Thursday");
    expect(clampSpecialInstructions("a".repeat(800))?.length).toBe(SPECIAL_INSTRUCTIONS_MAX);
    expect(PLANNING_PEOPLE_NEED_NIGHT).toBe("Set at least one dinner night (plates above zero).");
    expect(PLANNING_SWIPE_TOAST).toBe("Next week started. Set people per night.");
  });

  it("saves this week's plates without rewriting house defaults", () => {
    const before = planningSnapshot();
    const defaults = before.household.nightHeadcounts;
    const next = patchPlanningPeople(before, {
      nightHeadcounts: [1, 1, 1, 1, 1, 0, 0],
      specialInstructions: "  keep it simple  ",
    });
    expect(next.household.nightHeadcounts).toEqual(defaults);
    expect(next.household).toBe(before.household);
    expect(next.planning?.week.peopleConfirmedAt).toEqual(expect.any(String));
    expect(next.planning?.week.nightHeadcounts).toEqual([1, 1, 1, 1, 1, 0, 0]);
    expect(next.planning?.week.specialInstructions).toBe("keep it simple");
    expect(next.planning?.ballotRequest?.status).toBe("pending");
    expect(next.planning?.ballotRequest?.nightHeadcounts).toEqual([1, 1, 1, 1, 1, 0, 0]);
    expect(next.planning?.ballotRequest?.specialInstructions).toBe("keep it simple");
    expect(next.week.nightHeadcounts).toBeNull();
  });

  it("shows all seven days, kind labels, and optional instructions before any ballot", () => {
    const html = renderToStaticMarkup(
      createElement(PlanningPeopleGate, {
        household: household(),
        canEdit: true,
        onSave: async () => undefined,
        onBack: () => undefined,
      }),
    );
    expect(html).toContain('data-slot="planning-people-gate"');
    expect(html).toContain(PLANNING_PEOPLE_TITLE);
    expect(html).toContain(PLANNING_PEOPLE_HELPER);
    expect(html).toContain('data-slot="people-per-night"');
    expect(html).toContain("Sunday");
    expect(html).toContain("Saturday");
    expect(html).toContain("Off night");
    expect(html).toContain("Couple night");
    expect(html).toContain("Family night");
    expect(html.match(/data-slot="night-stepper"/g)).toHaveLength(7);
    expect(html).toContain(SPECIAL_INSTRUCTIONS_LABEL);
    expect(html).toContain(SPECIAL_INSTRUCTIONS_HELPER);
    expect(html).toContain(SPECIAL_INSTRUCTIONS_PLACEHOLDER);
    expect(html).toContain('data-slot="special-instructions"');
    expect(html).toContain('data-slot="planning-people-save"');
    expect(html).toContain(">Save<");
    expect(html).toContain('data-slot="planning-people-back"');
    expect(html).not.toContain("Create this week's meals");
    expect(html).not.toContain("Ask Bot");
    expect(html).not.toContain("Waiting for your Bot");
    expect(html.toLowerCase()).not.toContain("grandma");
  });
});

describe("planning people wiring", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const repoRoot = path.resolve(import.meta.dirname, "../..");

  it("shares the create path and keeps the gate off the house defaults editor", () => {
    const week = readFileSync(path.join(root, "app/week/page.tsx"), "utf8");
    const gate = readFileSync(path.join(root, "components/planning-people-gate.tsx"), "utf8");
    const settings = readFileSync(path.join(root, "app/settings/page.tsx"), "utf8");
    const provider = readFileSync(path.join(root, "components/supper-provider.tsx"), "utf8");
    const sql = readFileSync(
      path.join(repoRoot, "supabase/migrations/20260928233000_planning_people_gate.sql"),
      "utf8",
    );
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(week).toContain("futureSwipeCreatesPlanning");
    expect(week).toContain("planNextWeek");
    expect(week).toContain("PLANNING_SWIPE_TOAST");
    expect(week).toContain("PlanningPeopleGate");
    expect(week).toContain('scope?.week.status === "locked"');
    expect(gate).toContain("compactOffNights={false}");
    expect(gate).toContain("PeoplePerNight");
    expect(gate).not.toContain("updateHousehold");
    expect(settings).toContain("updateHousehold");
    expect(settings).toContain("<PeoplePerNight");
    expect(settings).toContain('scope?.week.status === "locked"');
    expect(settings).not.toContain("compactOffNights");
    expect(provider).toContain("savePlanningPeople");
    expect(provider).toContain("patchPlanningPeople");
    expect(provider).toContain("scopeForRole(visible, viewedRoleRef.current)");

    const saveAt = sql.indexOf("function public.save_planning_people");
    const saveBody = sql.slice(saveAt, sql.indexOf("comment on function public.plan_next_week"));
    expect(saveBody).toContain("Set at least one dinner night (plates above zero).");
    expect(saveBody).toContain("people_confirmed_at");
    expect(saveBody).toContain("special_instructions");
    expect(saveBody).not.toContain("update public.households");

    const planAt = sql.indexOf("function public.plan_next_week");
    const planBody = sql.slice(planAt, sql.indexOf("function public.request_saved_for_planning"));
    expect(planBody).toContain("ensure_planning_week");
    expect(planBody).not.toContain("request_week_ballot");

    expect(sql).toContain("confirmed is not null");
    expect(sql).toContain("special_instructions");
    expect(readme).toContain("20260928233000_planning_people_gate.sql");
    expect(sql.toLowerCase()).not.toContain("grandma");
  });
});
