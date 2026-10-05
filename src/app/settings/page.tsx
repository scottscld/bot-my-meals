"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UnlockWeekControl } from "@/components/unlock-week-control";
import { ChevronRight } from "lucide-react";
import { AppearancePicker } from "@/components/appearance-picker";
import { BotWakeSettings } from "@/components/bot-wake-settings";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { HouseCard } from "@/components/house-card";
import { HebCheckoutSettings } from "@/components/heb-checkout-settings";
import { HouseStores } from "@/components/house-stores";
import { InstallPrompt } from "@/components/install-prompt";
import { NameField } from "@/components/name-field";
import { PushOptIn } from "@/components/push-opt-in";
import { InviteShare } from "@/components/invite-share";
import { ManagePeople } from "@/components/manage-people";
import { PeoplePerNight } from "@/components/people-per-night";
import { useSupper } from "@/components/supper-provider";
import { useViewedWeek } from "@/components/use-viewed-week";
import { WeeklyBudgetField } from "@/components/weekly-budget-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  formatWeeklyBudgetDollars,
  parseWeeklyBudgetDollars,
  shouldShowHouseSetup,
  weeklyBudgetCurrencyPrefix,
} from "@/lib/house-setup";
import { HOUSE_PEOPLE_DEFAULTS_NOTE } from "@/lib/edit-nights";
import { PAST_WEEKS_LABEL } from "@/lib/meal-history";
import { SAVED_MEALS_LABEL, SAVED_MEALS_ROW_SUB } from "@/lib/saved-meals";
import { isAdmin, roleLabel } from "@/lib/users";

export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsBody />
    </AuthGate>
  );
}

function SettingsBody() {
  const {
    snapshot,
    session,
    signOut,
    updateHousehold,
    addStore,
    removeStore,
    createJoinToken,
  } = useSupper();
  const router = useRouter();
  const owner = isAdmin(session?.role);
  const { scope } = useViewedWeek();
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const triedJoinToken = useRef(false);
  const budget =
    budgetDraft ?? formatWeeklyBudgetDollars(snapshot?.household.weeklyBudgetCents);

  useEffect(() => {
    if (triedJoinToken.current || !owner || !snapshot || snapshot.joinToken) return;
    triedJoinToken.current = true;
    void createJoinToken(false);
  }, [createJoinToken, owner, snapshot]);

  if (!snapshot) {
    return (
      <AppShell title="House">
        <p className="type-body text-muted-foreground">Create or join a household first.</p>
        <AppearancePicker />
      </AppShell>
    );
  }

  return (
    <AppShell title={snapshot.household.name} eyebrow="Household">
      <InstallPrompt />

      <HouseCard>
        <p className="type-eyebrow text-primary">Signed in as</p>
        <NameField />
        <p className="type-meta text-muted-foreground">
          {session?.email}
          {session?.role ? ` · ${roleLabel(session.role)}` : null}
        </p>
        <Button
          variant="outline"
          size="fat"
          className="mt-3 w-full"
          disabled={signingOut}
          aria-busy={signingOut}
          onClick={() => {
            setSigningOut(true);
            void signOut()
              .then(() => router.push("/login"))
              .catch(() => setSigningOut(false));
          }}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </HouseCard>

      <PushOptIn />

      <AppearancePicker />

      <div className="mt-6 space-y-3">
        <Link
          href="/settings/saved"
          data-slot="saved-meals-row"
          className="flex min-h-12 items-center justify-between gap-3 rounded-[14px] bg-card px-5 py-3 shadow-card"
        >
          <span>
            <span className="type-section block text-primary">{SAVED_MEALS_LABEL}</span>
            <span className="type-meta text-muted-foreground">{SAVED_MEALS_ROW_SUB}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
        <Link
          href="/settings/history"
          data-slot="past-weeks-row"
          className="flex min-h-12 items-center justify-between rounded-[14px] bg-card px-5 shadow-card"
        >
          <span className="type-section text-primary">{PAST_WEEKS_LABEL}</span>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
        </Link>
      </div>

      {shouldShowHouseSetup(session?.role, snapshot.household.setupStep) ? (
        <HouseCard className="mt-6">
          <h2 className="type-section text-primary">Finish setup</h2>
          <p className="type-meta mt-1 text-muted-foreground">
            Invite, household size, nights, stores, budget, then create meals. Your place is saved.
          </p>
          <Button asChild size="fat" variant="primary" className="mt-3 w-full">
            <Link href="/week?setup=1">Finish house setup</Link>
          </Button>
        </HouseCard>
      ) : null}

      <HouseCard className="mt-6">
        <h2 className="type-section text-primary">Invite</h2>
        <p className="type-meta mt-1 text-muted-foreground">
          Share the link. They open it on their phone and join this house — Bot My Meals does not
          email anyone from here.
        </p>
        {owner ? (
          <InviteShare
            token={snapshot.joinToken ?? null}
            onRotate={() => createJoinToken(true).then(() => undefined)}
          />
        ) : (
          <p className="type-meta mt-3 text-muted-foreground">Ask an Admin to share the invite link.</p>
        )}
      </HouseCard>

      <ManagePeople />

      <PeoplePerNight
        household={snapshot.household}
        canEdit={owner}
        note={HOUSE_PEOPLE_DEFAULTS_NOTE}
        onChange={(patch) => void updateHousehold(patch)}
      />

      <HouseStores
        stores={snapshot.stores}
        canEdit={owner}
        postalCode={snapshot.household.postalCode}
        onPostalCode={(code) => void updateHousehold({ postalCode: code || null })}
        onAdd={(slug, name) => void addStore(slug, name)}
        onRemove={(id) => void removeStore(id)}
      />

      <HebCheckoutSettings household={snapshot.household} stores={snapshot.stores} canEdit={owner} />

      <HouseCard className="mt-6">
        <h2 className="type-section text-primary">Weekly meal budget</h2>
        <p className="type-meta mt-1 text-muted-foreground">
          A target for dinners this week. We never invent grocery prices.
        </p>
        {owner ? (
          <form
            className="mt-3 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setBudgetError(null);
              let weeklyBudgetCents: number | null;
              try {
                weeklyBudgetCents = parseWeeklyBudgetDollars(budget);
              } catch (err) {
                setBudgetError(err instanceof Error ? err.message : "Could not save that budget.");
                return;
              }
              setBudgetBusy(true);
              void updateHousehold({ weeklyBudgetCents })
                .then(() => setBudgetDraft(null))
                .catch((err: unknown) => {
                  setBudgetError(err instanceof Error ? err.message : "Could not save that budget.");
                })
                .finally(() => setBudgetBusy(false));
            }}
          >
            <Label htmlFor="house-weekly-budget">Weekly meal budget</Label>
            <WeeklyBudgetField
              id="house-weekly-budget"
              value={budget}
              postalCode={snapshot.household.postalCode}
              onChange={setBudgetDraft}
            />
            <Button size="fat" className="w-full" disabled={budgetBusy} aria-busy={budgetBusy}>
              {budgetBusy ? "Saving…" : "Save budget"}
            </Button>
            {budgetError ? <p className="type-meta text-destructive">{budgetError}</p> : null}
          </form>
        ) : (
          <p className="type-body mt-3">
            {snapshot.household.weeklyBudgetCents == null
              ? "No weekly target set."
              : `${weeklyBudgetCurrencyPrefix(snapshot.household.postalCode)}${formatWeeklyBudgetDollars(
                  snapshot.household.weeklyBudgetCents,
                )}`}
          </p>
        )}
      </HouseCard>

      <BotWakeSettings canEdit={owner} />

      {owner && scope?.week.status === "locked" ? (
        <section className="mt-6">
          <UnlockWeekControl variant="block" />
        </section>
      ) : null}

      <p className="type-meta mt-8 text-center text-muted-foreground">
        Household-scoped by design. Other families cannot see this table.
      </p>
    </AppShell>
  );
}
