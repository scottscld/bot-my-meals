import type { Household, HouseholdSettingsPatch } from "@/lib/types";

export const HEB_SITE = "https://www.heb.com";
export const HEB_CART_URL = "https://www.heb.com/cart";

export const HEB_CHECKOUT_DEFAULTS = {
  hebCheckoutMode: "review" as const,
  deliveryDays: null,
  deliveryWindowStart: null,
  deliveryWindowEnd: null,
  orderMaxCents: null,
  listApproverRole: "owner" as const,
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Guard for the full checkout total. Null max falls back to the weekly budget. Both null means no guard. */
export function orderGuardCents(household: {
  orderMaxCents: number | null;
  weeklyBudgetCents: number | null;
}): number | null {
  if (household.orderMaxCents != null) return household.orderMaxCents;
  return household.weeklyBudgetCents;
}

/** `HH:MM`, or null when the value is blank or not a time. */
export function parseDeliveryWindow(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function clockLabel(hhmm: string): string {
  const parsed = parseDeliveryWindow(hhmm);
  if (!parsed) return hhmm;
  const [hourText, minuteText] = parsed.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  if (minute === 0) return `${hour12} ${suffix}`;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** "4 PM" and "6 PM" become "4–6 PM". Different periods stay "11 AM–1 PM". */
function joinClockRange(start: string, end: string): string {
  const period = (label: string) => (label.endsWith(" AM") || label.endsWith(" PM") ? label.slice(-3) : "");
  const startPeriod = period(start);
  const endPeriod = period(end);
  if (startPeriod && startPeriod === endPeriod) return `${start.slice(0, -3)}–${end}`;
  return `${start}–${end}`;
}

function dayList(days: readonly number[]): string {
  const labels = [...days]
    .filter((day) => day >= 0 && day <= 6)
    .sort((a, b) => a - b)
    .map((day) => WEEKDAY_SHORT[day] ?? "");
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}

/** "Tue or Thu, 4–7 PM". Empty preference is "Any day, any time". */
export function formatDeliveryPreference(household: {
  deliveryDays: number[] | null;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
}): string {
  const days = dayList(household.deliveryDays ?? []);
  const start = household.deliveryWindowStart ? clockLabel(household.deliveryWindowStart) : "";
  const end = household.deliveryWindowEnd ? clockLabel(household.deliveryWindowEnd) : "";
  const window = start && end ? joinClockRange(start, end) : "";
  if (days && window) return `${days}, ${window}`;
  if (days) return days;
  if (window) return window;
  return "Any day, any time";
}

function zonedParts(iso: string, timeZone: string): { weekday: string; month: string; day: string; hour: string } {
  const date = new Date(iso);
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).formatToParts(date);
  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const read = (parts: Intl.DateTimeFormatPart[], type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const minute = read(timeParts, "minute");
  const hour = read(timeParts, "hour");
  const dayPeriod = read(timeParts, "dayPeriod").toUpperCase();
  const clock = minute === "00" ? `${hour} ${dayPeriod}` : `${hour}:${minute} ${dayPeriod}`;
  return {
    weekday: read(dateParts, "weekday"),
    month: read(dateParts, "month"),
    day: read(dateParts, "day"),
    hour: clock,
  };
}

/** "Tue Oct 6, 4–6 PM" in the household time zone. */
export function formatDeliveryWindow(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  timeZone: string,
): string | null {
  if (!startIso) return null;
  const zone = timeZone.trim() || "America/Chicago";
  const start = zonedParts(startIso, zone);
  const day = `${start.weekday} ${start.month} ${start.day}`;
  if (!endIso) return `${day}, ${start.hour}`;
  const end = zonedParts(endIso, zone);
  return `${day}, ${joinClockRange(start.hour, end.hour)}`;
}

export function formatOrderDollars(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** Null when the patch is safe to write. */
export function validateHebCheckoutPatch(patch: HouseholdSettingsPatch): string | null {
  if (
    patch.hebCheckoutMode !== undefined &&
    patch.hebCheckoutMode !== "auto" &&
    patch.hebCheckoutMode !== "review"
  ) {
    return "Pick a checkout mode.";
  }
  if (
    patch.listApproverRole !== undefined &&
    patch.listApproverRole !== "owner" &&
    patch.listApproverRole !== "voter"
  ) {
    return "Pick who can approve the list.";
  }
  if (patch.deliveryDays != null) {
    const bad = patch.deliveryDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6);
    if (bad) return "Delivery days must be Sunday through Saturday.";
  }
  if (patch.deliveryWindowStart !== undefined || patch.deliveryWindowEnd !== undefined) {
    const startRaw = patch.deliveryWindowStart ?? null;
    const endRaw = patch.deliveryWindowEnd ?? null;
    const start = startRaw ? parseDeliveryWindow(startRaw) : null;
    const end = endRaw ? parseDeliveryWindow(endRaw) : null;
    if (startRaw && !start) return "Pick a delivery start time.";
    if (endRaw && !end) return "Pick a delivery end time.";
    if ((start && !end) || (!start && end)) return "Set both delivery times, or leave both as any time.";
    if (start && end && end <= start) return "Delivery end must be after the start.";
  }
  if (patch.orderMaxCents !== undefined && patch.orderMaxCents !== null) {
    const cents = patch.orderMaxCents;
    if (!Number.isInteger(cents) || cents < 100 || cents > 500000) {
      return "Max order total must be between $1 and $5,000.";
    }
  }
  return null;
}

function asClock(value: unknown): string | null {
  return typeof value === "string" ? parseDeliveryWindow(value) : null;
}

function asCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Math.round(Number(value));
  return null;
}

export function mapHebCheckoutColumns(row: Record<string, unknown>): Pick<
  Household,
  | "hebCheckoutMode"
  | "deliveryDays"
  | "deliveryWindowStart"
  | "deliveryWindowEnd"
  | "orderMaxCents"
  | "listApproverRole"
> {
  const days = Array.isArray(row.delivery_days)
    ? row.delivery_days
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  return {
    hebCheckoutMode: row.heb_checkout_mode === "auto" ? "auto" : "review",
    deliveryDays: days.length ? days : null,
    deliveryWindowStart: asClock(row.delivery_window_start),
    deliveryWindowEnd: asClock(row.delivery_window_end),
    orderMaxCents: asCents(row.order_max_cents),
    listApproverRole: row.list_approver_role === "voter" ? "voter" : "owner",
  };
}

/** Null when the house has no delivery preference. */
export function orderDelivery(household: {
  deliveryDays: number[] | null;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  timezone: string;
}): { days: number[]; start: string | null; end: string | null; timezone: string } | null {
  const days = household.deliveryDays ?? [];
  const start = household.deliveryWindowStart;
  const end = household.deliveryWindowEnd;
  if (days.length === 0 && !start && !end) return null;
  return {
    days,
    start,
    end,
    timezone: household.timezone.trim() || "America/Chicago",
  };
}
