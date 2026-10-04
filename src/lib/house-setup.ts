import { WEEKDAY_SHORT } from "./dates";
import { classifyPostalCode, type PostalKind } from "./grocers";
import { clampHeadcount, clampNightHeadcount, normalizeNightHeadcounts } from "./headcount";
import { isAdmin } from "./users";
import type { Role } from "./types";

export const CREATE_MEALS_CTA = "Create this week's meals";
export const WAITING_FOR_BOT = "Waiting for your Bot…";
export const DIY_GROK_PASTE_CTA = "Copy paste for your Grok Bot";
export const FINISH_SETUP_CTA = "Finish setup";

export const HOUSE_SETUP_DONE_STEP = 8;
export const HOUSE_SETUP_FIRST_STEP = 1;
export const HOUSE_SETUP_LAST_STEP = 7;

export const HOUSE_SETUP_STEP_IDS = [
  "invite",
  "size",
  "nights",
  "plates",
  "stores",
  "budget",
  "create-meals",
] as const;
export type HouseSetupStepId = (typeof HOUSE_SETUP_STEP_IDS)[number];

export const HOUSE_SETUP_STEPS = [
  {
    id: "invite" as const,
    step: 1,
    title: "Invite people",
    helper: "Text this link. They open it on their phone, sign in, and join this house.",
    cta: "Continue",
  },
  {
    id: "size" as const,
    step: 2,
    title: "How many people?",
    helper: "Plates for everyone at the table. You can change this later.",
    cta: "Next",
  },
  {
    id: "nights" as const,
    step: 3,
    title: "Which nights get a meal?",
    helper: "You can turn nights off or change them later.",
    cta: "Continue",
  },
  {
    id: "plates" as const,
    step: 4,
    title: "Plates per night",
    helper: "Defaults match your household. Change a night for guests.",
    cta: "Continue",
  },
  {
    id: "stores" as const,
    step: 5,
    title: "Stores",
    helper:
      "Enter a zip or postal code to see grocers for your region. Add any store. Labels only — we never invent grocery prices.",
    cta: "Continue",
  },
  {
    id: "budget" as const,
    step: 6,
    title: "Weekly meal budget",
    helper: "A target for dinners this week. We never invent grocery prices.",
    cta: "Continue",
  },
  {
    id: "create-meals" as const,
    step: 7,
    title: "Create meals",
    helper:
      "Create this week's meals. Your Bot gets this house's plates, nights, stores, and budget. There is no sample week.",
    cta: CREATE_MEALS_CTA,
  },
] as const;

export const ALL_NIGHTS_ON = [true, true, true, true, true, true, true] as const;

export function nightsPlannedLabel(nights: number): string {
  return `${clampNightsPlanned(nights)} of 7`;
}

export function nightsOnFromHeadcounts(counts: number[]): boolean[] {
  const ons = normalizeNightHeadcounts(counts).map((count) => count > 0);
  return ons.some(Boolean) ? ons : [...ALL_NIGHTS_ON];
}

export function headcountsFromNightOns(householdSize: number, nightsOn: readonly boolean[]): number[] {
  const size = clampHeadcount(householdSize);
  const ons = nightsOn.length === 7 ? nightsOn : ALL_NIGHTS_ON;
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => (ons[weekday] ? size : 0));
}

export function applyNightOnsToHeadcounts(
  existing: number[] | null | undefined,
  householdSize: number,
  nightsOn: readonly boolean[],
): number[] {
  const size = clampHeadcount(householdSize);
  const ons = nightsOn.length === 7 ? nightsOn : ALL_NIGHTS_ON;
  const current = Array.isArray(existing) && existing.length === 7 ? existing.map(clampNightHeadcount) : null;
  return ons.map((on, index) => {
    if (!on) return 0;
    const prior = current?.[index] ?? 0;
    return prior > 0 ? prior : size;
  });
}

export function nightsPlannedFromOns(nightsOn: readonly boolean[]): number {
  return clampNightsPlanned(nightsOn.filter(Boolean).length);
}

export function clampNightsPlanned(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(7, Math.max(1, Math.round(n)));
}

export function headcountsFromPlan(householdSize: number, nightsPlanned: number): number[] {
  const size = clampHeadcount(householdSize);
  const nights = clampNightsPlanned(nightsPlanned);
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => (weekday < nights ? size : 0));
}

export function nightsPlannedFromHeadcounts(counts: number[]): number {
  const active = normalizeNightHeadcounts(counts).filter((count) => count > 0).length;
  return clampNightsPlanned(active || 7);
}

export function applyHouseholdSizeToHeadcounts(counts: number[], householdSize: number): number[] {
  const size = clampHeadcount(householdSize);
  return normalizeNightHeadcounts(counts).map((count) => (count > 0 ? size : 0));
}

export function houseSetupProgressLabel(step: number): string {
  const current = Math.min(HOUSE_SETUP_LAST_STEP, clampHouseSetupStep(step));
  return `Setup · step ${current} of ${HOUSE_SETUP_LAST_STEP}`;
}

export function grokBotPastePrompt(input: {
  householdName: string;
  nightHeadcounts: number[];
  storeNames: string[];
  weeklyBudgetCents: number | null;
}): string {
  const plates = normalizeNightHeadcounts(input.nightHeadcounts)
    .map((count, weekday) => `${WEEKDAY_SHORT[weekday]} ${count}`)
    .join(", ");
  const stores = input.storeNames.length ? input.storeNames.join(", ") : "the house stores";
  const budget =
    input.weeklyBudgetCents == null
      ? "no weekly dollar target"
      : `weekly meal budget about $${formatWeeklyBudgetDollars(input.weeklyBudgetCents)} (a target, not grocery prices)`;
  return [
    `Propose a multi-approve ballot for our Bot My Meals house (${input.householdName || "our house"}).`,
    `Use these plates per night: ${plates}.`,
    `Shop at: ${stores}.`,
    `Budget: ${budget}.`,
    "Wake your Bot is required before Create this week's meals. Paste the Webhook URL in House → Wake your Bot. There is no Skip. Week and plan changes wake the bot. Write ballot, recipes, and the shopping list back to the site, and stay quiet if nothing changed.",
    "On each wake, read GET /api/bot/status. Do the work when needs_work is true on any open week, and stay silent when nothing changed.",
    "fill_pending means this locked week still needs recipes or a shopping list. Write those, and skip a list when nothing needs buying.",
    "Keep a webhook routine named Wake on app event. On wake, sync this household (ballot, recipes, shopping list, setup) from the app, and stay quiet if nothing changed.",
    "For a next-week ballot, use that week's night_headcounts and special_instructions. Empty instructions are fine. Do not change House plate defaults.",
    "Never invent grocery prices. Never claim Smith's cart adds.",
    "On a choice3 week, pending_ballot or options_pending means write exactly 3 distinct options per listed night with submit_week_options (servings = that night's plates); never write meals directly on a choice3 week.",
  ].join(" ");
}

export function clampHouseSetupStep(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return HOUSE_SETUP_DONE_STEP;
  return Math.min(HOUSE_SETUP_DONE_STEP, Math.max(HOUSE_SETUP_FIRST_STEP, Math.round(n)));
}

export function isHouseSetupComplete(step: number): boolean {
  return clampHouseSetupStep(step) >= HOUSE_SETUP_DONE_STEP;
}

export function shouldShowHouseSetup(role: Role | null | undefined, setupStep: number): boolean {
  return isAdmin(role) && !isHouseSetupComplete(setupStep);
}

export type HouseSetupStep = (typeof HOUSE_SETUP_STEPS)[number];

export function houseSetupStepMeta(step: number): HouseSetupStep {
  const index = Math.min(HOUSE_SETUP_LAST_STEP, clampHouseSetupStep(step)) - 1;
  return HOUSE_SETUP_STEPS[index];
}

export function nextHouseSetupStep(step: number): number {
  return Math.min(HOUSE_SETUP_DONE_STEP, clampHouseSetupStep(step) + 1);
}

export function previousHouseSetupStep(step: number): number {
  return Math.max(HOUSE_SETUP_FIRST_STEP, clampHouseSetupStep(step) - 1);
}

export function parseWeeklyBudgetDollars(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/[$,]/g, ""));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Enter a weekly budget in dollars, or leave it blank.");
  }
  return Math.round(n * 100);
}

export function formatWeeklyBudgetDollars(cents: number | null | undefined): string {
  if (cents == null) return "";
  if (!Number.isFinite(cents) || cents < 0) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export function weeklyBudgetCurrencyPrefix(postalCode: string | null | undefined): "$" {
  const kind: PostalKind = postalCode?.trim() ? classifyPostalCode(postalCode).kind : "us";
  switch (kind) {
    case "us":
    case "ca":
    case "uk":
    case "unknown":
      return "$";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function clampHouseholdSize(value: unknown): number {
  if (typeof value === "number") return clampHeadcount(value);
  const n = Number(value);
  return clampHeadcount(Number.isFinite(n) ? n : 2);
}

export function parseBallotRequestStatus(value: unknown): "pending" | "fulfilled" | "cancelled" | null {
  switch (value) {
    case "pending":
    case "fulfilled":
    case "cancelled":
      return value;
    default:
      return null;
  }
}
