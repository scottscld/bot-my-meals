import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { backoffDelay } from "@/lib/live-refresh";
import { shouldRefreshOnResume } from "@/lib/live-refresh";

const HOUSEHOLD_TABLES = [
  "votes",
  "meals",
  "weeks",
  "shopping_items",
  "shopping_lists",
  "recipes",
  "ballot_requests",
  "saved_meals",
  "meal_options",
  "meal_option_picks",
  "week_vote_submissions",
  "meal_option_requests",
  "memberships",
] as const;

const SAFETY_POLL_MS = 30_000;

/**
 * Subscribe as the signed-in member, debounce bursts, and catch up after the
 * phone backgrounds the websocket. Caller owns the scheduler.
 */
export function attachHouseholdLive(input: {
  client: SupabaseClient;
  householdId: string;
  scheduleRefresh: () => void;
  lastRefreshAt: { current: number };
}): () => void {
  const { client, householdId, scheduleRefresh, lastRefreshAt } = input;
  let generation = 0;
  let channel: RealtimeChannel | null = null;
  let subscribed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let backoffAttempt = 0;
  let stopped = false;

  const clearRetry = () => {
    if (retryTimer != null) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const stopPoll = () => {
    if (pollTimer != null) clearInterval(pollTimer);
    pollTimer = null;
  };
  const startPoll = () => {
    if (stopped || pollTimer != null || subscribed) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    pollTimer = setInterval(() => {
      if (stopped || subscribed || document.visibilityState !== "visible") {
        stopPoll();
        return;
      }
      scheduleRefresh();
    }, SAFETY_POLL_MS);
  };

  const openChannel = async () => {
    if (stopped) return;
    const mine = ++generation;
    clearRetry();
    const previous = channel;
    channel = null;
    subscribed = false;
    if (previous) void client.removeChannel(previous);

    const { data } = await client.auth.getSession();
    if (stopped || mine !== generation || !data.session) return;
    await client.realtime.setAuth();
    if (stopped || mine !== generation) return;

    let next = client.channel(`household:${householdId}`);
    for (const table of HOUSEHOLD_TABLES) {
      const filter = `household_id=eq.${householdId}`;
      next = next
        .on("postgres_changes", { event: "INSERT", schema: "public", table, filter }, () => scheduleRefresh())
        .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter }, () => scheduleRefresh())
        .on("postgres_changes", { event: "DELETE", schema: "public", table }, () => scheduleRefresh());
    }
    const householdFilter = `id=eq.${householdId}`;
    next = next
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "households", filter: householdFilter },
        () => scheduleRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "households", filter: householdFilter },
        () => scheduleRefresh(),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "households" }, () => scheduleRefresh());

    channel = next.subscribe((status, err) => {
      if (stopped || mine !== generation) return;
      if (status === "SUBSCRIBED") {
        subscribed = true;
        backoffAttempt = 0;
        stopPoll();
        scheduleRefresh();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        subscribed = false;
        console.warn("supper realtime", status, err);
        startPoll();
        const delay = backoffDelay(backoffAttempt);
        backoffAttempt += 1;
        clearRetry();
        retryTimer = setTimeout(() => {
          void openChannel();
        }, delay);
      }
    });
    startPoll();
  };

  const resubscribe = () => {
    backoffAttempt = 0;
    void openChannel();
  };

  const onResume = () => {
    if (
      shouldRefreshOnResume({
        visible: document.visibilityState === "visible",
        lastRefreshAt: lastRefreshAt.current,
        now: Date.now(),
      })
    ) {
      scheduleRefresh();
    }
    const joined = channel?.state === "joined";
    if (!joined || !client.realtime.isConnected()) resubscribe();
    if (!subscribed && document.visibilityState === "visible") startPoll();
  };

  const onVisibility = () => {
    if (document.visibilityState !== "visible") {
      stopPoll();
      return;
    }
    onResume();
  };

  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) onResume();
  };

  void openChannel();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onResume);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("online", onResume);

  return () => {
    stopped = true;
    generation += 1;
    clearRetry();
    stopPoll();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onResume);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("online", onResume);
    if (channel) void client.removeChannel(channel);
    channel = null;
  };
}
