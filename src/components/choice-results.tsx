"use client";

import { useState } from "react";
import {
  RESULTS_TITLE,
  choiceNights,
  tallyNight,
  tieBreakLabel,
  winnerForNight,
} from "@/lib/choice-ballot";
import { formatMealCardDayLabel } from "@/lib/dates";
import { memberInitials } from "@/lib/initials";
import { memberName } from "@/lib/names";
import type { Household, MealOption, MealPick, Membership, OptionRequest, Week } from "@/lib/types";

export function ChoiceResults({
  week,
  household,
  options,
  picks,
  optionRequests,
  memberships,
}: {
  week: Week;
  household: Household;
  options: readonly MealOption[];
  picks: readonly MealPick[];
  optionRequests: readonly OptionRequest[];
  memberships: readonly Membership[];
}) {
  const [open, setOpen] = useState(false);
  const nights = choiceNights({ week, household, options, optionRequests });

  return (
    <section className="rounded-[14px] bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-section">{RESULTS_TITLE}</h2>
        <button type="button" className="type-meta text-primary" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide votes" : "See votes"}
        </button>
      </div>
      {open ? (
        <div className="mt-3 space-y-4">
          {nights.map((night) => {
            const winner = winnerForNight(night.options, picks, memberships);
            const tallies = tallyNight(night.options, picks, memberships);
            const tie = tieBreakLabel(winner?.tie ?? null);
            return (
              <div key={night.dayIndex}>
                <p className="type-day-label">{formatMealCardDayLabel(night.nightDate)}</p>
                <ul className="mt-2 space-y-2">
                  {night.options.map((option) => {
                    const tally = tallies.find((row) => row.optionId === option.id);
                    const votes = tally?.votes ?? 0;
                    const won = winner?.option.id === option.id;
                    return (
                      <li key={option.id}>
                        <p className={won ? "type-body font-semibold" : "type-body text-muted-foreground"}>
                          {option.title}
                          <span className="type-meta ml-2">
                            {votes} {votes === 1 ? "vote" : "votes"}
                          </span>
                          {won && tie ? <span className="type-meta ml-2">{tie}</span> : null}
                        </p>
                        <div className="mt-1 flex gap-1">
                          {(tally?.voterIds ?? []).map((id) => {
                            const member = memberships.find((row) => row.id === id);
                            if (!member) return null;
                            return (
                              <span
                                key={id}
                                title={memberName(member)}
                                className="inline-flex size-7 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-muted-foreground"
                              >
                                {memberInitials(memberName(member))}
                              </span>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
