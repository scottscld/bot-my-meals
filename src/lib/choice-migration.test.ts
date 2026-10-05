import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("three-choice voting migration", () => {
  const dir = path.resolve(import.meta.dirname, "../../supabase/migrations");
  const file = "20261003120000_three_choice_voting.sql";

  it("states the choice3 contract", () => {
    const names = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(names).toContain(file);
    expect(names.at(-1)).toBe("20261005120000_list_review_heb_order.sql");
    const sql = readFileSync(path.join(dir, file), "utf8");
    expect(sql).toContain(
      "meal_option_picks_one_per_night unique (week_id, day_index, membership_id)",
    );
    expect(sql).toContain("primary key (week_id, membership_id)");
    expect(sql).toContain("alter column ballot_mode set default 'choice3'");
    expect(sql.match(/enable row level security/g)).toHaveLength(4);
    expect(sql).toContain("grant select on public.meal_options");
    expect(sql).toContain("to authenticated");
    expect(sql).toContain(
      "grant execute on function public.submit_week_options(uuid, jsonb) to authenticated, service_role",
    );
    expect(sql).toContain("'Week cannot lock until every voter has locked in their vote'");
    expect(sql).toContain("'Each night needs exactly 3 options.'");
    expect(sql).toContain("order by c.votes desc, ow.owner_at asc nulls last, o.rank asc");
    expect(sql).toContain("supabase_realtime add table public.week_vote_submissions");
    expect(sql).not.toContain("update public.households");
    expect(sql).not.toContain("to anon");
  });
});
