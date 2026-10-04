import type { VoterProgress } from "./lock";
import { memberName } from "./names";

export const STATUS_STRIP_STATES = [
  "your_turn",
  "waiting_on_others",
  "ready",
  "locked",
] as const;

export type StatusStripState = (typeof STATUS_STRIP_STATES)[number];

export type StatusStripCopy = {
  title: string;
  secondary?: string;
};

export type StatusStripPerson = {
  id: string;
  displayName: string;
  done: boolean;
};

/** Map lock progress to StatusStrip dots — pending (`done: false`) vs finished. */
export function statusStripPeople(progress: VoterProgress[]): StatusStripPerson[] {
  return progress.map((voter) => ({
    id: voter.membershipId,
    displayName: memberName(voter),
    done: voter.done,
  }));
}

export function waitingOnNames(progress: VoterProgress[]): string[] {
  return progress.filter((voter) => !voter.done).map((voter) => memberName(voter));
}

/** Empty week has no mid-vote strip — seed panel only, no kit shell. */
export function weekStatusStripVisible(nightCount: number): boolean {
  return nightCount > 0;
}

export function waitingOnCopy(names: string[]): string {
  if (names.length === 1) return `Waiting on ${names[0]}`;
  if (names.length === 2) return `Waiting on ${names[0]} and ${names[1]}`;
  if (names.length > 2) return `Waiting on ${names.length} people`;
  return "Waiting on others";
}

export function statusStripCopy(
  state: StatusStripState,
  waitingOn: string[] = [],
): StatusStripCopy {
  switch (state) {
    case "your_turn":
      return { title: "Clear swaps and dinner requests." };
    case "waiting_on_others":
      return { title: waitingOnCopy(waitingOn) };
    case "ready":
      return { title: "Ready to lock." };
    case "locked":
      return {
        title: "This week is locked.",
        secondary: "Recipes and the shopping list are open.",
      };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function weekStatusStripState(input: {
  locked: boolean;
  ready: boolean;
  currentMembershipId: string | null;
  progress: VoterProgress[];
}): StatusStripState {
  if (input.locked) return "locked";
  if (input.ready) return "ready";
  const mine = input.progress.find(
    (voter) => voter.membershipId === input.currentMembershipId,
  );
  if (mine && !mine.done) return "your_turn";
  return "waiting_on_others";
}

export function visibleProgressPeople<T>(
  people: T[],
  max = 4,
): { visible: T[]; overflow: number } {
  if (people.length <= max) return { visible: people, overflow: 0 };
  return { visible: people.slice(0, max), overflow: people.length - max };
}
