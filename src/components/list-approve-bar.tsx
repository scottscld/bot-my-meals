"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useSupper } from "@/components/supper-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ListApproveBar({
  listId,
  activeCount,
  canApprove,
}: {
  listId: string;
  activeCount: number;
  canApprove: boolean;
}) {
  const { approveList, error } = useSupper();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canApprove) {
    return (
      <p data-slot="list-approve-bar" className="type-meta text-center text-muted-foreground">
        Waiting for an Admin to approve.
      </p>
    );
  }

  const confirm = () => {
    setBusy(true);
    void approveList(listId)
      .then(() => setOpen(false))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <div data-slot="list-approve-bar" className="rounded-[14px] bg-card p-3 shadow-card">
      <Button
        type="button"
        size="fat"
        variant="primary"
        className="w-full"
        disabled={activeCount === 0 || busy}
        aria-busy={busy}
        onClick={() => setOpen(true)}
      >
        {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
        {busy ? "Approving…" : `Approve list · ${activeCount} items`}
      </Button>
      {error ? <p className="type-meta mt-2 text-destructive">{error}</p> : null}
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="rounded-[14px]">
          <DialogHeader>
            <DialogTitle className="type-section">Approve list</DialogTitle>
          </DialogHeader>
          <p className="type-body text-muted-foreground">
            Send these {activeCount} items to your bot for H-E-B?
          </p>
          <DialogFooter>
            <Button type="button" size="fat" variant="primary" className="w-full" disabled={busy} onClick={confirm}>
              {busy ? "Approving…" : "Approve list"}
            </Button>
            <Button
              type="button"
              size="fat"
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Not yet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
