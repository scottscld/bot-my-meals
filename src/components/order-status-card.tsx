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
import { Input } from "@/components/ui/input";
import { formatDeliveryWindow, formatOrderDollars, HEB_CART_URL, orderGuardCents } from "@/lib/heb-checkout";
import { canApprove, canReopenList } from "@/lib/list-review";
import type { ShoppingList } from "@/lib/types";

const STEPS = ["Approved", "Cart", "Ordered", "Delivery"] as const;

const REOPEN_CART =
  "Empty your heb.com cart first, or your bot will update it next time.";
const REOPEN_PLAIN = "Reopen this list?";

function stepIndex(list: ShoppingList): number | null {
  if (list.status === "failed" || list.status === "review") return null;
  if (list.status === "approved") return 0;
  if (list.status === "carting" || list.status === "awaiting_review") return 1;
  if (list.status === "ordered") {
    const delivered = Boolean(list.order.label?.trim() || list.order.windowStart);
    return delivered ? 3 : 2;
  }
  return null;
}

export function OrderStatusCard({ list }: { list: ShoppingList }) {
  const { snapshot, session, reopenList, retryOrder, markOrderPlaced } = useSupper();
  const [reopenOpen, setReopenOpen] = useState(false);
  const [busy, setBusy] = useState<"reopen" | "retry" | "placed" | null>(null);
  const [orderNumber, setOrderNumber] = useState("");
  if (!snapshot || list.status === "review") return null;

  const household = snapshot.household;
  const role = session?.role;
  const current = stepIndex(list);
  const when =
    list.order.label?.trim() ||
    formatDeliveryWindow(list.order.windowStart, list.order.windowEnd, household.timezone);
  const total = list.order.totalCents;
  const guard = orderGuardCents(household);
  const showReopen = canReopenList(list.status, role);
  const showRetry = list.status === "failed" && canApprove(role, household.listApproverRole);
  const showPlaced = list.status === "awaiting_review" && (role === "owner" || role === "voter");
  const confirmCopy = list.status === "awaiting_review" ? REOPEN_CART : REOPEN_PLAIN;

  const run = (kind: "reopen" | "retry" | "placed", fn: () => Promise<void>) => {
    setBusy(kind);
    void fn()
      .then(() => setReopenOpen(false))
      .catch(() => undefined)
      .finally(() => setBusy(null));
  };

  return (
    <section data-slot="order-status-card" className="rounded-[14px] border border-border bg-card p-4 shadow-card">
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((label, index) => {
          const reached = current != null && index <= current;
          return (
            <li
              key={label}
              aria-current={current === index ? "step" : undefined}
              className={reached ? "text-primary" : "text-muted-foreground"}
            >
              <span className={`mb-1 block h-1 rounded-full ${reached ? "bg-primary" : "bg-border"}`} />
              <span className="type-meta">{label}</span>
            </li>
          );
        })}
      </ol>
      {when ? <p className="type-body mt-3">{when}</p> : null}
      {total != null ? <p className="type-body mt-1">{formatOrderDollars(total)}</p> : null}
      {list.order.overGuard && guard != null ? (
        <p className="type-meta mt-1 text-destructive">over your {formatOrderDollars(guard)} limit</p>
      ) : null}
      {list.order.number ? <p className="type-meta mt-1 text-muted-foreground">Order {list.order.number}</p> : null}
      {list.order.message ? <p className="type-body mt-2 text-muted-foreground">{list.order.message}</p> : null}
      {list.status === "awaiting_review" ? (
        <a
          href={list.order.cartUrl || HEB_CART_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="type-body mt-3 inline-flex min-h-12 items-center text-primary underline"
        >
          Open heb.com cart
        </a>
      ) : null}
      {showPlaced ? (
        <div className="mt-3 space-y-2">
          <Input
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value)}
            placeholder="Order number (optional)"
            className="h-12 min-h-12 text-base"
            aria-label="Order number"
          />
          <Button
            type="button"
            size="fat"
            variant="outline"
            className="w-full"
            disabled={busy !== null}
            onClick={() => run("placed", () => markOrderPlaced(list.id, orderNumber))}
          >
            {busy === "placed" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
            I placed the order
          </Button>
        </div>
      ) : null}
      {showRetry ? (
        <Button
          type="button"
          size="fat"
          variant="primary"
          className="mt-3 w-full"
          disabled={busy !== null}
          onClick={() => run("retry", () => retryOrder(list.id))}
        >
          {busy === "retry" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
          Try again
        </Button>
      ) : null}
      {showReopen ? (
        <Button
          type="button"
          size="fat"
          variant="outline"
          className="mt-3 w-full"
          disabled={busy !== null}
          onClick={() => setReopenOpen(true)}
        >
          Reopen list
        </Button>
      ) : null}
      <Dialog open={reopenOpen} onOpenChange={(next) => busy !== "reopen" && setReopenOpen(next)}>
        <DialogContent className="rounded-[14px]">
          <DialogHeader>
            <DialogTitle className="type-section">Reopen list</DialogTitle>
          </DialogHeader>
          <p className="type-body text-muted-foreground">{confirmCopy}</p>
          <DialogFooter>
            <Button
              type="button"
              size="fat"
              variant="primary"
              className="w-full"
              disabled={busy === "reopen"}
              onClick={() => run("reopen", () => reopenList(list.id))}
            >
              {busy === "reopen" ? "Reopening…" : "Reopen list"}
            </Button>
            <Button
              type="button"
              size="fat"
              variant="outline"
              className="w-full"
              disabled={busy === "reopen"}
              onClick={() => setReopenOpen(false)}
            >
              Keep it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
