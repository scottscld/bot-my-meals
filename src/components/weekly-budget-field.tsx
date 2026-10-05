"use client";

import { Input } from "@/components/ui/input";
import { weeklyBudgetCurrencyPrefix } from "@/lib/house-setup";
import { cn } from "@/lib/utils";

export function WeeklyBudgetField({
  id,
  value,
  onChange,
  postalCode,
  describedBy,
  className,
  placeholder,
  onBlur,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  postalCode: string | null | undefined;
  describedBy?: string;
  className?: string;
  placeholder?: string;
  onBlur?: () => void;
}) {
  const prefix = weeklyBudgetCurrencyPrefix(postalCode);
  const currencyId = `${id}-currency`;
  const describedByIds = [describedBy, prefix ? currencyId : undefined].filter(Boolean).join(" ");

  return (
    <div className="relative" data-slot="weekly-budget-field">
      {prefix ? (
        <>
          <span
            data-slot="weekly-budget-prefix"
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-foreground"
          >
            {prefix}
          </span>
          <span id={currencyId} className="sr-only">
            US dollars
          </span>
        </>
      ) : null}
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-12 min-h-12 rounded-[var(--radius-button)] bg-card text-base",
          prefix ? "pl-7" : null,
          className,
        )}
        aria-describedby={describedByIds || undefined}
        autoComplete="off"
        placeholder={placeholder}
        onBlur={onBlur}
      />
    </div>
  );
}
