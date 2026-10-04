import { memberInitials } from "@/lib/initials";
import { memberName } from "@/lib/names";
import { voteFor } from "@/lib/lock";
import type { Membership, Vote, VoteChoice } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLORS: Record<VoteChoice | "empty", string> = {
  swap: "bg-[color:var(--swap)] text-[color:var(--swap-foreground)]",
  remove: "bg-muted text-muted-foreground",
  request_new_meal: "bg-secondary text-muted-foreground",
  empty: "bg-secondary text-muted-foreground",
};

export { memberInitials as initials } from "@/lib/initials";

export function VoteDots({
  memberships,
  votes,
  mealId,
}: {
  memberships: Membership[];
  votes: Vote[];
  mealId: string;
}) {
  const voters = memberships.filter((member) => member.role === "owner" || member.role === "voter");
  return (
    <div className="flex items-center gap-1.5">
      {voters.map((member) => {
        const vote = voteFor(votes, mealId, member.id);
        return (
          <span
            key={member.id}
            title={`${memberName(member)}: ${vote?.choice ?? "no vote"}`}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-full text-[11px] font-bold",
              COLORS[vote?.choice ?? "empty"],
            )}
          >
            {memberInitials(memberName(member))}
          </span>
        );
      })}
    </div>
  );
}
