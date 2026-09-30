import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIST_LOCKED_SECONDARY,
  LIST_NO_HOUSEHOLD,
  LIST_NOTHING_TO_BUY,
  LIST_PRE_LOCK_DESCRIPTION,
  LOCK_FIRST_TITLE,
  LOCK_SUCCESS_LIST_CTA,
  LOCK_SUCCESS_RECIPES_CTA,
  RECIPES_EMPTY_WEEK,
  RECIPES_NO_HOUSEHOLD,
  RECIPES_PRE_LOCK_DESCRIPTION,
  lockSuccessRecipesCta,
  lockSuccessRecipesKicker,
} from "./lock-success";

describe("lock-success copy", () => {
  it("uses the shipped CTAs and never coaches collapse or a cart", () => {
    expect(LOCK_SUCCESS_LIST_CTA).toBe("Open shopping list");
    expect(LOCK_SUCCESS_RECIPES_CTA).toBe("See recipes");
    expect(lockSuccessRecipesCta("Lemon roast chicken")).toBe("See recipes · Lemon roast chicken");
    expect(lockSuccessRecipesCta()).toBe("See recipes");
    expect(lockSuccessRecipesKicker("Sunday")).toBe("First meal · Sunday");
    const blob = `${LOCK_SUCCESS_LIST_CTA} ${LOCK_SUCCESS_RECIPES_CTA} ${LIST_LOCKED_SECONDARY}`.toLowerCase();
    expect(blob).not.toContain("tap to collapse");
    expect(blob).not.toContain("tap to expand");
    expect(blob).not.toContain("cart");
    expect(blob).not.toContain("$");
    expect(LIST_LOCKED_SECONDARY).toContain("No prices");
  });

  it("replaces Approve/Skip lock-first empties with week-lock copy", () => {
    expect(LOCK_FIRST_TITLE).toBe("Lock the week first");
    expect(LIST_PRE_LOCK_DESCRIPTION).toContain("after the week locks");
    expect(RECIPES_PRE_LOCK_DESCRIPTION).toContain("after swaps and dinner requests are cleared");
    expect(LIST_NO_HOUSEHOLD).toContain("after the week locks");
    expect(RECIPES_NO_HOUSEHOLD).toContain("after the week locks");
    expect(LIST_NOTHING_TO_BUY).toContain("was removed");
    expect(RECIPES_EMPTY_WEEK).toMatch(/Ask your Bot My Meals/);
    expect(RECIPES_EMPTY_WEEK.toLowerCase()).not.toContain("seed");
    expect(RECIPES_EMPTY_WEEK.toLowerCase()).not.toContain("cart");
    expect(RECIPES_EMPTY_WEEK).not.toContain("$");
    const blob = [
      LOCK_FIRST_TITLE,
      LIST_PRE_LOCK_DESCRIPTION,
      RECIPES_PRE_LOCK_DESCRIPTION,
      LIST_NO_HOUSEHOLD,
      RECIPES_NO_HOUSEHOLD,
      LIST_NOTHING_TO_BUY,
    ]
      .join(" ")
      .toLowerCase();
    expect(blob).not.toContain("approve");
    expect(blob).not.toContain("skip");
    expect(blob).not.toContain("you approved");
    expect(blob).not.toContain("your vote needed");
  });
});

describe("Clear Sky lock-success craft", () => {
  it("restyles Lock this week / post-lock CTAs on Clear Sky tokens, not Kitchen Paper", () => {
    const lockBar = readFileSync(
      path.resolve(import.meta.dirname, "../components/lock-bar.tsx"),
      "utf8",
    );
    const week = readFileSync(path.resolve(import.meta.dirname, "../app/week/page.tsx"), "utf8");
    const chrome = readFileSync(
      path.resolve(import.meta.dirname, "../components/week-chrome.tsx"),
      "utf8",
    );

    expect(week).toContain(
      "footer={!viewingPast && !locked && check.ready && !showPeopleGate ? <LockBar /> : undefined}",
    );
    expect(week).toContain("<WeekChrome");
    expect(week).toContain("<UnlockWeekControl");
    expect(lockBar).toContain('data-slot="lock-bar"');
    expect(lockBar).toContain('data-state="ready"');
    expect(lockBar).toContain("Lock this week");
    expect(lockBar).toContain('import { Loader2, Lock } from "lucide-react"');
    expect(lockBar).toMatch(
      /variant="primary"[\s\S]*?className="w-full gap-2 shadow-float"[\s\S]*?<Lock className="size-5" \/>[\s\S]*?Lock this week/,
    );
    expect(lockBar).toContain("variant=\"primary\"");
    expect(lockBar).toContain("bg-card");
    expect(chrome).toContain('data-slot="lock-success-list"');
    expect(chrome).toContain('data-slot="lock-success-recipes"');
    expect(chrome).toContain("LOCK_SUCCESS_LIST_CTA");
    expect(chrome).toContain("featuredMealEyebrow");
    expect(chrome).not.toContain("lockSuccessRecipesKicker");
    expect(chrome).not.toContain("First meal");
    expect(chrome).toContain("text-white");
    expect(chrome).toContain("truncate");
    expect(chrome).toContain("rounded-[12px]");
    expect(chrome).toContain("p-4");
    expect(chrome).not.toContain("See recipes");
    expect(chrome).not.toContain("lockSuccessRecipesCta");
    expect(lockBar).not.toContain("#b35025");
    expect(lockBar).not.toContain("Fraunces");
    expect(lockBar).not.toContain("Kroger");
    expect(lockBar).not.toContain("cart");
    expect(chrome).not.toContain("cart");
    expect(lockBar).not.toContain("$");
    expect(chrome).not.toMatch(/\$\d/);
    expect(lockBar).not.toContain("Clear Sky");
    expect(lockBar).not.toContain("Blue & White");
  });

  it("puts a lucide Lock on primary Lock this week", () => {
    const lockBar = readFileSync(
      path.resolve(import.meta.dirname, "../components/lock-bar.tsx"),
      "utf8",
    );
    expect(lockBar).toContain('import { Loader2, Lock } from "lucide-react"');
    expect(lockBar).toContain('<Lock className="size-5" />');
    expect(lockBar).toContain('<Loader2 className="size-5 animate-spin" aria-hidden />');
    expect(lockBar).toContain("Locking…");
    expect(lockBar).toContain("disabled={busy}");
    expect(lockBar).toMatch(/variant="primary"[\s\S]*?className="w-full gap-2 shadow-float"/);
    expect(lockBar).not.toMatch(/data-state="ready"[\s\S]*variant="outline"/);
  });
});
