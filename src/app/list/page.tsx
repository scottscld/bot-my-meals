"use client";

import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { BallotToast } from "@/components/ballot-toast";
import { ListAddItemSheet } from "@/components/list-add-item-sheet";
import { ListApproveBar } from "@/components/list-approve-bar";
import { ListProblemSections } from "@/components/list-problem-sections";
import { ListRemovedSection } from "@/components/list-removed-section";
import { ListRow } from "@/components/list-row";
import { LockFirstEmpty } from "@/components/lock-first-empty";
import { OrderStatusCard } from "@/components/order-status-card";
import { PostLockWaitingCard } from "@/components/post-lock-waiting";
import { StatusStrip } from "@/components/status-strip";
import { useSupper } from "@/components/supper-provider";
import { useViewedWeek } from "@/components/use-viewed-week";
import { formatWeekEyebrow } from "@/lib/dates";
import { PAST_TITLES_ONLY } from "@/lib/week-navigator";
import { shoppingListTitle, weekHomeTitle } from "@/lib/open-weeks";
import { isNightOff } from "@/lib/lock";
import {
  LIST_NOTHING_TO_BUY,
  LIST_NO_HOUSEHOLD,
  LIST_PRE_LOCK_DESCRIPTION,
  LOCK_FIRST_TITLE,
} from "@/lib/lock-success";
import { memberName } from "@/lib/names";
import {
  activeItems,
  canApprove,
  canEditList,
  listStatusCopy,
  orderProblemItems,
  removedItems,
} from "@/lib/list-review";
import { isPendingBotFill } from "@/lib/post-lock-waiting";
import { recipeNightsForWeek } from "@/lib/recipes";
import { groupStickyStoreLists } from "@/lib/shopping";
import type { ManualItemDraft, ShoppingItem } from "@/lib/types";

type ListToast = {
  message: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
};

export default function ListPage() {
  return (
    <AuthGate>
      <ListBody />
    </AuthGate>
  );
}

function ListBody() {
  const { snapshot, session, removeItem, restoreItem, addItem } = useSupper();
  const { role, scope, past } = useViewedWeek();
  const [toast, setToast] = useState<ListToast | null>(null);
  if (!snapshot) {
    return (
      <AppShell title="Shopping list">
        <p className="type-body text-muted-foreground">{LIST_NO_HOUSEHOLD}</p>
      </AppShell>
    );
  }

  if (past) {
    return (
      <AppShell
        title="Shopping list"
        eyebrow={formatWeekEyebrow(past.startsOn)}
        backHref="/week"
        backLabel={formatWeekEyebrow(past.startsOn)}
      >
        <p data-slot="past-week-list" className="type-body text-muted-foreground">
          {PAST_TITLES_ONLY}
        </p>
      </AppShell>
    );
  }

  if (!scope) {
    return (
      <AppShell title="Shopping list">
        <p className="type-body text-muted-foreground">{LIST_NO_HOUSEHOLD}</p>
      </AppShell>
    );
  }

  const locked = scope.week.status === "locked";
  const listTitle = shoppingListTitle(role);
  const backLabel = weekHomeTitle(role);
  const pendingFill = isPendingBotFill({
    weekStatus: scope.week.status,
    meals: scope.meals,
    votes: scope.votes,
    memberships: snapshot.memberships,
    recipes: scope.recipes,
    shoppingList: scope.shoppingList,
  });
  const nights = recipeNightsForWeek(scope.meals);
  const removedMealIds = new Set(
    nights.filter((meal) => isNightOff(meal.id, scope.votes)).map((meal) => meal.id),
  );

  if (!locked) {
    return (
      <AppShell title={listTitle} eyebrow={formatWeekEyebrow(scope.week.startsOn)} backHref="/week" backLabel={backLabel}>
        <LockFirstEmpty
          title={LOCK_FIRST_TITLE}
          description={LIST_PRE_LOCK_DESCRIPTION}
          meals={nights}
          removedMealIds={removedMealIds}
        />
      </AppShell>
    );
  }

  const list = scope.shoppingList;
  if (pendingFill && (!list || list.items.length === 0)) {
    return (
      <AppShell title={listTitle} eyebrow={formatWeekEyebrow(scope.week.startsOn, true)} backHref="/week" backLabel={backLabel}>
        <PostLockWaitingCard weekRole={role} startsOn={scope.week.startsOn} />
      </AppShell>
    );
  }

  if (!list || list.items.length === 0) {
    return (
      <AppShell title={listTitle} eyebrow={formatWeekEyebrow(scope.week.startsOn, true)} backHref="/week" backLabel={backLabel}>
        <div className="rounded-[14px] border border-dashed border-border bg-card p-5 shadow-card">
          <h2 className="type-section">Nothing to buy</h2>
          <p className="type-body mt-2 text-muted-foreground">{LIST_NOTHING_TO_BUY}</p>
        </div>
      </AppShell>
    );
  }

  const editing = canEditList(list.status, session?.role);
  const approving = canApprove(session?.role, snapshot.household.listApproverRole);
  const active = activeItems(list.items);
  const gone = removedItems(list.items);
  const problems = orderProblemItems(list.items);
  const groups = groupStickyStoreLists(active, snapshot.stores);
  const approver = snapshot.memberships.find((member) => member.id === list.approvedBy);
  const secondary = listStatusCopy({
    status: list.status,
    approverName: approver ? memberName(approver) : null,
    approvedAt: list.approvedAt,
    timezone: snapshot.household.timezone,
    deliveryLabel: list.order.label,
    windowStart: list.order.windowStart,
    windowEnd: list.order.windowEnd,
    message: list.order.message,
    checkoutMode: snapshot.household.hebCheckoutMode,
  });
  const reviewing = list.status === "review";

  const forget = (item: ShoppingItem) => {
    void removeItem(item.id)
      .then(() => {
        setToast({
          message: "Removed " + item.name,
          duration: 5000,
          action: {
            label: "Undo",
            onClick: () => {
              setToast(null);
              void restoreItem(item.id);
            },
          },
        });
      })
      .catch(() => undefined);
  };

  const add = (draft: ManualItemDraft) =>
    addItem(list.id, draft).then(() => {
      setToast({ message: "Added " + draft.name });
    });

  return (
    <AppShell
      title={listTitle}
      eyebrow={formatWeekEyebrow(scope.week.startsOn, true)}
      backHref="/week"
      backLabel={backLabel}
      status={<StatusStrip state="locked" people={[]} secondary={secondary} />}
      footer={
        reviewing && (editing || approving) ? (
          <ListApproveBar listId={list.id} activeCount={active.length} canApprove={approving} />
        ) : undefined
      }
    >
      <div className="space-y-8">
        {reviewing ? null : <OrderStatusCard list={list} />}
        {reviewing ? null : (
          <ListProblemSections missing={problems.missing} substituted={problems.substituted} />
        )}
        {editing ? <ListAddItemSheet stores={snapshot.stores} busy={false} onAdd={add} /> : null}
        {groups.map((group) => (
          <section key={group.store.id} data-slot="list-store-section">
            <h2
              data-slot="list-store"
              data-store={group.store.slug}
              className="type-eyebrow sticky z-10 -mx-4 bg-card/95 px-4 py-2 text-primary shadow-card backdrop-blur-md"
              style={{ top: "var(--shell-head-h, 5.5rem)" }}
            >
              {group.label}
            </h2>
            <ul className="divide-y divide-border">
              {group.items.map((item) => (
                <ListRow
                  key={item.id}
                  item={item}
                  onRemove={editing ? () => forget(item) : undefined}
                />
              ))}
            </ul>
          </section>
        ))}
        <ListRemovedSection
          items={gone}
          memberships={snapshot.memberships}
          canEdit={editing}
          onRestore={(itemId) => {
            void restoreItem(itemId);
          }}
        />
      </div>
      <BallotToast
        message={toast?.message}
        duration={toast?.duration}
        action={toast?.action}
        onDismiss={() => setToast(null)}
      />
    </AppShell>
  );
}
