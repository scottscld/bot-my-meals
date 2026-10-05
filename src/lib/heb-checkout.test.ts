import { describe, expect, it } from "vitest";
import {
  formatDeliveryPreference,
  formatDeliveryWindow,
  formatOrderDollars,
  orderGuardCents,
  validateHebCheckoutPatch,
} from "@/lib/heb-checkout";

describe("H-E-B checkout helpers", () => {
  it("uses the weekly budget when the max is empty", () => {
    expect(orderGuardCents({ orderMaxCents: null, weeklyBudgetCents: 30000 })).toBe(30000);
    expect(orderGuardCents({ orderMaxCents: 25000, weeklyBudgetCents: 30000 })).toBe(25000);
    expect(orderGuardCents({ orderMaxCents: null, weeklyBudgetCents: null })).toBeNull();
  });

  it("rejects a window, day, or max outside the house rules", () => {
    expect(validateHebCheckoutPatch({ deliveryWindowStart: "16:00", deliveryWindowEnd: "16:00" })).toMatch(/after/i);
    expect(validateHebCheckoutPatch({ deliveryWindowStart: "16:00", deliveryWindowEnd: null })).toMatch(/both/i);
    expect(validateHebCheckoutPatch({ deliveryDays: [7] })).toMatch(/Sunday/i);
    expect(validateHebCheckoutPatch({ orderMaxCents: 50 })).toMatch(/\$1/);
    expect(validateHebCheckoutPatch({ orderMaxCents: 500001 })).toMatch(/\$5,000/);
    expect(
      validateHebCheckoutPatch({
        hebCheckoutMode: "auto",
        listApproverRole: "voter",
        deliveryDays: [2, 4],
        deliveryWindowStart: "16:00",
        deliveryWindowEnd: "19:00",
        orderMaxCents: 30000,
      }),
    ).toBeNull();
  });

  it("formats a delivery preference and a Chicago window", () => {
    expect(
      formatDeliveryPreference({
        deliveryDays: [2, 4],
        deliveryWindowStart: "16:00",
        deliveryWindowEnd: "19:00",
      }),
    ).toBe("Tue or Thu, 4–7 PM");
    expect(
      formatDeliveryPreference({
        deliveryDays: [1, 3, 5],
        deliveryWindowStart: null,
        deliveryWindowEnd: null,
      }),
    ).toBe("Mon, Wed, or Fri");
    expect(
      formatDeliveryPreference({ deliveryDays: null, deliveryWindowStart: null, deliveryWindowEnd: null }),
    ).toBe("Any day, any time");
    expect(
      formatDeliveryWindow("2026-10-06T21:00:00.000Z", "2026-10-06T23:00:00.000Z", "America/Chicago"),
    ).toBe("Tue Oct 6, 4–6 PM");
    expect(formatOrderDollars(30000)).toBe("$300");
    expect(formatOrderDollars(31250)).toBe("$312.50");
  });
});