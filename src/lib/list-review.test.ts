import { describe, expect, it } from "vitest";
import {
  activeItems,
  canApprove,
  canEditList,
  listStatusCopy,
  orderProblemItems,
  removedItems,
} from "@/lib/list-review";
import { LIST_STATUSES, type ListStatus, type Role, type ShoppingItem } from "@/lib/types";

function item(partial: Partial<ShoppingItem> & Pick<ShoppingItem, "id" | "name">): ShoppingItem {
  return {
    householdId: "h",
    shoppingListId: "l",
    storeId: "heb",
    quantity: 1,
    unit: "ea",
    priceCents: null,
    priceSource: null,
    pricedAt: null,
    checked: false,
    source: "recipe",
    note: null,
    addedBy: null,
    removedAt: null,
    removedBy: null,
    cart: null,
    ...partial,
  };
}

const roles: Array<Role | null> = ["owner", "voter", "eater", null];

describe("list review helpers", () => {
  it("splits active and removed items", () => {
    const rows = [
      item({ id: "a", name: "Milk" }),
      item({ id: "b", name: "Spinach", removedAt: "2026-10-06T00:00:00.000Z" }),
    ];
    expect(activeItems(rows).map((row) => row.id)).toEqual(["a"]);
    expect(removedItems(rows).map((row) => row.id)).toEqual(["b"]);
  });

  it("lets only owners and voters edit a list in review", () => {
    for (const status of LIST_STATUSES) {
      for (const role of roles) {
        const allowed = status === "review" && (role === "owner" || role === "voter");
        expect(canEditList(status, role)).toBe(allowed);
      }
    }
  });

  it("lets an owner approve, and a voter only when the house says so", () => {
    expect(canApprove("owner", "owner")).toBe(true);
    expect(canApprove("owner", "voter")).toBe(true);
    expect(canApprove("voter", "voter")).toBe(true);
    expect(canApprove("voter", "owner")).toBe(false);
    expect(canApprove("eater", "voter")).toBe(false);
    expect(canApprove(null, "owner")).toBe(false);
  });

  it("writes long and short copy for every status and checkout mode", () => {
    const zone = "America/Chicago";
    const approvedAt = "2026-10-06T21:00:00.000Z";
    expect(listStatusCopy({ status: "review" })).toBe(
      "Remove what you already have. Add anything missing. Then approve.",
    );
    expect(listStatusCopy({ status: "review" }, "short")).toBe("Review shopping list");
    expect(
      listStatusCopy(
        { status: "approved", approverName: "Ada", approvedAt, timezone: zone, checkoutMode: "review" },
        "long",
      ),
    ).toBe("Approved by Ada · Tue Oct 6, 4 PM. Your bot is starting the H-E-B order.");
    expect(listStatusCopy({ status: "approved", checkoutMode: "review" }, "short")).toBe("H-E-B order starting");
    expect(
      listStatusCopy({ status: "approved", approverName: "Ada", checkoutMode: "auto" }, "long"),
    ).toBe("Approved by Ada. Your bot places the order when the total is under your limit.");
    expect(listStatusCopy({ status: "approved", checkoutMode: "auto" }, "short")).toBe("Placing the H-E-B order");
    expect(listStatusCopy({ status: "approved", approvedAt, timezone: zone })).toContain("Approved · Tue Oct 6, 4 PM.");
    expect(listStatusCopy({ status: "approved" })).toContain("Approved.");
    expect(listStatusCopy({ status: "carting" })).toBe("Your bot is adding items to your H-E-B cart…");
    expect(listStatusCopy({ status: "carting" }, "short")).toBe("Adding to the H-E-B cart");
    expect(listStatusCopy({ status: "awaiting_review", message: "Total $312.50 is over your $300 limit." })).toBe(
      "Your H-E-B cart is ready, review and check out on heb.com. Total $312.50 is over your $300 limit.",
    );
    expect(listStatusCopy({ status: "awaiting_review" }, "short")).toBe("Cart ready");
    expect(
      listStatusCopy({
        status: "ordered",
        deliveryLabel: "Tue Oct 6, 4–6 PM",
        timezone: zone,
      }),
    ).toBe("Ordered · Tue Oct 6, 4–6 PM");
    expect(listStatusCopy({ status: "ordered" }, "short")).toBe("Ordered");
    expect(
      listStatusCopy(
        {
          status: "ordered",
          windowStart: "2026-10-06T21:00:00.000Z",
          windowEnd: "2026-10-06T23:00:00.000Z",
          timezone: zone,
        },
        "short",
      ),
    ).toBe("Ordered · Tue Oct 6, 4–6 PM");
    expect(listStatusCopy({ status: "failed", message: "H-E-B asked me to sign in again." })).toBe(
      "The order didn't go through: H-E-B asked me to sign in again.",
    );
    expect(listStatusCopy({ status: "failed" })).toBe("The order didn't go through.");
    expect(listStatusCopy({ status: "failed" }, "short")).toBe("Order didn't go through");
    const unseen: ListStatus | undefined = undefined;
    expect(unseen).toBeUndefined();
  });

  it("lists missing and substituted items and skips removed ones", () => {
    const rows = [
      item({
        id: "miss",
        name: "Cilantro",
        cart: { status: "not_found", product: null, quantity: null, priceCents: null, note: null },
      }),
      item({
        id: "swap",
        name: "Spinach",
        cart: {
          status: "substituted",
          product: "H-E-B Organic Baby Spinach 5 oz",
          quantity: 1,
          priceCents: 249,
          note: null,
        },
      }),
      item({
        id: "gone",
        name: "Old spinach",
        removedAt: "2026-10-06T00:00:00.000Z",
        cart: { status: "not_found", product: null, quantity: null, priceCents: null, note: null },
      }),
      item({
        id: "ok",
        name: "Milk",
        cart: { status: "added", product: "Milk", quantity: 1, priceCents: 300, note: null },
      }),
    ];
    const problems = orderProblemItems(rows);
    expect(problems.missing.map((row) => row.name)).toEqual(["Cilantro"]);
    expect(problems.substituted.map((row) => row.cart?.product)).toEqual(["H-E-B Organic Baby Spinach 5 oz"]);
  });
});
