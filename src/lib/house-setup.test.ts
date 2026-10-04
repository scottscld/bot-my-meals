import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WeeklyBudgetField } from "@/components/weekly-budget-field";
import {
  CREATE_MEALS_CTA,
  DIY_GROK_PASTE_CTA,
  FINISH_SETUP_CTA,
  HOUSE_SETUP_DONE_STEP,
  HOUSE_SETUP_STEPS,
  WAITING_FOR_BOT,
  ALL_NIGHTS_ON,
  applyHouseholdSizeToHeadcounts,
  applyNightOnsToHeadcounts,
  clampHouseSetupStep,
  formatWeeklyBudgetDollars,
  grokBotPastePrompt,
  headcountsFromNightOns,
  headcountsFromPlan,
  houseSetupProgressLabel,
  houseSetupStepMeta,
  isHouseSetupComplete,
  nextHouseSetupStep,
  nightsOnFromHeadcounts,
  nightsPlannedFromHeadcounts,
  nightsPlannedFromOns,
  nightsPlannedLabel,
  parseWeeklyBudgetDollars,
  previousHouseSetupStep,
  shouldShowHouseSetup,
  weeklyBudgetCurrencyPrefix,
} from "./house-setup";

const srcRoot = path.resolve(import.meta.dirname, "..");

describe("wizard v2 house setup", () => {
  it("locks the UX order: invite, size, nights, plates, stores, budget, create meals", () => {
    expect(HOUSE_SETUP_STEPS.map((step) => step.id)).toEqual([
      "invite",
      "size",
      "nights",
      "plates",
      "stores",
      "budget",
      "create-meals",
    ]);
    expect(HOUSE_SETUP_STEPS[0].title).toBe("Invite people");
    expect(HOUSE_SETUP_STEPS[1].title).toBe("How many people?");
    expect(HOUSE_SETUP_STEPS[1].helper).toBe("Plates for everyone at the table. You can change this later.");
    expect(HOUSE_SETUP_STEPS[1].helper).not.toMatch(/Alex|Jordan/);
    expect(HOUSE_SETUP_STEPS[1].cta).toBe("Next");
    expect(HOUSE_SETUP_STEPS[2].title).toBe("Which nights get a meal?");
    expect(HOUSE_SETUP_STEPS[2].helper).toMatch(/turn nights off/i);
    expect(HOUSE_SETUP_STEPS[3].title).toBe("Plates per night");
    expect(HOUSE_SETUP_STEPS[3].helper).toBe(
      "Defaults match your household. Change a night for guests.",
    );
    expect(HOUSE_SETUP_STEPS[3].cta).toBe("Continue");
    expect(HOUSE_SETUP_STEPS[6].cta).toBe(CREATE_MEALS_CTA);
    expect(CREATE_MEALS_CTA).toBe("Create this week's meals");
    expect(WAITING_FOR_BOT).toBe("Waiting for your Bot…");
    expect(DIY_GROK_PASTE_CTA).toBe("Copy paste for your Grok Bot");
    expect(FINISH_SETUP_CTA).toBe("Finish setup");
    expect(HOUSE_SETUP_STEPS[6].helper).toMatch(/no sample week/i);
    expect(HOUSE_SETUP_STEPS[4].helper).toMatch(/zip or postal/i);
    expect(HOUSE_SETUP_STEPS[4].helper).not.toMatch(/Trader Joe's and Smith's are already here/);
    expect(HOUSE_SETUP_STEPS[5].helper).toMatch(/never invent grocery prices/i);
    expect(houseSetupProgressLabel(3)).toBe("Setup · step 3 of 7");
    expect(nightsPlannedLabel(5)).toBe("5 of 7");
    expect(nightsPlannedLabel(7)).toBe("7 of 7");
  });

  it("persists progress as a 1-8 step and only shows the wizard to Admins", () => {
    expect(clampHouseSetupStep(1)).toBe(1);
    expect(clampHouseSetupStep(8)).toBe(HOUSE_SETUP_DONE_STEP);
    expect(clampHouseSetupStep("nope")).toBe(HOUSE_SETUP_DONE_STEP);
    expect(nextHouseSetupStep(1)).toBe(2);
    expect(nextHouseSetupStep(7)).toBe(8);
    expect(previousHouseSetupStep(1)).toBe(1);
    expect(isHouseSetupComplete(8)).toBe(true);
    expect(isHouseSetupComplete(3)).toBe(false);
    expect(shouldShowHouseSetup("owner", 1)).toBe(true);
    expect(shouldShowHouseSetup("owner", 8)).toBe(false);
    expect(shouldShowHouseSetup("voter", 1)).toBe(false);
    expect(houseSetupStepMeta(5).id).toBe("stores");
  });

  it("defaults active nights to household size and off nights to 0 plates", () => {
    expect(headcountsFromPlan(4, 5)).toEqual([4, 4, 4, 4, 4, 0, 0]);
    expect(headcountsFromPlan(2, 7)).toEqual([2, 2, 2, 2, 2, 2, 2]);
    expect(headcountsFromNightOns(3, ALL_NIGHTS_ON)).toEqual([3, 3, 3, 3, 3, 3, 3]);
    expect(nightsOnFromHeadcounts([3, 3, 0, 3, 3, 3, 3])).toEqual([
      true,
      true,
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(nightsPlannedFromOns(ALL_NIGHTS_ON)).toBe(7);
    expect(applyNightOnsToHeadcounts([4, 4, 4, 4, 4, 0, 0], 3, ALL_NIGHTS_ON)).toEqual([
      4, 4, 4, 4, 4, 3, 3,
    ]);
    expect(nightsPlannedFromHeadcounts([4, 4, 4, 4, 4, 0, 0])).toBe(5);
    expect(applyHouseholdSizeToHeadcounts([4, 4, 4, 4, 4, 0, 0], 3)).toEqual([3, 3, 3, 3, 3, 0, 0]);
  });

  it("parses a weekly target in dollars and never invents a price", () => {
    expect(parseWeeklyBudgetDollars("")).toBeNull();
    expect(parseWeeklyBudgetDollars("  ")).toBeNull();
    expect(parseWeeklyBudgetDollars("150")).toBe(15000);
    expect(parseWeeklyBudgetDollars("$80.50")).toBe(8050);
    expect(() => parseWeeklyBudgetDollars("-4")).toThrow(/dollars/i);
    expect(formatWeeklyBudgetDollars(15000)).toBe("150");
    expect(formatWeeklyBudgetDollars(8050)).toBe("80.50");
    expect(formatWeeklyBudgetDollars(null)).toBe("");
  });

  it("binds $ to a US ZIP and to the default path so the amount is never unitless", () => {
    for (const postalCode of [
      "84121",
      "84121-1234",
      "841211234",
      "M5V 2T6",
      "SW1A 1AA",
      "SW1A1AA",
      "",
      "  ",
      null,
      undefined,
      "??",
      "8412",
    ]) {
      expect(weeklyBudgetCurrencyPrefix(postalCode)).toBe("$");
    }
  });

  it("builds a Grok paste from this house's plates, stores, and budget", () => {
    const prompt = grokBotPastePrompt({
      householdName: "Our house",
      nightHeadcounts: [4, 4, 4, 4, 4, 0, 0],
      storeNames: ["Harmons", "WinCo"],
      weeklyBudgetCents: 15000,
    });
    expect(prompt).toContain("multi-approve ballot");
    expect(prompt).toContain("submit_week_options");
    expect(prompt).not.toContain("dual-approve");
    expect(prompt).toMatch(/plates per night/i);
    expect(prompt).toMatch(/Sun 4/);
    expect(prompt).toMatch(/Harmons/);
    expect(prompt).toMatch(/WinCo/);
    expect(prompt).toMatch(/required before Create this week's meals/);
    expect(prompt).toMatch(/There is no Skip/);
    expect(prompt).not.toMatch(/Adaptive|@every|Optional/i);
    expect(prompt).toMatch(/Never invent grocery prices/);
    expect(prompt).toMatch(/Never claim Smith's cart adds/);
    expect(prompt).not.toMatch(/sample week/i);
  });
});

describe("house setup surfaces", () => {
  it("flattens setup plates to On-night steppers and kills Adjust chrome", () => {
    const plates = readFileSync(path.join(srcRoot, "components/people-per-night.tsx"), "utf8");
    const wizard = readFileSync(path.join(srcRoot, "components/setup-wizard.tsx"), "utf8");
    const settings = readFileSync(path.join(srcRoot, "app/settings/page.tsx"), "utf8");
    const managePeople = readFileSync(path.join(srcRoot, "components/manage-people.tsx"), "utf8");

    expect(wizard).toContain('title="Plates per night"');
    expect(wizard).toContain("helper={meta.helper}");
    expect(wizard).toContain("compactOffNights");
    expect(wizard).toMatch(/case "plates"[\s\S]*?Continue/);
    expect(plates).toContain('data-slot="people-per-night"');
    expect(plates).toContain('"night-stepper"');
    expect(plates).toContain("size-12");
    expect(plates).toContain("min-h-12");
    expect(plates).toContain("compactOffNights");
    expect(plates).toMatch(/count > 0/);
    expect(plates).not.toContain("plates-adjust");
    expect(plates).not.toContain("<details");
    expect(plates).not.toContain("<summary");
    expect(plates).not.toMatch(/\bAdjust\b/);
    expect(plates).not.toContain("Adjust weekly");
    expect(settings).toContain("PeoplePerNight");
    expect(settings).not.toContain("compactOffNights");
    expect(settings).not.toContain("plates-adjust");
    expect(settings).not.toMatch(/\bAdjust weekly\b/);
    expect(managePeople).not.toContain("plates-adjust");
    expect(managePeople).not.toMatch(/\bAdjust weekly\b/);
  });

  it("gates This week on unfinished Admin setup and keeps progress in the household row", () => {
    const week = readFileSync(path.join(srcRoot, "app/week/page.tsx"), "utf8");
    const wizard = readFileSync(path.join(srcRoot, "components/setup-wizard.tsx"), "utf8");
    const provider = readFileSync(path.join(srcRoot, "components/supper-provider.tsx"), "utf8");
    const repo = readFileSync(path.join(srcRoot, "lib/supabase/repo.ts"), "utf8");
    const types = readFileSync(path.join(srcRoot, "lib/types.ts"), "utf8");
    const migration = readFileSync(
      path.join(srcRoot, "../supabase/migrations/20260917160000_wizard_v2_ballot_request.sql"),
      "utf8",
    );

    expect(week).toContain("shouldShowHouseSetup");
    expect(week).toContain("SetupWizard");
    expect(wizard).toContain("InviteShare");
    expect(wizard).toContain("PeoplePerNight");
    expect(wizard).toContain("HouseStores");
    expect(wizard).not.toContain("<form");
    expect(wizard).toContain("weekly-budget");
    expect(wizard).toContain("WeeklyBudgetField");
    expect(wizard).toContain('budget.trim() ? "Continue" : "Skip"');
    expect(wizard).toContain("CREATE_MEALS_CTA");
    expect(wizard).toContain('placement="setup"');
    expect(wizard).toContain("disabled={busy || !createReady}");
    expect(wizard).toContain("FINISH_WAKE_BEFORE_CREATE");
    expect(wizard).toContain("DIY_GROK_PASTE_CTA");
    expect(wizard).toContain("household-size");
    expect(wizard).toContain("NightToggles");
    expect(wizard).toContain("hideNav");
    expect(wizard).not.toContain("nights-planned");
    expect(wizard).not.toContain("[1, 2, 3, 4, 5, 6, 7]");
    expect(wizard).toContain("diy-grok-paste");
    expect(wizard).toContain("compactOffNights");
    expect(wizard).toContain("setupStep");
    expect(wizard).not.toContain("SAMPLE_WEEK");
    expect(wizard).not.toContain("loadSampleWeek");
    expect(wizard).not.toContain("seedDemoWeek");
    expect(wizard).not.toContain("Load sample dinners");
    expect(wizard).not.toContain("Checkbox");
    expect(wizard).not.toContain("setup-sample");
    expect(wizard).not.toContain("ASK_BOT_SEVEN_DINNERS_CTA");
    expect(wizard).not.toContain("HOUSE_SIZE_LATER_HELPER");
    expect(wizard).not.toMatch(/\bAlex\b/);
    expect(wizard).not.toMatch(/\bJordan\b/);
    expect(readFileSync(path.join(srcRoot, "lib/house-setup.ts"), "utf8")).not.toMatch(/\bAlex\b|\bJordan\b/);
    expect(readFileSync(path.join(srcRoot, "lib/setup.ts"), "utf8")).not.toMatch(/\bAlex\b|\bJordan\b/);
    expect(readFileSync(path.join(srcRoot, "components/onboarding.tsx"), "utf8")).not.toMatch(
      /\bAlex\b|\bJordan\b/,
    );
    expect(week).toContain("emptyWeekPresentation");
    expect(week).toContain("/week?setup=1");
    expect(week).toContain("requestWeekBallot");
    expect(week).toContain("waiting-for-bot");
    expect(provider).toContain("requestWeekBallot");
    expect(provider).toContain("fetchBotWakeConfigured");
    expect(provider).toContain("FINISH_WAKE_BEFORE_CREATE");
    expect(provider).toContain("attachHouseholdLive");
    const live = readFileSync(path.join(srcRoot, "lib/household-live.ts"), "utf8");
    expect(live).toContain('"ballot_requests"');
    expect(provider).not.toContain("localStorage");
    expect(types).toContain("setupStep");
    expect(types).toContain("weeklyBudgetCents");
    expect(types).toContain("householdSize");
    expect(types).toContain("nightsPlanned");
    expect(types).toContain("postalCode");
    expect(types).toContain("BallotRequest");
    expect(repo).toContain("setup_step");
    expect(repo).toContain("weekly_budget_cents");
    expect(repo).toContain("household_size");
    expect(repo).toContain("nights_planned");
    expect(repo).toContain("postal_code");
    expect(repo).toContain("ballot_requests");
    expect(repo).toContain("request_week_ballot");
    expect(repo).toContain("household_join_tokens");
    expect(migration).toContain("create table if not exists public.ballot_requests");
    expect(migration).toContain("request_week_ballot");
    expect(migration).not.toContain("Trader Joe");
    expect(migration).not.toContain("trader-joes");
    expect(migration).toContain("insert into public.households (");
    expect(migration).toContain("values (");
    expect(migration).toContain("1,");
    expect(migration).not.toContain("seed_demo_week");
  });
});

function expectDollarBoundToAmount(html: string, id: string, value: string) {
  const fieldStart = html.indexOf('data-slot="weekly-budget-field"');
  expect(fieldStart).toBeGreaterThanOrEqual(0);
  const field = html.slice(fieldStart);
  const prefixAt = field.indexOf('data-slot="weekly-budget-prefix"');
  const dollarAt = field.indexOf(">$</span>");
  const inputAt = field.indexOf(`id="${id}"`);
  expect(prefixAt).toBeGreaterThanOrEqual(0);
  expect(dollarAt).toBeGreaterThan(prefixAt);
  expect(inputAt).toBeGreaterThan(dollarAt);
  expect(field).toContain(`value="${value}"`);
  expect(field).toContain("pl-7");
  expect(field).not.toContain("<select");
  expect(field).not.toMatch(/USD|EUR|GBP|currency picker/i);
}

describe("US weekly budget prefix", () => {
  it("renders a leading $ inside the same control as the digits for a US ZIP", () => {
    const html = renderToStaticMarkup(
      createElement(WeeklyBudgetField, {
        id: "weekly-budget",
        value: "150",
        postalCode: "84121",
        describedBy: "weekly-budget-hint",
        onChange: () => undefined,
      }),
    );

    expectDollarBoundToAmount(html, "weekly-budget", "150");
    expect(html).toContain('aria-describedby="weekly-budget-hint weekly-budget-currency"');
    expect(html).toContain("US dollars");
    expect(html).not.toContain("placeholder=");
  });

  it("still shows $ when zip is missing or not a US ZIP, with no currency picker", () => {
    for (const postalCode of ["M5V 2T6", "SW1A 1AA", "", null, "??"]) {
      const html = renderToStaticMarkup(
        createElement(WeeklyBudgetField, {
          id: "weekly-budget",
          value: "150",
          postalCode,
          onChange: () => undefined,
        }),
      );
      expectDollarBoundToAmount(html, "weekly-budget", "150");
    }
  });

  it("locks setup step 6 and House settings to the prefixed field", () => {
    const wizard = readFileSync(path.join(srcRoot, "components/setup-wizard.tsx"), "utf8");
    const settings = readFileSync(path.join(srcRoot, "app/settings/page.tsx"), "utf8");
    const field = readFileSync(path.join(srcRoot, "components/weekly-budget-field.tsx"), "utf8");
    const budgetBodies = [...wizard.matchAll(/case "budget":([\s\S]*?)break;/g)].map((match) => match[1]);
    const fieldBody = budgetBodies.find((body) => body.includes("Weekly meal budget"));
    const footerBody = budgetBodies.find((body) => body.includes("Skip"));

    expect(fieldBody).toBeTruthy();
    expect(fieldBody).toContain("<WeeklyBudgetField");
    expect(fieldBody).toContain('id="weekly-budget"');
    expect(fieldBody).toContain("postalCode={household.postalCode}");
    expect(fieldBody).toContain("{meta.helper}");
    expect(fieldBody).toContain('htmlFor="weekly-budget"');
    expect(fieldBody).toContain(">Weekly meal budget</Label>");
    expect(fieldBody).not.toContain("<Input");
    expect(fieldBody).not.toMatch(/\bUSD\b|\bEUR\b|\bGBP\b/);
    expect(footerBody).toContain('budget.trim() ? "Continue" : "Skip"');
    expect(wizard).not.toContain("currency picker");
    expect(wizard).not.toContain("<select");

    expect(settings).toContain("<WeeklyBudgetField");
    expect(settings).toContain('id="house-weekly-budget"');
    expect(settings).toContain('htmlFor="house-weekly-budget"');
    expect(settings).toContain("postalCode={snapshot.household.postalCode}");
    expect(settings).toContain("We never invent grocery prices.");
    expect(settings).toContain("weeklyBudgetCurrencyPrefix");
    expect(settings).not.toContain("<Input");
    expect(settings).not.toContain("<select");

    expect(field).toContain("weeklyBudgetCurrencyPrefix");
    expect(field).toContain('data-slot="weekly-budget-prefix"');
    expect(field).toContain("{prefix}");
    expect(field).not.toContain("<select");
    expect(HOUSE_SETUP_STEPS[5].id).toBe("budget");
    expect(HOUSE_SETUP_STEPS[5].title).toBe("Weekly meal budget");
    expect(HOUSE_SETUP_STEPS[5].helper).toBe(
      "A target for dinners this week. We never invent grocery prices.",
    );
  });
});
