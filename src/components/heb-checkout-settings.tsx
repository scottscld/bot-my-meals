"use client";

import { useState } from "react";
import { HouseCard } from "@/components/house-card";
import { useSupper } from "@/components/supper-provider";
import { WeeklyBudgetField } from "@/components/weekly-budget-field";
import { Label } from "@/components/ui/label";
import {
  formatDeliveryPreference,
  formatOrderDollars,
  validateHebCheckoutPatch,
} from "@/lib/heb-checkout";
import { formatWeeklyBudgetDollars } from "@/lib/house-setup";
import type { Household, HouseholdSettingsPatch, Store } from "@/lib/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const HOURS = Array.from({ length: 17 }, (_, index) => index + 6);

function hourValue(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function hourLabel(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12} ${suffix}`;
}

function maxPlaceholder(cents: number | null): string {
  if (cents == null || cents === 30000) return "$300 (weekly budget)";
  const dollars = formatWeeklyBudgetDollars(cents);
  return dollars ? `$${dollars} (weekly budget)` : "$300 (weekly budget)";
}

function parseMaxDollars(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed.replace(/[$,]/g, ""));
  if (!Number.isFinite(amount)) return Number.NaN;
  return Math.round(amount * 100);
}

function hasHebStore(stores: readonly Store[]): boolean {
  return stores.some((store) => store.slug === "h-e-b");
}

export function HebCheckoutSettings({
  household,
  stores,
  canEdit,
}: {
  household: Household;
  stores: readonly Store[];
  canEdit: boolean;
}) {
  const { updateHousehold } = useSupper();
  const [error, setError] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [pendingEnd, setPendingEnd] = useState<string | null>(null);
  const [maxDraft, setMaxDraft] = useState<string | null>(null);
  if (!hasHebStore(stores)) return null;

  const save = (patch: HouseholdSettingsPatch) => {
    const message = validateHebCheckoutPatch(patch);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    void updateHousehold(patch).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not save H-E-B checkout.");
    });
  };

  const startValue = pendingStart ?? household.deliveryWindowStart ?? "";
  const endValue = pendingEnd ?? household.deliveryWindowEnd ?? "";
  const maxShown =
    maxDraft ?? (household.orderMaxCents != null ? formatWeeklyBudgetDollars(household.orderMaxCents) : "");

  const onWindow = (which: "start" | "end", value: string) => {
    if (!value) {
      setPendingStart(null);
      setPendingEnd(null);
      save({ deliveryWindowStart: null, deliveryWindowEnd: null });
      return;
    }
    const nextStart = which === "start" ? value : startValue;
    const nextEnd = which === "end" ? value : endValue;
    if (which === "start") setPendingStart(value);
    else setPendingEnd(value);
    if (!nextStart || !nextEnd) return;
    const message = validateHebCheckoutPatch({
      deliveryWindowStart: nextStart,
      deliveryWindowEnd: nextEnd,
    });
    if (message) {
      setError(message);
      return;
    }
    setPendingStart(null);
    setPendingEnd(null);
    save({ deliveryWindowStart: nextStart, deliveryWindowEnd: nextEnd });
  };

  const toggleDay = (day: number) => {
    const current = household.deliveryDays ?? [];
    const next = current.includes(day)
      ? current.filter((item) => item !== day)
      : [...current, day].sort((a, b) => a - b);
    save({ deliveryDays: next.length ? next : null });
  };

  const saveMax = () => {
    const cents = parseMaxDollars(maxShown);
    if (Number.isNaN(cents)) {
      setError("Max order total must be between $1 and $5,000.");
      return;
    }
    const message = validateHebCheckoutPatch({ orderMaxCents: cents });
    if (message) {
      setError(message);
      return;
    }
    setMaxDraft(null);
    save({ orderMaxCents: cents });
  };

  return (
    <HouseCard className="mt-6" data-slot="heb-checkout">
      <h2 className="type-section text-primary">H-E-B checkout</h2>
      {canEdit ? (
        <div className="mt-3 space-y-4">
          <fieldset className="space-y-2">
            <legend className="type-meta text-muted-foreground">Checkout</legend>
            <label className="flex min-h-12 items-center gap-3">
              <input
                type="radio"
                name="heb-checkout-mode"
                checked={household.hebCheckoutMode === "review"}
                onChange={() => save({ hebCheckoutMode: "review" })}
              />
              <span className="type-body">I&apos;ll review and check out</span>
            </label>
            <label className="flex min-h-12 items-center gap-3">
              <input
                type="radio"
                name="heb-checkout-mode"
                checked={household.hebCheckoutMode === "auto"}
                onChange={() => save({ hebCheckoutMode: "auto" })}
              />
              <span className="type-body">Fully automatic</span>
            </label>
            {household.hebCheckoutMode === "auto" ? (
              <p className="type-meta text-muted-foreground">
                Your bot places the order when the total is under your limit.
              </p>
            ) : null}
          </fieldset>
          <div>
            <p className="type-meta text-muted-foreground">Delivery days</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAYS.map((label, day) => {
                const on = (household.deliveryDays ?? []).includes(day);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    className={`type-meta min-h-12 min-w-12 rounded-full px-3 ${on ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}
                    onClick={() => toggleDay(day)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="type-meta mt-1 text-muted-foreground">None means any day.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="heb-window-start">Delivery time</Label>
              <select
                id="heb-window-start"
                value={startValue}
                onChange={(event) => onWindow("start", event.target.value)}
                className="h-12 min-h-12 w-full rounded-[var(--radius-button)] border border-border bg-card px-3 text-base"
              >
                <option value="">Any time</option>
                {HOURS.map((hour) => (
                  <option key={hour} value={hourValue(hour)}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="heb-window-end">Until</Label>
              <select
                id="heb-window-end"
                value={endValue}
                onChange={(event) => onWindow("end", event.target.value)}
                className="h-12 min-h-12 w-full rounded-[var(--radius-button)] border border-border bg-card px-3 text-base"
              >
                <option value="">Any time</option>
                {HOURS.map((hour) => (
                  <option key={hour} value={hourValue(hour)}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="heb-order-max">Max order total</Label>
            <WeeklyBudgetField
              id="heb-order-max"
              value={maxShown}
              postalCode={household.postalCode}
              placeholder={maxPlaceholder(household.weeklyBudgetCents)}
              onChange={setMaxDraft}
              onBlur={saveMax}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="type-meta text-muted-foreground">Who can approve the list</legend>
            <label className="flex min-h-12 items-center gap-3">
              <input
                type="radio"
                name="heb-approver"
                checked={household.listApproverRole === "owner"}
                onChange={() => save({ listApproverRole: "owner" })}
              />
              <span className="type-body">Admins only</span>
            </label>
            <label className="flex min-h-12 items-center gap-3">
              <input
                type="radio"
                name="heb-approver"
                checked={household.listApproverRole === "voter"}
                onChange={() => save({ listApproverRole: "voter" })}
              />
              <span className="type-body">Admins and voters</span>
            </label>
          </fieldset>
          {error ? <p className="type-meta text-destructive">{error}</p> : null}
        </div>
      ) : (
        <div className="type-body mt-3 space-y-2 text-muted-foreground">
          <p>
            {household.hebCheckoutMode === "auto"
              ? "Fully automatic. Your bot places the order when the total is under your limit."
              : "I'll review and check out."}
          </p>
          <p>{formatDeliveryPreference(household)}</p>
          <p>
            {household.orderMaxCents != null
              ? `Max ${formatOrderDollars(household.orderMaxCents)}`
              : `Max ${maxPlaceholder(household.weeklyBudgetCents)}`}
          </p>
          <p>{household.listApproverRole === "voter" ? "Admins and voters can approve." : "Admins only can approve."}</p>
        </div>
      )}
    </HouseCard>
  );
}
