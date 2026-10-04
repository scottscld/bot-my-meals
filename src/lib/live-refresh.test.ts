import { afterEach, describe, expect, it, vi } from "vitest";
import { backoffDelay, createRefreshScheduler, shouldRefreshOnResume } from "./live-refresh";

afterEach(() => {
  vi.useRealTimers();
});

describe("createRefreshScheduler", () => {
  it("coalesces a burst into one call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const scheduler = createRefreshScheduler(fn, 250);
    for (let i = 0; i < 30; i += 1) scheduler.schedule();
    vi.advanceTimersByTime(249);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    scheduler.cancel();
  });
});

describe("shouldRefreshOnResume", () => {
  it("is true only when the page is visible and the last refresh is more than 2s old", () => {
    expect(shouldRefreshOnResume({ visible: false, lastRefreshAt: 0, now: 10_000 })).toBe(false);
    expect(shouldRefreshOnResume({ visible: true, lastRefreshAt: 0, now: 2000 })).toBe(false);
    expect(shouldRefreshOnResume({ visible: true, lastRefreshAt: 1000, now: 3000 })).toBe(false);
    expect(shouldRefreshOnResume({ visible: true, lastRefreshAt: 0, now: 2001 })).toBe(true);
  });
});

describe("backoffDelay", () => {
  it("steps through 1s, 2s, 5s, 15s, and caps at 30s", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((attempt) => backoffDelay(attempt))).toEqual([
      1000, 2000, 5000, 15000, 30000, 30000, 30000,
    ]);
  });
});
