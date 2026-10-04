"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useSupper } from "@/components/supper-provider";
import { Button } from "@/components/ui/button";
import { nameLooksLikeHandle } from "@/lib/names";

const DISMISS_KEY = "bot-my-meals.name-nudge.dismissed";
const listeners = new Set<() => void>();

function subscribeDismiss(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function readDismissed() {
  return window.localStorage.getItem(DISMISS_KEY) === "1";
}

function dismissNameNudge() {
  window.localStorage.setItem(DISMISS_KEY, "1");
  listeners.forEach((listener) => listener());
}

export function NameNudge() {
  const { session, snapshot } = useSupper();
  const dismissed = useSyncExternalStore(subscribeDismiss, readDismissed, () => true);
  const me = snapshot?.memberships.find((member) => member.id === session?.membershipId);

  if (!me || dismissed || !nameLooksLikeHandle(me)) return null;

  return (
    <div data-slot="name-nudge" className="mb-4 rounded-[14px] bg-card p-4 shadow-card">
      <p className="type-body">Add your name so the house knows who’s voting</p>
      <div className="mt-3 flex gap-2">
        <Button asChild size="fat" variant="primary" className="flex-1">
          <Link href="/settings#name">Add your name</Link>
        </Button>
        <Button type="button" size="fat" variant="outline" onClick={dismissNameNudge}>
          Not now
        </Button>
      </div>
    </div>
  );
}
