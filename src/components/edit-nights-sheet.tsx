"use client";

import { useRef, useState } from "react";
import { PlanningPeopleGate } from "@/components/planning-people-gate";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  EDIT_NIGHTS_CANCEL_LABEL,
  EDIT_NIGHTS_LABEL,
  EDIT_NIGHTS_SAVE_ERROR,
  dinnersTurningOff,
  planWeekNightChanges,
  savedNewNightsToast,
  showWeekSpecialInstructions,
  turnOffChoiceNightConfirm,
  turnOffDinnerConfirm,
  withFrozenNights,
} from "@/lib/edit-nights";
import { clampSpecialInstructions } from "@/lib/planning-people";
import type { Household, Meal, Membership, Vote, Week, WeekRole } from "@/lib/types";

export function EditNightsSheet({
  open,
  role,
  household,
  initialCounts,
  storedInstructions,
  meals,
  votes,
  memberships,
  ballotMode = "single",
  frozenWeekdays,
  busy = false,
  onOpenChange,
  onSave,
  onSaved,
}: {
  open: boolean;
  role: WeekRole;
  household: Household;
  initialCounts: number[];
  storedInstructions: string | null;
  meals: readonly Pick<Meal, "id" | "title" | "nightDate" | "servings">[];
  votes: Vote[];
  memberships: Membership[];
  ballotMode?: Week["ballotMode"];
  frozenWeekdays: readonly number[];
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (counts: number[], instructions: string | null) => Promise<void>;
  onSaved?: (message: string | null) => void;
}) {
  const showNotes = showWeekSpecialInstructions({ role, stored: storedInstructions });
  const turnOffConfirm = ballotMode === "choice3" ? turnOffChoiceNightConfirm : turnOffDinnerConfirm;
  const pending = useRef<{ counts: number[]; instructions: string | null } | null>(null);
  const [confirming, setConfirming] = useState<string[]>([]);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [savingOff, setSavingOff] = useState(false);

  const commit = async (counts: number[], instructions: string | null) => {
    const changes = planWeekNightChanges({
      previous: initialCounts,
      next: counts,
      hasMeals: meals.length > 0,
    });
    await onSave(counts, instructions);
    onSaved?.(savedNewNightsToast(changes, meals.length > 0));
    setConfirming([]);
    pending.current = null;
    onOpenChange(false);
  };

  const close = () => {
    setConfirming([]);
    setSheetError(null);
    pending.current = null;
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <SheetContent side="bottom" className="px-4" data-slot="edit-nights-sheet">
        <SheetHeader className="px-0">
          <SheetTitle>{EDIT_NIGHTS_LABEL}</SheetTitle>
          <SheetDescription>Change which nights get dinner this week.</SheetDescription>
        </SheetHeader>
        {sheetError ? (
          <p data-slot="edit-nights-error" className="type-meta text-destructive">
            {sheetError}
          </p>
        ) : null}
        <PlanningPeopleGate
          key={open ? "editing" : "closed"}
          household={household}
          canEdit
          busy={busy || savingOff}
          initialCounts={initialCounts}
          initialInstructions={storedInstructions ?? ""}
          showInstructions={showNotes}
          lockedWeekdays={frozenWeekdays}
          cancelLabel={EDIT_NIGHTS_CANCEL_LABEL}
          onBack={close}
          onSave={async (counts, instructions) => {
            const next = withFrozenNights(initialCounts, counts, frozenWeekdays);
            const notes = showNotes ? clampSpecialInstructions(instructions) : null;
            const offs = dinnersTurningOff({
              previous: initialCounts,
              next,
              meals,
              votes,
              memberships,
            });
            if (offs.length > 0) {
              pending.current = { counts: next, instructions: notes };
              setConfirming(offs);
              return;
            }
            setSheetError(null);
            await commit(next, notes);
          }}
        />
        {confirming.length > 0 ? (
          <div
            data-slot="turn-off-night"
            className="mt-3 rounded-[14px] border border-border bg-card p-4 shadow-card"
            role="alertdialog"
            aria-labelledby="turn-off-night-title"
          >
            <p id="turn-off-night-title" className="type-body font-semibold">
              {confirming.length === 1
                ? turnOffConfirm(confirming[0] ?? "")
                : "Turn off these nights?"}
            </p>
            {confirming.length > 1 ? (
              <ul className="type-meta mt-2 space-y-1 text-muted-foreground">
                {confirming.map((weekday) => (
                  <li key={weekday}>{turnOffConfirm(weekday)}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="fat"
                className="flex-1"
                onClick={() => {
                  setConfirming([]);
                  pending.current = null;
                }}
              >
                Keep
              </Button>
              <Button
                type="button"
                variant="primary"
                size="fat"
                className="flex-1"
                disabled={savingOff}
                onClick={() => {
                  const next = pending.current;
                  if (!next) return;
                  setSavingOff(true);
                  setSheetError(null);
                  void commit(next.counts, next.instructions)
                    .catch((err: unknown) => {
                      setSheetError(
                        err instanceof Error && err.message ? err.message : EDIT_NIGHTS_SAVE_ERROR,
                      );
                    })
                    .finally(() => setSavingOff(false));
                }}
              >
                {savingOff ? "Saving…" : "Turn off"}
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
