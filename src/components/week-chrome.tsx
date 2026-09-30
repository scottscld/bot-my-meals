"use client";

import { ChevronRight, ClipboardList, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { WeekNavigator } from "@/components/week-navigator";
import { LOCK_SUCCESS_LIST_CTA } from "@/lib/lock-success";
import { PLAN_NEXT_WEEK_LABEL } from "@/lib/open-weeks";
import { featuredMealEyebrow } from "@/lib/week-chrome";
import type { WeekStripNight } from "@/lib/week-strip";

export type WeekChromeMeal = {
  id: string;
  title: string;
  nightDate: string;
};

export function WeekChrome({
  startsOn,
  nights,
  selectedMealId,
  todayIso,
  locked,
  mutedDates,
  showShoppingList,
  firstMeal,
  onSelect,
  onStep,
  planNext,
}: {
  startsOn: string;
  nights: readonly WeekStripNight[];
  selectedMealId: string | null;
  todayIso: string;
  locked: boolean;
  mutedDates: readonly string[];
  showShoppingList: boolean;
  firstMeal: WeekChromeMeal | null;
  onSelect: (mealId: string) => void;
  onStep: (direction: -1 | 1) => boolean;
  planNext: { busy: boolean; onPlan: () => void } | null;
}) {
  return (
    <WeekChromeView
      startsOn={startsOn}
      nights={nights}
      selectedMealId={selectedMealId}
      todayIso={todayIso}
      locked={locked}
      mutedDates={mutedDates}
      showShoppingList={showShoppingList}
      firstMeal={firstMeal}
      onSelect={onSelect}
      onStep={onStep}
      planNext={planNext}
    />
  );
}

export function WeekChromeView({
  startsOn,
  nights,
  selectedMealId,
  todayIso,
  locked,
  mutedDates,
  showShoppingList,
  firstMeal,
  onSelect,
  onStep,
  planNext,
}: {
  startsOn: string;
  nights: readonly WeekStripNight[];
  selectedMealId: string | null;
  todayIso: string;
  locked: boolean;
  mutedDates: readonly string[];
  showShoppingList: boolean;
  firstMeal: WeekChromeMeal | null;
  onSelect: (mealId: string) => void;
  onStep: (direction: -1 | 1) => boolean;
  planNext: { busy: boolean; onPlan: () => void } | null;
}) {
  const showRows = showShoppingList || Boolean(firstMeal);
  const featuredEyebrow = firstMeal ? featuredMealEyebrow(firstMeal.nightDate, todayIso) : null;
  return (
    <div data-slot="week-chrome" data-locked={locked ? "true" : "false"} className="min-w-0">
      <WeekNavigator
        startsOn={startsOn}
        nights={nights}
        selectedMealId={selectedMealId}
        todayIso={todayIso}
        locked={locked}
        mutedDates={mutedDates}
        onSelect={onSelect}
        onStep={onStep}
      />
      {planNext ? (
        <p className="bg-card px-4 py-2 text-center">
          <button
            type="button"
            data-slot="plan-next-week"
            className="type-meta min-h-11 text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4"
            disabled={planNext.busy}
            onClick={planNext.onPlan}
          >
            {planNext.busy ? "Saving…" : PLAN_NEXT_WEEK_LABEL}
          </button>
        </p>
      ) : null}
      {showRows ? (
        <div className="space-y-2 bg-card p-4">
          {showShoppingList ? (
            <Link
              href="/list"
              data-slot="lock-success-list"
              aria-label={LOCK_SUCCESS_LIST_CTA}
              className="flex min-h-12 w-full items-center gap-3 rounded-[12px] bg-primary px-4 py-3 text-primary-foreground"
            >
              <ClipboardList className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-base font-semibold text-white">
                {LOCK_SUCCESS_LIST_CTA}
              </span>
              <ChevronRight className="size-5 shrink-0" aria-hidden />
            </Link>
          ) : null}
          {firstMeal && featuredEyebrow ? (
            <Link
              href={`/week/${firstMeal.id}`}
              data-slot="lock-success-recipes"
              aria-label={`${featuredEyebrow}, ${firstMeal.title}`}
              className="flex min-h-12 w-full items-center gap-3 rounded-[12px] bg-primary px-4 py-3 text-primary-foreground"
            >
              <UtensilsCrossed className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-[18px] text-white/80">{featuredEyebrow}</span>
                <span className="block truncate text-base font-semibold text-white">{firstMeal.title}</span>
              </span>
              <ChevronRight className="size-5 shrink-0" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
