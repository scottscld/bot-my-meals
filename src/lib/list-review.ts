import { formatDeliveryWindow } from "@/lib/heb-checkout";
import type { ListStatus, Role, ShoppingItem } from "@/lib/types";

export const LIST_REVIEW_SECONDARY =
  "Remove what you already have. Add anything missing. Then approve.";

export const CART_CHIP_LABEL = {
  added: "Added",
  not_found: "Not found",
  substituted: "Swapped",
  skipped: "Skipped",
} as const;

const SHORT_LABEL: Record<ListStatus, string> = {
  review: "Review shopping list",
  approved: "H-E-B order starting",
  carting: "Adding to the H-E-B cart",
  awaiting_review: "Cart ready",
  ordered: "Ordered",
  failed: "Order didn't go through",
};

export function activeItems(items: readonly ShoppingItem[]): ShoppingItem[] {
  return items.filter((item) => item.removedAt == null);
}

export function removedItems(items: readonly ShoppingItem[]): ShoppingItem[] {
  return items.filter((item) => item.removedAt != null);
}

export function canEditList(status: ListStatus, role: Role | null | undefined): boolean {
  if (status !== "review") return false;
  return role === "owner" || role === "voter";
}

export function canApprove(
  role: Role | null | undefined,
  approverRole: "owner" | "voter",
): boolean {
  if (role === "owner") return true;
  return approverRole === "voter" && role === "voter";
}

export function canReopenList(status: ListStatus, role: Role | null | undefined): boolean {
  if (role !== "owner") return false;
  return status === "approved" || status === "awaiting_review" || status === "failed";
}

function approvedLead(name: string | null | undefined, time: string | null): string {
  if (name && time) return `Approved by ${name} · ${time}.`;
  if (name) return `Approved by ${name}.`;
  if (time) return `Approved · ${time}.`;
  return "Approved.";
}

function formatApprovedAt(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const window = formatDeliveryWindow(iso, null, timeZone);
  return window;
}

export function listStatusCopy(
  input: {
    status: ListStatus;
    approverName?: string | null;
    approvedAt?: string | null;
    timezone?: string;
    deliveryLabel?: string | null;
    windowStart?: string | null;
    windowEnd?: string | null;
    message?: string | null;
    checkoutMode?: "auto" | "review";
  },
  form: "long" | "short" = "long",
): string {
  if (form === "short") {
    if (input.status === "approved" && input.checkoutMode === "auto") return "Placing the H-E-B order";
    if (input.status === "ordered") {
      const when =
        input.deliveryLabel?.trim() ||
        formatDeliveryWindow(input.windowStart, input.windowEnd, input.timezone ?? "America/Chicago");
      return when ? `Ordered · ${when}` : SHORT_LABEL.ordered;
    }
    return SHORT_LABEL[input.status];
  }

  switch (input.status) {
    case "review":
      return LIST_REVIEW_SECONDARY;
    case "approved": {
      const time = formatApprovedAt(input.approvedAt, input.timezone ?? "America/Chicago");
      const lead = approvedLead(input.approverName, time);
      const next =
        input.checkoutMode === "auto"
          ? "Your bot places the order when the total is under your limit."
          : "Your bot is starting the H-E-B order.";
      return `${lead} ${next}`;
    }
    case "carting":
      return "Your bot is adding items to your H-E-B cart…";
    case "awaiting_review": {
      const base = "Your H-E-B cart is ready, review and check out on heb.com.";
      const message = input.message?.trim();
      return message ? `${base} ${message}` : base;
    }
    case "ordered": {
      const when =
        input.deliveryLabel?.trim() ||
        formatDeliveryWindow(input.windowStart, input.windowEnd, input.timezone ?? "America/Chicago");
      return when ? `Ordered · ${when}` : "Ordered";
    }
    case "failed": {
      const message = input.message?.trim();
      return message ? `The order didn't go through: ${message}` : "The order didn't go through.";
    }
    default: {
      const _exhaustive: never = input.status;
      return _exhaustive;
    }
  }
}

export function orderProblemItems(items: readonly ShoppingItem[]): {
  missing: ShoppingItem[];
  substituted: ShoppingItem[];
} {
  const active = activeItems(items);
  return {
    missing: active.filter((item) => item.cart?.status === "not_found"),
    substituted: active.filter((item) => item.cart?.status === "substituted"),
  };
}
