"use client";

import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useSupper } from "@/components/supper-provider";
import { useViewedWeek } from "@/components/use-viewed-week";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LOCK_IN_CONFIRM_ACTION,
  LOCK_IN_CONFIRM_BODY,
  LOCK_IN_CONFIRM_TITLE,
  LOCK_IN_KEEP,
  LOCK_IN_LABEL,
  choiceNights,
  lockInHint,
  lockInReady,
  myPicksByNight,
  waitingOn,
  waitingOnLabel,
} from "@/lib/choice-ballot";
import { WEEKDAY_SHORT, weekdayIndexFromDate } from "@/lib/dates";
import { canActOnBallot } from "@/lib/lock";

export function LockInBar() {
  const { snapshot, session, lockInVote, error } = useSupper();
  const { scope } = useViewedWeek();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!snapshot || !scope) return null;

  const nights = choiceNights({
    week: scope.week,
    household: snapshot.household,
    options: scope.options,
    optionRequests: scope.optionRequests,
  });
  const membershipId = session?.membershipId ?? null;
  const canVote = Boolean(membershipId) && canActOnBallot(session?.role);
  const submitted = Boolean(
    membershipId && scope.submissions.some((row) => row.membershipId === membershipId),
  );
  const myPicks = myPicksByNight(scope.picks, membershipId);
  const ready = lockInReady({ nights, myPicks, submitted, canVote });
  const hint = lockInHint(nights, myPicks);

  if (!canVote || submitted) {
    const names = waitingOn(snapshot.memberships, scope.submissions).map((member) => member.displayName);
    const line = waitingOnLabel(names);
    if (!line) return null;
    return <p className="type-meta text-center text-muted-foreground">{line}</p>;
  }

  const picks = nights.flatMap((night) => {
    const optionId = myPicks.get(night.dayIndex);
    const option = night.options.find((row) => row.id === optionId);
    if (!option) return [];
    const day = WEEKDAY_SHORT[weekdayIndexFromDate(night.nightDate)];
    return [`${day} · ${option.title}`];
  });

  const confirm = () => {
    setBusy(true);
    void lockInVote()
      .then(() => setOpen(false))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <div data-slot="lock-in-bar" className="rounded-[14px] bg-card p-3 shadow-card">
      <Button
        size="fat"
        variant="primary"
        className="w-full gap-2 shadow-float"
        disabled={!ready || busy}
        aria-busy={busy}
        onClick={() => setOpen(true)}
      >
        {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Lock className="size-5" />}
        {busy ? "Locking in…" : LOCK_IN_LABEL}
      </Button>
      {!ready && hint ? <p className="type-meta mt-2 text-muted-foreground">{hint}</p> : null}
      {error ? <p className="type-meta mt-2 text-destructive">{error}</p> : null}
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="rounded-[14px]">
          <DialogHeader>
            <DialogTitle className="type-section">{LOCK_IN_CONFIRM_TITLE}</DialogTitle>
          </DialogHeader>
          <p className="type-body text-muted-foreground">{LOCK_IN_CONFIRM_BODY}</p>
          <ul className="type-body mt-3 space-y-1">
            {picks.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" size="fat" variant="primary" className="w-full" disabled={busy} onClick={confirm}>
              {busy ? "Locking in…" : LOCK_IN_CONFIRM_ACTION}
            </Button>
            <Button
              type="button"
              size="fat"
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {LOCK_IN_KEEP}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
