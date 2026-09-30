import { addDays, formatMealCardDayLabel, formatWeekRange, weekdayIndexFromDate } from "./dates";
import type { MealHistoryNight, MealHistoryWeek, WeekStatus } from "./types";

/** UI lists this many finished weeks, newest first. Older rows drop from History. */
export const HISTORY_UI_LIMIT = 26;

export const PAST_WEEKS_LABEL = "Past weeks";

export const PAST_WEEKS_EMPTY =
  "No finished weeks yet. Locked weeks show up here after the week ends.";

export const PAST_WEEKS_HELPER = "Titles only — recipes aren’t kept for past weeks.";

const HOUSE_TIME_ZONE = "America/Los_Angeles";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Saturday inside the week that starts on `startsOn` (Sun–Sat when the house
 * week starts Sunday). The week has ended once the next calendar day has
 * started in the house timezone.
 */
export function saturdayOfWeek(startsOn: string): string {
  const daysUntilSaturday = (6 - weekdayIndexFromDate(startsOn) + 7) % 7;
  return addDays(startsOn, daysUntilSaturday);
}

export function todayInTimeZone(now: Date, timeZone: string): string {
  const zone = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    return todayInTimeZone(now, HOUSE_TIME_ZONE);
  }
  return `${year}-${month}-${day}`;
}

function resolveTimeZone(timeZone: string): string {
  const candidate = timeZone.trim() || HOUSE_TIME_ZONE;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return HOUSE_TIME_ZONE;
  }
}

function civilPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const raw = Number(parts.find((part) => part.type === type)?.value);
  if (type === "hour" && raw === 24) return 0;
  return raw;
}

/**
 * UTC instant for a clock time on a calendar date in `timeZone`.
 * Noon is the safe choice for a date-only night: UTC midnight of that
 * date is the previous evening in US timezones.
 */
export function instantOnCivilDate(
  isoDate: string,
  timeZone: string,
  hour: number,
  minute = 0,
): Date {
  const zone = resolveTimeZone(timeZone);
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return new Date(NaN);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = desired;
  for (let pass = 0; pass < 2; pass += 1) {
    const guess = new Date(utc);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(guess);
    const asUtc = Date.UTC(
      civilPart(parts, "year"),
      civilPart(parts, "month") - 1,
      civilPart(parts, "day"),
      civilPart(parts, "hour"),
      civilPart(parts, "minute"),
      civilPart(parts, "second"),
    );
    if (Number.isNaN(asUtc)) return new Date(utc);
    const next = desired - (asUtc - guess.getTime());
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}

export function isWeekEnded(startsOn: string, timeZone: string, now: Date): boolean {
  return todayInTimeZone(now, timeZone) > saturdayOfWeek(startsOn);
}

/** Finished = Lock completed and the week's Saturday is already in the past. */
export function isFinishedWeek(
  status: WeekStatus,
  startsOn: string,
  timeZone: string,
  now: Date,
): boolean {
  return status === "locked" && isWeekEnded(startsOn, timeZone, now);
}

export type HistoryNightSource = {
  nightDate: string;
  title: string;
  plates?: number | null;
  /** Removed / no-dinner. Omitted from history. */
  off?: boolean;
};

/** Title and optional plates only. Blank and off nights are dropped. */
export function toHistoryNight(source: HistoryNightSource): MealHistoryNight | null {
  if (source.off) return null;
  const title = source.title.trim();
  if (!title) return null;
  const plates =
    typeof source.plates === "number" && Number.isFinite(source.plates) ? source.plates : null;
  return {
    nightDate: source.nightDate,
    title,
    plates,
  };
}

export type HistoryWeekSource = {
  startsOn: string;
  status: WeekStatus;
  nights: HistoryNightSource[];
};

export function listFinishedWeeks(
  weeks: HistoryWeekSource[],
  timeZone: string,
  now: Date,
): MealHistoryWeek[] {
  return weeks
    .filter((week) => isFinishedWeek(week.status, week.startsOn, timeZone, now))
    .map((week) => ({
      startsOn: week.startsOn,
      nights: week.nights
        .map((night) => toHistoryNight(night))
        .filter((night): night is MealHistoryNight => night != null)
        .sort((a, b) => a.nightDate.localeCompare(b.nightDate)),
    }))
    .sort((a, b) => b.startsOn.localeCompare(a.startsOn))
    .slice(0, HISTORY_UI_LIMIT);
}

export function dinnerCountLabel(count: number): string {
  return count === 1 ? "1 dinner" : `${count} dinners`;
}

export function historyWeekRowLabel(startsOn: string, dinnerCount: number): string {
  return `${formatWeekRange(startsOn)} · ${dinnerCountLabel(dinnerCount)}`;
}

export function historyNightLine(night: Pick<MealHistoryNight, "nightDate" | "title">): string {
  return `${formatMealCardDayLabel(night.nightDate)} · ${night.title}`;
}

/** Keep title, night date, and plates. Drop anything else a payload might carry. */
export function parseMealHistory(data: unknown): MealHistoryWeek[] {
  if (!Array.isArray(data)) return [];
  const weeks: MealHistoryWeek[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (typeof record.startsOn !== "string" || !ISO_DATE.test(record.startsOn)) continue;
    const nightsRaw = Array.isArray(record.nights) ? record.nights : [];
    const nights: MealHistoryNight[] = [];
    for (const nightRow of nightsRaw) {
      if (!nightRow || typeof nightRow !== "object") continue;
      const night = nightRow as Record<string, unknown>;
      if (typeof night.nightDate !== "string" || !ISO_DATE.test(night.nightDate)) continue;
      if (typeof night.title !== "string") continue;
      const parsed = toHistoryNight({
        nightDate: night.nightDate,
        title: night.title,
        plates: typeof night.plates === "number" ? night.plates : null,
      });
      if (parsed) nights.push(parsed);
    }
    nights.sort((a, b) => a.nightDate.localeCompare(b.nightDate));
    weeks.push({ startsOn: record.startsOn, nights });
  }
  return weeks.sort((a, b) => b.startsOn.localeCompare(a.startsOn)).slice(0, HISTORY_UI_LIMIT);
}
