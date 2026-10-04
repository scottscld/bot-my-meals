/** Trailing debounce so a burst of realtime rows becomes one refresh. */
export function createRefreshScheduler(fn: () => void, ms: number): {
  schedule: () => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel() {
      if (timer != null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Resume refetch only when the page is visible and the last refresh is stale. */
export function shouldRefreshOnResume(input: {
  visible: boolean;
  lastRefreshAt: number;
  now: number;
}): boolean {
  return input.visible && input.now - input.lastRefreshAt > 2000;
}

const BACKOFF_MS = [1000, 2000, 5000, 15000, 30000] as const;

/** 1s, 2s, 5s, 15s, then 30s for every later try. */
export function backoffDelay(attempt: number): number {
  const index = Math.min(Math.max(0, attempt), BACKOFF_MS.length - 1);
  return BACKOFF_MS[index];
}
