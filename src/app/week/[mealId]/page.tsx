"use client";

import { use, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { BallotToast } from "@/components/ballot-toast";
import { RecipePendingNotice } from "@/components/post-lock-waiting";
import { RecipeBlock } from "@/components/recipe-view";
import { SaveMealControl } from "@/components/save-meal-button";
import { useSupper } from "@/components/supper-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EMPTY_DAY_TITLE } from "@/lib/ballot";
import { formatNightDate, weekdayLabelFromNight } from "@/lib/dates";
import { servingsLabel } from "@/lib/headcount";
import { REPLACEMENT_IDEAS } from "@/lib/ideas";
import { canActOnBallot, isNightOff, latestVoteForMeal, voteFor, votingMembers } from "@/lib/lock";
import { memberName } from "@/lib/names";
import { scopeForMeal, weekHomeTitle } from "@/lib/open-weeks";
import { nightShowsRecipePending } from "@/lib/post-lock-waiting";
import { SAVE_TOAST, UNSAVE_TOAST, mealRecipeKey, mealSaveAvailability, savedMealForKey } from "@/lib/saved-meals";
import { nightStaysLocked } from "@/lib/week-chrome";
import type { VoteChoice } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function MealPage({ params }: { params: Promise<{ mealId: string }> }) {
  const { mealId } = use(params);
  return (
    <AuthGate>
      <MealDetail mealId={mealId} />
    </AuthGate>
  );
}

function MealDetail({ mealId }: { mealId: string }) {
  const { snapshot, session, setVote, applyIdea, markLeftovers, proposeReplacement, toggleSavedMeal, setViewedRole } =
    useSupper();
  const [note, setNote] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customPitch, setCustomPitch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<string | undefined>();
  const located = snapshot ? scopeForMeal(snapshot, mealId) : null;
  const scope = located?.scope ?? null;
  const weekRole = located?.role ?? "cooking";
  const mealWeekRole = located?.role ?? null;
  useEffect(() => {
    if (mealWeekRole) setViewedRole(mealWeekRole);
  }, [mealWeekRole, setViewedRole]);
  const meal = scope?.meals.find((item) => item.id === mealId);
  const latest =
    meal && snapshot
      ? latestVoteForMeal(scope?.votes ?? [], meal.id, snapshot.memberships)
      : undefined;
  const weekLocked = scope?.week.status === "locked";
  const pastLocked =
    scope && meal
      ? nightStaysLocked({
          weekStatus: scope.week.status,
          nightDate: meal.nightDate,
          editableFrom: scope.week.editableFrom,
        }) && !weekLocked
      : false;
  const readOnly = weekLocked || pastLocked;

  if (!snapshot || !scope || !meal) {
    return (
      <AppShell title="Night" backHref="/week" backLabel={weekHomeTitle(weekRole)}>
        <p className="type-body text-muted-foreground">That night is not on this week.</p>
      </AppShell>
    );
  }

  const leftoverSources = scope.meals.filter(
    (item) => item.dayIndex < meal.dayIndex && !item.isLeftovers,
  );

  const weekday = weekdayLabelFromNight(meal.nightDate);
  const skipped = isNightOff(meal.id, scope.votes, snapshot.memberships);
  const recipe = scope.recipes.find((item) => item.mealId === meal.id);
  const pendingRecipe = nightShowsRecipePending({
    weekStatus: scope.week.status,
    meals: scope.meals,
    votes: scope.votes,
    memberships: snapshot.memberships,
    recipes: scope.recipes,
    shoppingList: scope.shoppingList,
    mealId: meal.id,
  });
  const voters = votingMembers(snapshot.memberships);
  const canAct = canActOnBallot(session?.role) && !readOnly;
  const saveAvailability = mealSaveAvailability({
    meal,
    votes: scope.votes,
    memberships: snapshot.memberships,
    recipes: scope.recipes,
  });
  const recipeKey = mealRecipeKey({ title: meal.title, recipeKey: recipe?.recipeKey });
  const saved = Boolean(savedMealForKey(snapshot.savedMeals, recipeKey));
  const saveControl = (
    <SaveMealControl
      availability={saveAvailability}
      saved={saved}
      canAct={canActOnBallot(session?.role)}
      onToggle={() => {
        void toggleSavedMeal(meal.id)
          .then((result) => {
            if (result === "saved") setToast(SAVE_TOAST);
            if (result === "removed") setToast(UNSAVE_TOAST);
          })
          .catch(() => undefined);
      }}
    />
  );

  const choose = (choice: VoteChoice) => {
    void setVote(meal.id, choice, note).catch(() => undefined);
  };

  const saveProposal = (key: string, run: () => Promise<void>) => {
    setSaving(key);
    void run()
      .catch(() => undefined)
      .finally(() => setSaving(null));
  };

  return (
    <AppShell
      title={skipped && readOnly ? EMPTY_DAY_TITLE : meal.title}
      eyebrow={`${weekday} · ${formatNightDate(meal.nightDate)}`}
      backHref="/week"
      backLabel={weekHomeTitle(weekRole)}
    >
      {weekLocked ? (
        skipped ? (
          <p className="type-body rounded-[14px] bg-secondary p-4 shadow-card">
            This night is off. It did not go on the shopping list.
          </p>
        ) : pendingRecipe ? (
          <>
            {saveControl}
            <div className="mt-4">
              <RecipePendingNotice weekRole={weekRole} />
            </div>
          </>
        ) : (
          <>
            {saveControl}
            <div className="mt-4">
              <RecipeBlock recipe={recipe} servings={meal.servings} />
            </div>
          </>
        )
      ) : (
        <>
          <div className="rounded-[14px] bg-card p-5 shadow-card">
            <p className="type-body text-muted-foreground">{meal.pitch}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="secondary">{servingsLabel(meal.servings)}</Badge>
              <Badge variant="outline">About {meal.prepMinutes} minutes</Badge>
              {meal.isLeftovers ? <Badge variant="outline">Leftovers</Badge> : null}
            </div>
          </div>

          <section className="mt-6">
            <h2 className="type-section">Votes</h2>
            <ul className="mt-3 space-y-2">
              {voters.map((member) => {
                const vote = voteFor(scope.votes, meal.id, member.id);
                const you = member.id === session?.membershipId;
                return (
                  <li key={member.id} className="rounded-[14px] bg-secondary/70 px-4 py-3">
                    <p className="font-semibold">
                      {memberName(member)}
                      {you ? " (you)" : ""}
                    </p>
                    <p className="type-meta text-muted-foreground">
                      {vote
                        ? `${vote.choice}${vote.note ? ` — ${vote.note}` : ""}`
                        : "No action — dinner stands"}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>

          {canAct ? <section className="mt-6">
            <h2 className="type-section">Your call</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <VoteButton active={latest?.choice === "swap"} label="Swap" onClick={() => void choose("swap")} tone="swap" />
              <VoteButton active={latest?.choice === "remove"} label="Remove" onClick={() => void choose("remove")} tone="skip" />
            </div>
            <label className="mt-4 block text-sm font-semibold">Swap note</label>
            <Textarea
              value={note || latest?.note || ""}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Too heavy. Want tacos."
              className="mt-2 min-h-20 rounded-2xl text-base"
            />
            <p className="type-meta mt-2 text-muted-foreground">
              A swap keeps the week unlocked until this night is replaced. Optional note goes to the meal bot.
            </p>
          </section> : null}

          <section className="mt-8 space-y-4">
            {saveControl}
            <div className="rounded-[14px] border border-dashed border-border bg-card p-5 shadow-card">
              <h2 className="type-section">Recipe</h2>
              <p className="type-body mt-2 text-muted-foreground">
                Unlocks after the week locks. Full steps and ingredients show then.
                No invented recipes until that happens.
              </p>
            </div>
            {canAct ? <><h2 className="type-section">Replace this night</h2>
            <p className="type-body text-muted-foreground">
              Proposing a new meal clears this night. The new dinner stands until someone swaps or removes it.
            </p>
            <div className="space-y-2">
              {REPLACEMENT_IDEAS.map((idea) => (
                <button
                  key={idea.id}
                  type="button"
                  disabled={saving !== null}
                  aria-busy={saving === idea.id}
                  onClick={() => saveProposal(idea.id, () => applyIdea(meal.id, idea.id))}
                  className="tap-target flex w-full flex-col items-start rounded-[14px] border border-border bg-card px-4 py-3 text-left shadow-card disabled:opacity-50"
                >
                  <span className="font-semibold">{idea.title}</span>
                  <span className="type-meta text-muted-foreground">{idea.pitch}</span>
                </button>
              ))}
            </div>
            <div className="space-y-2 rounded-[14px] border border-dashed border-border p-4">
              <input
                value={customTitle}
                onChange={(event) => setCustomTitle(event.target.value)}
                placeholder="Or type a meal title"
                className="h-12 w-full rounded-[14px] border border-input bg-background px-3 text-base"
              />
              <input
                value={customPitch}
                onChange={(event) => setCustomPitch(event.target.value)}
                placeholder="One-line pitch"
                className="h-12 w-full rounded-[14px] border border-input bg-background px-3 text-base"
              />
              <Button
                variant="secondary"
                className="tap-target h-12 w-full rounded-[var(--radius-button)]"
                disabled={!customTitle.trim() || saving !== null}
                aria-busy={saving === "custom"}
                onClick={() =>
                  saveProposal("custom", () =>
                    proposeReplacement(meal.id, {
                      title: customTitle.trim(),
                      pitch: customPitch.trim() || "A new idea for this night.",
                      prepMinutes: 30,
                    }),
                  )
                }
              >
                {saving === "custom" ? "Saving…" : "Propose this meal"}
              </Button>
            </div>
            {leftoverSources.length ? (
              <div>
                <p className="text-sm font-semibold">Or label leftovers from</p>
                <div className="mt-2 flex flex-col gap-2">
                  {leftoverSources.map((source) => (
                    <Button
                      key={source.id}
                      variant="outline"
                      className="tap-target h-12 justify-start rounded-[var(--radius-button)]"
                      disabled={saving !== null}
                      aria-busy={saving === source.id}
                      onClick={() => saveProposal(source.id, () => markLeftovers(meal.id, source.id))}
                    >
                      {saving === source.id ? "Saving…" : `Leftover ${source.title}`}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            </> : null}
          </section>
        </>
      )}
      <BallotToast message={toast} onDismiss={() => setToast(undefined)} />
    </AppShell>
  );
}

function voteToneClass(tone: "swap" | "skip", active: boolean) {
  switch (tone) {
    case "swap":
      return active
        ? "border-transparent bg-[color:var(--swap)] text-[color:var(--swap-foreground)]"
        : "border-border bg-card text-foreground";
    case "skip":
      return active
        ? "border-transparent bg-foreground text-background"
        : "border-border bg-card text-foreground";
    default: {
      const _exhaustive: never = tone;
      return _exhaustive;
    }
  }
}

function VoteButton({
  active,
  label,
  onClick,
  tone,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  tone: "swap" | "skip";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label} this night`}
      className={cn(
        "tap-target inline-flex h-12 min-h-12 w-full items-center justify-center rounded-[var(--radius-button)] border px-2 text-sm font-semibold",
        voteToneClass(tone, active),
      )}
    >
      {label}
    </button>
  );
}
