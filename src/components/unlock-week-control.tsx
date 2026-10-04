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
  LOCKED_CHIP_LABEL,
  UNLOCK_WEEK_CHOICE_CONFIRM,
  UNLOCK_WEEK_CONFIRM,
  UNLOCK_WEEK_LABEL,
} from "@/lib/lock-success";
import { isAdmin } from "@/lib/users";

export function UnlockWeekControl({ variant }: { variant: "inline" | "block" }) {
  const { snapshot, session, unlockWeek } = useSupper();
  const { scope } = useViewedWeek();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!snapshot || !scope || scope.week.status !== "locked") return null;

  const admin = isAdmin(session?.role);
  if (variant === "block" && !admin) return null;

  const confirm = () => {
    setBusy(true);
    void unlockWeek()
      .then(() => setOpen(false))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <>
      {variant === "inline" ? (
        <div className="flex flex-wrap items-center gap-1">
          <span
            data-slot="week-locked-chip"
            data-week-id={scope.week.id}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted px-2.5 type-chip font-semibold text-foreground"
          >
            <Lock className="size-3.5" aria-hidden />
            {LOCKED_CHIP_LABEL}
          </span>
          {admin ? (
            <Button
              type="button"
              variant="ghost"
              data-slot="unlock-week"
              className="h-11 px-2 font-semibold text-primary"
              disabled={busy}
              aria-busy={busy}
              onClick={() => setOpen(true)}
            >
              {busy ? "Unlocking…" : UNLOCK_WEEK_LABEL}
            </Button>
          ) : null}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="fat"
          data-slot="unlock-week"
          className="w-full"
          disabled={busy}
          aria-busy={busy}
          onClick={() => setOpen(true)}
        >
          {busy ? "Unlocking…" : UNLOCK_WEEK_LABEL}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
        }}
      >
        <DialogContent showCloseButton={false} className="rounded-[14px]">
          <DialogHeader>
            <DialogTitle className="type-section">
              {scope.week.ballotMode === "choice3" ? (
                UNLOCK_WEEK_CHOICE_CONFIRM
              ) : (
                <>{UNLOCK_WEEK_CONFIRM}</>
              )}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              size="fat"
              variant="primary"
              className="w-full"
              data-slot="unlock-week-confirm"
              disabled={busy}
              aria-busy={busy}
              onClick={confirm}
            >
              {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
              {busy ? "Unlocking…" : UNLOCK_WEEK_LABEL}
            </Button>
            <Button
              type="button"
              size="fat"
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
