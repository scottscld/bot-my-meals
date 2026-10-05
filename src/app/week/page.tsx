"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { BallotCard } from "@/components/ballot-card";
import { ChoiceBallot } from "@/components/choice-ballot";
import { ChoiceResults } from "@/components/choice-results";
import { WaitingBotCheck } from "@/components/bot-check-frequency";
import { BallotToast } from "@/components/ballot-toast";
import { EmptyDayCard } from "@/components/empty-day-card";
import { InstallPrompt } from "@/components/install-prompt";
import { NameNudge } from "@/components/name-nudge";
import { LockBar } from "@/components/lock-bar";
import { LockInBar } from "@/components/lock-in-bar";
import { EditNightsControl } from "@/components/edit-nights-control";
import { LockedNightFrame, MealsWaitingCard, PostLockWaitingCard, PostLockWaitingSheet } from "@/components/post-lock-waiting";
import { requestPendingRefresh, useBotWakeConfigured } from "@/components/use-bot-wake";
import { PastWeekDetail } from "@/components/past-weeks";
import { EditNightsSheet } from "@/components/edit-nights-sheet";
import { PlanningPeopleGate } from "@/components/planning-people-gate";
import { UnlockWeekControl } from "@/components/unlock-week-control";
import { WeekChrome } from "@/components/week-chrome";
import { Onboarding } from "@/components/onboarding";
import { SetupWizard } from "@/components/setup-wizard";
import { useSupper } from "@/components/supper-provider";
import { useViewedWeek } from "@/components/use-viewed-week";
import { isHouseSetupComplete, shouldShowHouseSetup } from "@/lib/house-setup";
import { isAdmin } from "@/lib/users";
import { Button } from "@/components/ui/button";
import {
  EMPTY_WEEK_WAITING_TITLE,
  awaitingMealSlot,
  emptyWeekPresentation,
  isMutedBallotNight,
  weekNightPresentation,
  type EmptyWeekAction,
  type WeekNightPresentation,
} from "@/lib/ballot";
import { botCheckForHousehold, botCheckForSnapshot } from "@/lib/bot-check";
import { choiceNights, isChoiceVoting } from "@/lib/choice-ballot";
import { FINISH_WAKE_BEFORE_CREATE } from "@/lib/bot-wake";
import { formatMealCardDayLabel, weekdayLabelFromNight } from "@/lib/dates";
import { PAST_WEEKS_LABEL, todayInTimeZone } from "@/lib/meal-history";
import {
  frozenWeekdays,
  prefillWeekHeadcounts,
  showEditNightsEntry,
} from "@/lib/edit-nights";
import {
  PLANNING_CREATE_ERROR,
  PLANNING_SWIPE_TOAST,
  planningPeopleGateOpen,
} from "@/lib/planning-people";
import {
  futureSwipeCreatesPlanning,
  navigatorEyebrow,
  navigatorHref,
  navigatorTitle,
  selectionFromStop,
  stepNavigator,
} from "@/lib/week-navigator";
import { isPendingBotFill, lockedDinnerTap, POST_LOCK_GET_RECIPES_NEXT_HINT, POST_LOCK_GET_RECIPES_NEXT_WAKE_HINT } from "@/lib/post-lock-waiting";
import { focusNightCard, nightCardAnchorId } from "@/lib/week-strip";
import { canActOnBallot, checkWeekLock, latestVoteForMeal, nightLifecycle } from "@/lib/lock";
import { recipeNightsForWeek } from "@/lib/recipes";
import {
  nightHasStripMeal,
  nightStaysLocked,
  showFirstMealRow,
  showOpenShoppingList,
  stripCellMuted,
  upcomingDinner,
} from "@/lib/week-chrome";
import type { Meal, NightLifecycle, VoteChoice } from "@/lib/types";

export default function WeekPage() {
  return (
    <AuthGate>
      <Suspense>
        <WeekBody />
      </Suspense>
    </AuthGate>
  );
}

function WeekBody() {
  const { snapshot, session } = useSupper();
  const searchParams = useSearchParams();
  const setupRequested = searchParams.get("setup") === "1";

  if (!snapshot) return <Onboarding />;
  if (setupRequested && shouldShowHouseSetup(session?.role, snapshot.household.setupStep)) {
    return <SetupWizard />;
  }
  return <WeekBallot />;
}

function WeekBallot() {
  const router = useRouter();
  const {
    session,
    snapshot,
    setVote,
    requestWeekBallot,
    planNextWeek,
    savePlanningPeople,
    saveWeekPeople,
    pickOption,
    requestNewOptions,
    cancelNewOptions,
    reopenVote,
  } = useSupper();
  const { role, scope, past, hasPlanning, stops, index, setViewedWeek } = useViewedWeek();
  const searchParams = useSearchParams();
  const [toast, setToast] = useState<string | undefined>();
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [editWeekId, setEditWeekId] = useState<string | null>(null);
  const creatingPlanning = useRef(false);
  const [selectedNightId, setSelectedNightId] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(undefined), []);
  const jumpToNight = useCallback((mealId: string) => {
    setSelectedNightId(mealId);
    focusNightCard(mealId, (id) => document.getElementById(id));
  }, []);
  const searchKey = searchParams.toString();
  const previousSearch = useRef<string | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    const pastQuery = searchParams.get("past");
    const weekQuery = searchParams.get("week");
    const previous = previousSearch.current;
    previousSearch.current = searchKey;
    if (pastQuery && snapshot.mealHistory.some((week) => week.startsOn === pastQuery)) {
      setViewedWeek({ kind: "past", startsOn: pastQuery });
      return;
    }
    if (weekQuery === "next" && snapshot.planning) {
      setViewedWeek({ kind: "planning" });
      return;
    }
    if (weekQuery === "this") {
      setViewedWeek({ kind: "cooking" });
      return;
    }
    if (previous && previous.length > 0) setViewedWeek({ kind: "cooking" });
  }, [searchKey, searchParams, snapshot, setViewedWeek]);

  const startPlanning = useCallback(
    (announce: boolean) => {
      if (creatingPlanning.current) return;
      creatingPlanning.current = true;
      setPlanning(true);
      void planNextWeek()
        .then(() => {
          if (announce) setToast(PLANNING_SWIPE_TOAST);
          setViewedWeek({ kind: "planning" });
          router.replace(navigatorHref({ kind: "planning" }), { scroll: false });
        })
        .catch(() => setToast(PLANNING_CREATE_ERROR))
        .finally(() => {
          creatingPlanning.current = false;
          setPlanning(false);
        });
    },
    [planNextWeek, router, setViewedWeek],
  );

  const editOpen = Boolean(scope && editWeekId === scope.week.id);

  const stepWeek = useCallback(
    (direction: -1 | 1) => {
      const result = stepNavigator(stops, index, direction);
      const canPlan =
        isAdmin(session?.role) && isHouseSetupComplete(snapshot?.household.setupStep ?? 0);
      if (
        futureSwipeCreatesPlanning({
          direction,
          moved: result.moved,
          kind: stops[index]?.kind,
          hasPlanning,
          canPlan,
        })
      ) {
        if (creatingPlanning.current) return true;
        startPlanning(true);
        return true;
      }
      if (!result.moved) return false;
      const selection = selectionFromStop(result.stop);
      setViewedWeek(selection);
      setSelectedNightId(null);
      router.replace(navigatorHref(selection), { scroll: false });
      return true;
    },
    [stops, index, setViewedWeek, router, hasPlanning, session?.role, snapshot?.household.setupStep, startPlanning],
  );

  if (!snapshot) return null;
  const viewingPast = Boolean(past);
  if (!viewingPast && !scope) return null;

  const locked = scope?.week.status === "locked";
  const todayIso = todayInTimeZone(new Date(), snapshot.household.timezone);
  const pendingFill =
    scope != null &&
    isPendingBotFill({
      weekStatus: scope.week.status,
      meals: scope.meals,
      votes: scope.votes,
      memberships: snapshot.memberships,
      recipes: scope.recipes,
      shoppingList: scope.shoppingList,
    });
  const shoppingListLabel =
    scope == null
      ? null
      : showOpenShoppingList({
          weekStatus: scope.week.status,
          pendingFill,
          listStatus: scope.shoppingList?.status ?? null,
          activeCount: scope.shoppingList?.items.filter((item) => item.removedAt == null).length ?? 0,
        });
  const botCheck = botCheckForHousehold(snapshot);
  const check = scope ? checkWeekLock(scope.meals, scope.votes, snapshot.memberships) : { ready: false };
  const nights = scope ? recipeNightsForWeek(scope.meals) : [];
  const choice = Boolean(scope && isChoiceVoting(scope.week));
  const choiceReady = Boolean(
    choice && scope && (scope.options.length > 0 || scope.optionRequests.length > 0),
  );
  const showChoiceResults = Boolean(
    scope && scope.week.ballotMode === "choice3" && scope.week.finalizedAt,
  );
  const activeChoiceNights =
    scope == null
      ? []
      : choiceNights({
          week: scope.week,
          household: snapshot.household,
          options: scope.options,
          optionRequests: scope.optionRequests,
        });
  const cardNights =
    choiceReady && scope
      ? nights.filter((meal) =>
          nightStaysLocked({
            weekStatus: scope.week.status,
            nightDate: meal.nightDate,
            editableFrom: scope.week.editableFrom,
          }),
        )
      : nights;
  const dinner = scope ? upcomingDinner(scope.meals, scope.votes, todayIso) : undefined;
  const firstMeal =
    scope && showFirstMealRow({ weekStatus: scope.week.status, pendingFill, meal: dinner }) && dinner
      ? {
          id: dinner.id,
          title: dinner.title,
          nightDate: dinner.nightDate,
        }
      : null;
  const stripNights = viewingPast
    ? (past?.nights ?? []).map((night) => ({
        id: night.nightDate,
        nightDate: night.nightDate,
        hasMeal: true,
      }))
    : choice
      ? [
          ...nights
            .filter((meal) =>
              nightStaysLocked({
                weekStatus: scope?.week.status ?? "voting",
                nightDate: meal.nightDate,
                editableFrom: scope?.week.editableFrom ?? null,
              }),
            )
            .map((meal) => ({
              id: meal.id,
              nightDate: meal.nightDate,
              hasMeal: nightHasStripMeal(meal, scope?.votes ?? [], snapshot.memberships),
            })),
          ...activeChoiceNights.map((night) => ({
            id: `night-${night.dayIndex}`,
            nightDate: night.nightDate,
            hasMeal: night.options.length > 0,
          })),
        ]
      : nights.map((meal) => ({
          id: meal.id,
          nightDate: meal.nightDate,
          hasMeal: nightHasStripMeal(meal, scope?.votes ?? [], snapshot.memberships),
        }));
  const mutedDates =
    scope == null
      ? []
      : stripNights
          .filter(
            (night) =>
              night.hasMeal &&
              stripCellMuted({
                weekStatus: scope.week.status,
                nightDate: night.nightDate,
                editableFrom: scope.week.editableFrom,
              }),
          )
          .map((night) => night.nightDate);
  const todayMealId =
    stripNights.find((night) => night.hasMeal && night.nightDate === todayIso)?.id ?? null;
  const activeStop = stops[index];
  const title = activeStop ? navigatorTitle(activeStop) : "This week";
  const eyebrow = activeStop ? navigatorEyebrow(activeStop) : null;
  const showPlan =
    !viewingPast &&
    role === "cooking" &&
    !hasPlanning &&
    isAdmin(session?.role) &&
    isHouseSetupComplete(snapshot.household.setupStep);
  const showPeopleGate =
    scope != null &&
    planningPeopleGateOpen({
      role,
      peopleConfirmedAt: scope.week.peopleConfirmedAt,
      mealCount: scope.meals.length,
    });
  const viewedWork =
    scope == null
      ? null
      : botCheckForSnapshot({
          household: snapshot.household,
          meals: scope.meals,
          votes: scope.votes,
          memberships: snapshot.memberships,
          ballotRequest: scope.ballotRequest,
          week: scope.week,
          recipes: scope.recipes,
          shoppingList: scope.shoppingList,
          options: scope.options,
          optionRequests: scope.optionRequests,
        });
  const showMealsWaiting =
    !viewingPast && !showPeopleGate && Boolean(viewedWork?.needs_work) && !pendingFill;
  const waitingCard = (
    <MealsWaitingCard
      weekRole={role}
      startsOn={scope?.week.startsOn ?? snapshot.week.startsOn}
      bothOpen={hasPlanning}
    />
  );

  const act = async (mealId: string, choice: VoteChoice, note?: string) => {
    try {
      const message = await setVote(mealId, choice, note);
      if (message) setToast(message);
    } catch {
      // The provider rolls the night back and shows the error.
    }
  };

  return (
    <AppShell
      title={title}
      eyebrow={eyebrow?.text}
      eyebrowMuted={eyebrow?.muted}
      titleAside={locked ? <UnlockWeekControl variant="inline" /> : undefined}
      titleAction={
        showEditNightsEntry({
          past: viewingPast,
          locked: Boolean(locked),
          canEdit: Boolean(session?.membershipId) && canActOnBallot(session?.role),
          peopleGate: showPeopleGate,
        }) ? (
          <EditNightsControl onEdit={() => setEditWeekId(scope?.week.id ?? null)} />
        ) : null
      }
      chrome={
        <WeekChrome
          startsOn={activeStop?.startsOn ?? snapshot.week.startsOn}
          nights={stripNights}
          selectedMealId={selectedNightId ?? (viewingPast ? null : todayMealId)}
          todayIso={todayIso}
          locked={Boolean(locked)}
          mutedDates={mutedDates}
          showShoppingList={shoppingListLabel != null}
          shoppingListLabel={shoppingListLabel ?? undefined}
          firstMeal={firstMeal}
          onSelect={jumpToNight}
          onStep={stepWeek}
          planNext={
            showPlan
              ? {
                  busy: planning,
                  onPlan: () => startPlanning(false),
                }
              : null
          }
        />
      }
      status={undefined}
      footer={
        choice && !showPeopleGate ? (
          <LockInBar />
        ) : !choice && !viewingPast && !locked && check.ready && !showPeopleGate ? (
          <LockBar />
        ) : undefined
      }
    >
      <InstallPrompt />
      <NameNudge />
      {viewingPast && past ? (
        <PastWeekDetail week={past} />
      ) : showPeopleGate && scope ? (
        <PlanningPeopleGate
          household={snapshot.household}
          canEdit={Boolean(session?.membershipId) && canActOnBallot(session?.role)}
          busy={planning}
          onSave={(counts, instructions) =>
            savePlanningPeople(counts, instructions).then(() => {
              requestPendingRefresh();
            })
          }
          onBack={() => {
            setViewedWeek({ kind: "cooking" });
            router.replace(navigatorHref({ kind: "cooking" }), { scroll: false });
          }}
        />
      ) : nights.length === 0 && !choiceReady ? (
        showMealsWaiting ? (
          <div data-slot="waiting-for-bot" data-state="pending">
            {waitingCard}
          </div>
        ) : (
          <EmptyWeek onCreateMeals={() => requestWeekBallot(scope?.week.startsOn)} />
        )
      ) : (
        <div className="space-y-3">
          {showMealsWaiting ? <div data-slot="meals-pending">{waitingCard}</div> : null}
          {pendingFill ? (
            <div data-slot="week-pending-fill" data-state="pending" className="mb-4">
              <PostLockWaitingCard
                weekRole={role}
                startsOn={scope?.week.startsOn ?? snapshot.week.startsOn}
                bothOpen={hasPlanning}
              />
            </div>
          ) : null}
          {!showMealsWaiting && !pendingFill ? (
            <WaitingBotCheck
              status={botCheck}
              pendingWorkOnly
              className="mb-1"
              checkNowHint={role === "planning" ? POST_LOCK_GET_RECIPES_NEXT_HINT : undefined}
              checkNowWakeHint={role === "planning" ? POST_LOCK_GET_RECIPES_NEXT_WAKE_HINT : undefined}
            />
          ) : null}
          {showChoiceResults && scope ? (
            <ChoiceResults
              week={scope.week}
              household={snapshot.household}
              options={scope.options}
              picks={scope.picks}
              optionRequests={scope.optionRequests}
              memberships={snapshot.memberships}
            />
          ) : null}
          {cardNights.map((meal) => {
            const dayLabel = formatMealCardDayLabel(meal.nightDate);
            const dayName = weekdayLabelFromNight(meal.nightDate);
            const latest = latestVoteForMeal(scope?.votes ?? [], meal.id, snapshot.memberships);
            const lifecycle = nightLifecycle(meal, scope?.votes ?? [], snapshot.memberships);
            const nightLocked = nightStaysLocked({
              weekStatus: scope?.week.status ?? "voting",
              nightDate: meal.nightDate,
              editableFrom: scope?.week.editableFrom ?? null,
            });
            const canVote =
              Boolean(session?.membershipId) && canActOnBallot(session?.role) && !nightLocked;
            const presentation = weekNightPresentation(lifecycle, nightLocked);
            const awaitingMeal = awaitingMealSlot(meal, scope?.votes ?? [], snapshot.memberships);

            return (
              <div
                key={meal.id}
                id={nightCardAnchorId(meal.id)}
                tabIndex={-1}
                data-slot="night-card-anchor"
                className="scroll-mt-[calc(var(--shell-head-h)+0.25rem)] rounded-[14px] outline-none focus:ring-2 focus:ring-primary/40"
              >
                {renderNightCard({
                  presentation,
                  dayLabel,
                  dayName,
                  meal,
                  latestNote: latest?.note,
                  awaitingMeal,
                  canVote,
                  locked: nightLocked,
                  pending: pendingFill,
                  lifecycle,
                  onAct: act,
                  onWaiting: () => setWaitingOpen(true),
                })}
              </div>
            );
          })}
          {choiceReady && scope ? (
            <ChoiceBallot
              nights={activeChoiceNights}
              picks={scope.picks}
              memberships={snapshot.memberships}
              submissions={scope.submissions}
              membershipId={session?.membershipId ?? null}
              canVote={Boolean(session?.membershipId) && canActOnBallot(session?.role)}
              admin={isAdmin(session?.role)}
              onPick={(optionId) => {
                void pickOption(optionId);
              }}
              onRequest={(dayIndex, note) => requestNewOptions(dayIndex, note)}
              onCancelRequest={(requestId) => cancelNewOptions(requestId)}
              onReopen={(memberId) => reopenVote(memberId)}
            />
          ) : null}
        </div>
      )}
      {snapshot.mealHistory.length > 0 ? (
        <p className="mt-6 text-center">
          <Link
            href="/settings/history"
            data-slot="past-weeks-link"
            className="type-meta text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4"
          >
            {PAST_WEEKS_LABEL}
          </Link>
        </p>
      ) : null}
      {scope && !viewingPast ? (
        <EditNightsSheet
          key={scope.week.id}
          open={editOpen}
          role={role}
          household={snapshot.household}
          initialCounts={prefillWeekHeadcounts({
            saved: scope.week.nightHeadcounts,
            household: snapshot.household.nightHeadcounts,
            meals: scope.meals,
          })}
          storedInstructions={scope.week.specialInstructions}
          meals={scope.meals}
          votes={scope.votes}
          memberships={snapshot.memberships}
          ballotMode={scope.week.ballotMode}
          frozenWeekdays={frozenWeekdays({
            startsOn: scope.week.startsOn,
            status: scope.week.status,
            editableFrom: scope.week.editableFrom,
          })}
          onOpenChange={(open) => {
            if (!open) setEditWeekId(null);
          }}
          onSave={(counts, instructions) => saveWeekPeople(scope.week.id, counts, instructions)}
          onSaved={() => {
            requestPendingRefresh();
          }}
        />
      ) : null}
      <BallotToast message={toast} onDismiss={dismissToast} />
      <PostLockWaitingSheet
        open={waitingOpen}
        onOpenChange={setWaitingOpen}
        weekRole={role}
        startsOn={scope?.week.startsOn ?? past?.startsOn ?? snapshot.week.startsOn}
        bothOpen={hasPlanning}
      />
    </AppShell>
  );
}

function renderNightCard({
  presentation,
  dayLabel,
  dayName,
  meal,
  latestNote,
  awaitingMeal,
  canVote,
  locked,
  pending,
  lifecycle,
  onAct,
  onWaiting,
}: {
  presentation: WeekNightPresentation;
  dayLabel: string;
  dayName: string;
  meal: Meal;
  latestNote?: string;
  awaitingMeal: boolean;
  canVote: boolean;
  locked: boolean;
  pending: boolean;
  lifecycle: NightLifecycle;
  onAct: (mealId: string, choice: VoteChoice, note?: string) => void;
  onWaiting: () => void;
}): ReactNode {
  switch (presentation) {
    case "empty":
      return (
        <EmptyDayCard
          dayLabel={dayLabel}
          dayName={dayName}
          state={awaitingMeal ? "awaiting" : "empty"}
          onAdd={
            awaitingMeal || !canVote
              ? undefined
              : (note) => onAct(meal.id, "request_new_meal", note)
          }
        />
      );
    case "pending_add":
      return (
        <EmptyDayCard
          dayLabel={dayLabel}
          dayName={dayName}
          state="pending"
          note={latestNote}
          onCancel={canVote ? () => onAct(meal.id, "remove") : undefined}
        />
      );
    case "locked_empty":
      return <EmptyDayCard dayLabel={dayLabel} dayName={dayName} state="locked" />;
    case "ballot":
      return (
        <LockedNightFrame
          tap={lockedDinnerTap({ locked, pending, presentation })}
          href={`/week/${meal.id}`}
          title={meal.title}
          onWaiting={onWaiting}
        >
          <BallotCard
            dayLabel={dayLabel}
            confirmDayLabel={dayName}
            title={meal.title}
            pitch={meal.pitch}
            servings={meal.servings}
            swapped={lifecycle === "swapped"}
            swapNote={latestNote}
            muted={isMutedBallotNight({
              isLeftovers: meal.isLeftovers,
              isNightOff: false,
            })}
            locked={locked}
            onSwap={canVote ? (reason) => onAct(meal.id, "swap", reason) : undefined}
            onRemove={canVote ? () => onAct(meal.id, "remove") : undefined}
          />
        </LockedNightFrame>
      );
    default: {
      const _exhaustive: never = presentation;
      return _exhaustive;
    }
  }
}

function emptyWeekCta(
  action: EmptyWeekAction,
  cta: string,
  creating: boolean,
  wakeConfigured: boolean | null,
  onCreate: () => Promise<void>,
) {
  const wakeReady = wakeConfigured === true;
  switch (action) {
    case "finish-setup":
      return (
        <Button asChild size="fat" variant="primary" className="mt-4 w-full">
          <Link href="/week?setup=1">{cta}</Link>
        </Button>
      );
    case "create-meals":
      return (
        <>
          <Button
            type="button"
            size="fat"
            variant="primary"
            className="mt-4 w-full"
            disabled={creating || !wakeReady}
            aria-label={creating ? "Saving" : cta}
            aria-busy={creating}
            onClick={() => void onCreate()}
          >
            {creating ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
            {creating ? "Saving…" : cta}
          </Button>
          {wakeConfigured === false ? (
            <p data-slot="finish-wake-first" className="type-meta mt-3 text-muted-foreground">
              {FINISH_WAKE_BEFORE_CREATE}{" "}
              <Link href="/settings#wake-your-bot" className="font-semibold text-primary">
                Wake your Bot
              </Link>
            </p>
          ) : null}
        </>
      );
    case "waiting":
      return (
        <p data-slot="waiting-for-bot" className="type-meta mt-4 text-primary">
          {EMPTY_WEEK_WAITING_TITLE}
        </p>
      );
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function EmptyWeek({ onCreateMeals }: { onCreateMeals: () => Promise<string> }) {
  const { session, snapshot } = useSupper();
  const { scope, role } = useViewedWeek();
  const wakeConfigured = useBotWakeConfigured();
  const [creating, setCreating] = useState(false);
  const setupIncomplete = !isHouseSetupComplete(snapshot?.household.setupStep ?? 8);
  const botCheck = snapshot ? botCheckForHousehold(snapshot) : null;
  const copy = emptyWeekPresentation({
    setupIncomplete,
    ballotStatus: scope?.ballotRequest?.status ?? null,
    canCreate: isAdmin(session?.role),
  });

  return (
    <div
      data-slot="empty-week"
      className="rounded-[14px] border border-dashed border-border bg-card p-6 text-center shadow-card"
    >
      <h2 className="type-section">{copy.title}</h2>
      <p className="type-body mt-2 text-muted-foreground">{copy.helper}</p>
      {emptyWeekCta(copy.action, copy.cta, creating, wakeConfigured, async () => {
        setCreating(true);
        try {
          await onCreateMeals();
        } finally {
          setCreating(false);
        }
      })}
      {copy.action === "waiting" && botCheck ? (
        <WaitingBotCheck
          status={botCheck}
          checkNowWhenIdle
          className="mt-4"
          checkNowHint={role === "planning" ? POST_LOCK_GET_RECIPES_NEXT_HINT : undefined}
          checkNowWakeHint={role === "planning" ? POST_LOCK_GET_RECIPES_NEXT_WAKE_HINT : undefined}
        />
      ) : null}
    </div>
  );
}
