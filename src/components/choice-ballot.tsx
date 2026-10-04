"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { OptionCarousel } from "@/components/option-carousel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  ASK_FOR_NEW_OPTIONS,
  EVERYONE_IN,
  LOCKED_IN_SELF,
  NEW_OPTIONS_PENDING,
  NONE_OF_THESE,
  NONE_OF_THESE_SHEET_TITLE,
  REOPEN_VOTE_LABEL,
  myPicksByNight,
  pickProgress,
  pickProgressLabel,
  waitingOn,
  waitingOnLabel,
  type ChoiceNight,
} from "@/lib/choice-ballot";
import { formatMealCardDayLabel, weekdayLabelFromNight } from "@/lib/dates";
import { servingsLabel } from "@/lib/headcount";
import { memberInitials } from "@/lib/initials";
import { nightCardAnchorId } from "@/lib/week-strip";
import type { MealPick, Membership, VoteSubmission } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ChoiceBallot({
  nights,
  picks,
  memberships,
  submissions,
  membershipId,
  canVote,
  admin,
  onPick,
  onRequest,
  onCancelRequest,
  onReopen,
}: {
  nights: readonly ChoiceNight[];
  picks: readonly MealPick[];
  memberships: readonly Membership[];
  submissions: readonly VoteSubmission[];
  membershipId: string | null;
  canVote: boolean;
  admin: boolean;
  onPick: (optionId: string) => void;
  onRequest: (dayIndex: number, note: string) => Promise<void>;
  onCancelRequest: (requestId: string) => Promise<void>;
  onReopen: (memberId: string) => Promise<void>;
}) {
  const submitted = Boolean(
    membershipId && submissions.some((row) => row.membershipId === membershipId),
  );
  const myPicks = myPicksByNight(picks, membershipId);
  const progress = pickProgress(nights, myPicks);
  const holdouts = waitingOn(memberships, submissions);
  const voters = memberships.filter((member) => member.role === "owner" || member.role === "voter");
  const submittedIds = new Set(submissions.map((row) => row.membershipId));
  const [sheetDay, setSheetDay] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [reopenId, setReopenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reopenMember = voters.find((member) => member.id === reopenId) ?? null;

  const sendRequest = () => {
    if (sheetDay == null) return;
    setBusy(true);
    void onRequest(sheetDay, note)
      .then(() => {
        setSheetDay(null);
        setNote("");
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[14px] bg-card p-3 shadow-card">
        {canVote && !submitted ? (
          <>
            <p className="type-meta">{pickProgressLabel(progress)}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{
                  width: `${progress.total === 0 ? 0 : (progress.picked / progress.total) * 100}%`,
                }}
              />
            </div>
          </>
        ) : submitted ? (
          <p className="type-body">
            {LOCKED_IN_SELF}{" "}
            <span className="text-muted-foreground">
              {holdouts.length === 0 ? EVERYONE_IN : waitingOnLabel(holdouts.map((member) => member.displayName))}
            </span>
          </p>
        ) : (
          <p className="type-meta text-muted-foreground">
            {holdouts.length === 0 ? EVERYONE_IN : waitingOnLabel(holdouts.map((member) => member.displayName))}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {voters.map((member) => {
            const lockedIn = submittedIds.has(member.id);
            return (
              <div key={member.id} className="flex items-center gap-1">
                <span
                  title={`${member.displayName}: ${lockedIn ? "locked in" : "still picking"}`}
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-full text-[11px] font-bold",
                    lockedIn
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  {lockedIn ? <Check className="size-3.5" aria-hidden /> : memberInitials(member.displayName)}
                </span>
                {admin && lockedIn ? (
                  <button
                    type="button"
                    className="type-meta text-primary"
                    onClick={() => setReopenId(member.id)}
                  >
                    {REOPEN_VOTE_LABEL}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {nights.map((night) => {
        const selectedId = myPicks.get(night.dayIndex) ?? null;
        const pending = night.pendingRequest;
        const canAsk = canVote && !submitted && !pending;
        return (
          <section
            key={night.dayIndex}
            id={nightCardAnchorId(`night-${night.dayIndex}`)}
            tabIndex={-1}
            data-slot="night-card-anchor"
            className="scroll-mt-[calc(var(--shell-head-h)+0.25rem)] space-y-2 rounded-[14px] outline-none focus:ring-2 focus:ring-primary/40"
          >
            <div className="flex items-center justify-between gap-2">
              <p data-slot="meal-day-label" className="type-day-label">
                {formatMealCardDayLabel(night.nightDate)}
              </p>
              <span className="type-chip rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground">
                {servingsLabel(night.plates)}
              </span>
            </div>
            {pending ? (
              <div className="rounded-[14px] border border-dashed border-border bg-card p-4">
                <p className="type-section">{NEW_OPTIONS_PENDING}</p>
                {pending.note ? <p className="type-body mt-2 text-muted-foreground">{pending.note}</p> : null}
                {admin || pending.requestedBy === membershipId ? (
                  <Button
                    type="button"
                    variant="link"
                    className="mt-2 h-auto min-h-11 px-0"
                    onClick={() => void onCancelRequest(pending.id)}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            ) : (
              <OptionCarousel
                weekday={weekdayLabelFromNight(night.nightDate)}
                options={night.options}
                selectedId={selectedId}
                readOnly={!canVote || submitted}
                onSelect={onPick}
              />
            )}
            {canAsk ? (
              <Button type="button" variant="link" className="h-auto min-h-11 px-0" onClick={() => setSheetDay(night.dayIndex)}>
                {NONE_OF_THESE}
              </Button>
            ) : null}
          </section>
        );
      })}

      <Sheet
        open={sheetDay != null}
        onOpenChange={(open) => {
          if (!open) {
            setSheetDay(null);
            setNote("");
          }
        }}
      >
        <SheetContent side="bottom" showCloseButton={false} className="rounded-t-[16px]">
          <SheetHeader>
            <SheetTitle className="type-section">{NONE_OF_THESE_SHEET_TITLE}</SheetTitle>
          </SheetHeader>
          <div className="space-y-2 px-4">
            <Label htmlFor="new-options-note" className="type-meta text-muted-foreground">
              Optional note
            </Label>
            <Textarea
              id="new-options-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-16 max-h-32 overflow-y-auto rounded-[var(--radius-button)] text-base"
            />
          </div>
          <SheetFooter className="flex-row gap-2">
            <Button
              type="button"
              size="fat"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setSheetDay(null);
                setNote("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="fat"
              variant="primary"
              className="flex-1"
              disabled={busy}
              onClick={sendRequest}
            >
              {ASK_FOR_NEW_OPTIONS}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={reopenMember != null} onOpenChange={(open) => !open && setReopenId(null)}>
        <DialogContent className="rounded-[14px]">
          <DialogHeader>
            <DialogTitle className="type-section">
              {REOPEN_VOTE_LABEL}
              {reopenMember ? ` for ${reopenMember.displayName}?` : "?"}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              size="fat"
              variant="primary"
              className="w-full"
              onClick={() => {
                if (!reopenMember) return;
                void onReopen(reopenMember.id).then(() => setReopenId(null));
              }}
            >
              {REOPEN_VOTE_LABEL}
            </Button>
            <Button type="button" size="fat" variant="outline" className="w-full" onClick={() => setReopenId(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
