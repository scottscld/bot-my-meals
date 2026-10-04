import type {
  BallotRequest,
  HouseholdSettingsPatch,
  HouseholdSnapshot,
  Meal,
  MealOption,
  MealPick,
  MealProposalInput,
  OptionRequest,
  Membership,
  PendingInvite,
  Recipe,
  Role,
  Session,
  ShoppingItem,
  ShoppingList,
  Store,
  Vote,
  VoteChoice,
  VoteSubmission,
  Week,
  WeekScope,
} from "@/lib/types";
import type { MemberDraft } from "@/lib/users";
import { voteNotePersists } from "@/lib/ballot";
import {
  botCheckForSnapshot,
  botCheckUpdateColumns,
  normalizeBotCheckSetting,
  preferBotCheckStatus,
  type BotCheckMeal,
  type BotCheckStatus,
} from "@/lib/bot-check";
import {
  clampHouseSetupStep,
  clampHouseholdSize,
  clampNightsPlanned,
  nightsPlannedFromHeadcounts,
  parseBallotRequestStatus,
} from "@/lib/house-setup";
import type { JoinPeek } from "@/lib/join";
import { parseJoinPeek } from "@/lib/join";
import { canActOnBallot, lastWriterWinsToast, latestVoteForMeal, migrateVoteChoice } from "@/lib/lock";
import { isAdmin } from "@/lib/users";
import { coupleNightsFromHeadcounts, normalizeNightHeadcounts } from "@/lib/headcount";
import { parseMealHistory, todayInTimeZone } from "@/lib/meal-history";
import { splitOpenWeeks } from "@/lib/open-weeks";
import { parseSavedMeals } from "@/lib/saved-meals";
import { redactUntilLocked } from "@/lib/visibility";
import { parseEditableFrom, parseShoppingPrompt } from "@/lib/week-chrome";
import type { SupabaseClient } from "@supabase/supabase-js";

function mapBallotRequest(
  row: Record<string, unknown> | null | undefined,
  error: { message: string } | null,
  weekId: string,
): BallotRequest | null {
  if (error || !row || row.week_id !== weekId) return null;
  const status = parseBallotRequestStatus(row.status);
  if (!status) return null;
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    weekId: String(row.week_id),
    status,
    householdSize: clampHouseholdSize(row.household_size),
    nightsPlanned: clampNightsPlanned(row.nights_planned),
    nightHeadcounts: normalizeNightHeadcounts(
      Array.isArray(row.night_headcounts) ? (row.night_headcounts as number[]) : null,
    ),
    storeNames: Array.isArray(row.store_names)
      ? (row.store_names as unknown[]).map((name) => String(name))
      : [],
    weeklyBudgetCents:
      typeof row.weekly_budget_cents === "number" ? row.weekly_budget_cents : null,
    postalCode:
      typeof row.postal_code === "string" && row.postal_code.trim() ? row.postal_code : null,
    requestedBy: typeof row.requested_by === "string" ? row.requested_by : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    fulfilledAt: typeof row.fulfilled_at === "string" ? row.fulfilled_at : null,
    specialInstructions: mapSpecialInstructions(row.special_instructions),
  };
}

function rowsOf<T>(data: T | T[] | null | undefined): T[] {
  if (data == null) return [];
  return Array.isArray(data) ? data : [data];
}

function mapSpecialInstructions(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapWeekPlates(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  return normalizeNightHeadcounts(value as number[]);
}

function mapWeekRow(weekRow: Record<string, unknown>): Week {
  return {
    id: String(weekRow.id),
    householdId: String(weekRow.household_id),
    startsOn: String(weekRow.starts_on).slice(0, 10),
    status: asWeekStatus(weekRow.status) ?? "voting",
    lockedAt: typeof weekRow.locked_at === "string" ? weekRow.locked_at : null,
    editableFrom: parseEditableFrom(weekRow.editable_from),
    shoppingPrompt: parseShoppingPrompt(weekRow.shopping_prompt),
    peopleConfirmedAt:
      typeof weekRow.people_confirmed_at === "string" ? weekRow.people_confirmed_at : null,
    nightHeadcounts: mapWeekPlates(weekRow.night_headcounts),
    specialInstructions: mapSpecialInstructions(weekRow.special_instructions),
    ballotMode: weekRow.ballot_mode === "choice3" ? "choice3" : "single",
    finalizedAt: typeof weekRow.finalized_at === "string" ? weekRow.finalized_at : null,
  };
}

function mapShoppingList(
  listRow: Record<string, unknown>,
  itemRows: readonly Record<string, unknown>[],
): ShoppingList {
  const listId = String(listRow.id);
  return {
    id: listId,
    householdId: String(listRow.household_id),
    weekId: String(listRow.week_id),
    generatedAt: String(listRow.generated_at ?? ""),
    items: itemRows
      .filter((row) => String(row.shopping_list_id) === listId)
      .map(
        (row): ShoppingItem => ({
          id: String(row.id),
          householdId: String(row.household_id),
          shoppingListId: String(row.shopping_list_id),
          storeId: String(row.store_id),
          name: String(row.name),
          quantity: Number(row.quantity),
          unit: String(row.unit ?? ""),
          priceCents: typeof row.price_cents === "number" ? row.price_cents : null,
          priceSource: typeof row.price_source === "string" ? row.price_source : null,
          pricedAt: typeof row.priced_at === "string" ? row.priced_at : null,
          checked: Boolean(row.checked),
        }),
      ),
  };
}

function required<T>(data: T | null, error: { message: string } | null, fallback: string): T {
  if (error) throw new Error(error.message);
  if (data == null) throw new Error(fallback);
  return data;
}

export async function fetchSupabaseSession(
  client: SupabaseClient,
): Promise<Session | null> {
  const { data: userData } = await client.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  await client.rpc("claim_pending_invites");

  const { data: membership, error: membershipError } = await client
    .from("memberships")
    .select("id, household_id, role, display_name, email")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);

  return {
    userId: user.id,
    email: user.email ?? membership?.email ?? "",
    displayName:
      membership?.display_name ||
      (user.user_metadata.display_name as string | undefined) ||
      user.email?.split("@")[0] ||
      "You",
    membershipId: membership?.id ?? null,
    householdId: membership?.household_id ?? null,
    role: membership?.role ?? null,
  };
}

export async function fetchSupabaseSnapshot(
  client: SupabaseClient,
  session: Session,
): Promise<HouseholdSnapshot | null> {
  if (!session.householdId) return null;

  const householdId = session.householdId;
  const [
    householdRes,
    membersRes,
    storesRes,
    weekRes,
    mealsRes,
    votesRes,
    recipesRes,
    ingredientsRes,
    listRes,
    invitesRes,
    joinTokenRes,
    ballotRequestRes,
    historyRes,
    savedMealsRes,
    optionsRes,
    picksRes,
    submissionsRes,
    optionRequestsRes,
  ] = await Promise.all([
    client.from("households").select("*").eq("id", householdId).single(),
    client.from("memberships").select("*").eq("household_id", householdId),
    client.from("household_stores").select("*").eq("household_id", householdId).order("sort_order"),
    client
      .from("weeks")
      .select("*")
      .eq("household_id", householdId)
      .order("starts_on", { ascending: false })
      .limit(8),
    client.from("meals").select("*").eq("household_id", householdId),
    client.from("votes").select("*").eq("household_id", householdId),
    client.from("recipes").select("*").eq("household_id", householdId),
    client.from("recipe_ingredients").select("*").eq("household_id", householdId),
    client.from("shopping_lists").select("*").eq("household_id", householdId),
    client.from("household_invites").select("*").eq("household_id", householdId),
    client
      .from("household_join_tokens")
      .select("token")
      .eq("household_id", householdId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("ballot_requests")
      .select("*")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false }),
    client.rpc("meal_history"),
    client
      .from("saved_meals")
      .select("*")
      .eq("household_id", householdId)
      .order("saved_at", { ascending: false }),
    client.from("meal_options").select("*").eq("household_id", householdId),
    client.from("meal_option_picks").select("*").eq("household_id", householdId),
    client.from("week_vote_submissions").select("*").eq("household_id", householdId),
    client
      .from("meal_option_requests")
      .select("*")
      .eq("household_id", householdId)
      .eq("status", "pending"),
  ]);

  const householdRow = required(householdRes.data, householdRes.error, "Household not found");
  if (weekRes.error) throw new Error(weekRes.error.message);
  if (listRes.error) throw new Error(listRes.error.message);
  const botCheck = normalizeBotCheckSetting(
    householdRow.bot_check_mode,
    householdRow.bot_check_interval_hours,
  );
  const today = todayInTimeZone(new Date(), String(householdRow.timezone ?? ""));
  const openWeeks = splitOpenWeeks(
    rowsOf(weekRes.data).flatMap((row) => {
      const status = asWeekStatus(row.status);
      if (!status || typeof row.starts_on !== "string") return [];
      return [{ row, startsOn: row.starts_on.slice(0, 10), status }];
    }),
    today,
    Number(householdRow.week_starts_on) || 0,
  );
  const cookingRow = openWeeks.cooking?.row;
  if (!cookingRow) throw new Error("This household has no week yet.");

  const openWeekIds = new Set(
    [cookingRow.id, openWeeks.planning?.row.id].filter((id): id is string => Boolean(id)),
  );
  const listRows = rowsOf(listRes.data).filter((row) => openWeekIds.has(String(row.week_id)));
  let shoppingItemRows: Array<Record<string, unknown>> = [];
  if (listRows.length) {
    const itemsRes = await client
      .from("shopping_items")
      .select("*")
      .in(
        "shopping_list_id",
        listRows.map((row) => String(row.id)),
      );
    if (itemsRes.error) throw new Error(itemsRes.error.message);
    shoppingItemRows = itemsRes.data ?? [];
  }

  const allMeals: Meal[] = (mealsRes.data ?? []).map((row) => ({
    id: row.id,
    householdId: row.household_id,
    weekId: row.week_id,
    dayIndex: row.day_index,
    nightDate: row.night_date,
    title: row.title,
    pitch: row.pitch,
    audience: row.audience,
    servings: row.servings,
    prepMinutes: row.prep_minutes,
    isLeftovers: row.is_leftovers,
    leftoverOfMealId: row.leftover_of_meal_id,
    estimatedCostCents: row.estimated_cost_cents,
    estimatedCostSource: row.estimated_cost_source,
    estimatedCostAsOf: row.estimated_cost_as_of,
    sourceOptionId: row.source_option_id ?? null,
  }));

  if (optionsRes.error) throw new Error(optionsRes.error.message);
  if (picksRes.error) throw new Error(picksRes.error.message);
  if (submissionsRes.error) throw new Error(submissionsRes.error.message);
  if (optionRequestsRes.error) throw new Error(optionRequestsRes.error.message);

  const allOptions: MealOption[] = (optionsRes.data ?? []).map((row) => ({
    id: String(row.id),
    householdId: String(row.household_id),
    weekId: String(row.week_id),
    dayIndex: Number(row.day_index),
    nightDate: String(row.night_date).slice(0, 10),
    rank: Number(row.rank),
    title: String(row.title),
    pitch: String(row.pitch ?? ""),
    servings: Number(row.servings),
    prepMinutes: Number(row.prep_minutes),
    recipeKey: typeof row.recipe_key === "string" && row.recipe_key.trim() ? row.recipe_key.trim() : null,
  }));

  const allPicks: MealPick[] = (picksRes.data ?? []).map((row) => ({
    id: String(row.id),
    weekId: String(row.week_id),
    dayIndex: Number(row.day_index),
    optionId: String(row.option_id),
    membershipId: String(row.membership_id),
    updatedAt: String(row.updated_at ?? ""),
  }));

  const allSubmissions: VoteSubmission[] = (submissionsRes.data ?? []).map((row) => ({
    weekId: String(row.week_id),
    membershipId: String(row.membership_id),
    submittedAt: String(row.submitted_at ?? ""),
  }));

  const allOptionRequests: OptionRequest[] = (optionRequestsRes.data ?? []).map((row) => ({
    id: String(row.id),
    weekId: String(row.week_id),
    dayIndex: Number(row.day_index),
    requestedBy: row.requested_by ? String(row.requested_by) : null,
    note: String(row.note ?? ""),
    status: "pending",
  }));

  const allRecipes: Recipe[] = (recipesRes.data ?? []).map((row) => ({
    id: row.id,
    mealId: row.meal_id,
    servings: row.servings,
    prepMinutes: row.prep_minutes,
    cookMinutes: row.cook_minutes,
    steps: row.steps ?? [],
    recipeKey:
      typeof row.recipe_key === "string" && row.recipe_key.trim() ? row.recipe_key.trim() : null,
    ingredients: (ingredientsRes.data ?? [])
      .filter((ingredient) => ingredient.recipe_id === row.id)
      .map((ingredient) => ({
        id: ingredient.id,
        name: ingredient.name,
        quantity: Number(ingredient.quantity),
        unit: ingredient.unit,
        storeId: ingredient.store_id,
      })),
  }));

  const allVotes: Vote[] = (votesRes.data ?? []).flatMap((row) => {
    const choice = migrateVoteChoice(row.choice);
    if (!choice) return [];
    return [{
      id: row.id,
      householdId: row.household_id,
      mealId: row.meal_id,
      membershipId: row.membership_id,
      choice,
      note: voteNotePersists(choice) ? (row.note ?? "") : "",
      updatedAt: row.updated_at,
    }];
  });

  const scopeForRow = (weekRow: Record<string, unknown>): WeekScope => {
    const week = mapWeekRow(weekRow);
    const meals = allMeals
      .filter((meal) => meal.weekId === week.id)
      .sort((a, b) => a.dayIndex - b.dayIndex);
    const mealIds = new Set(meals.map((meal) => meal.id));
    const listRow = listRows.find((row) => String(row.week_id) === week.id);
    const ballotRow = rowsOf(ballotRequestRes.data).find((row) => String(row.week_id) === week.id);
    return {
      week,
      meals,
      votes: allVotes.filter((vote) => mealIds.has(vote.mealId)),
      recipes: allRecipes.filter((recipe) => mealIds.has(recipe.mealId)),
      shoppingList: listRow ? mapShoppingList(listRow, shoppingItemRows) : null,
      ballotRequest: mapBallotRequest(ballotRow, ballotRequestRes.error, week.id),
      options: allOptions
        .filter((option) => option.weekId === week.id)
        .sort((a, b) => a.dayIndex - b.dayIndex || a.rank - b.rank),
      picks: allPicks.filter((pick) => pick.weekId === week.id),
      submissions: allSubmissions.filter((row) => row.weekId === week.id),
      optionRequests: allOptionRequests.filter((row) => row.weekId === week.id),
    };
  };

  const cooking = scopeForRow(cookingRow);
  const planning = openWeeks.planning ? scopeForRow(openWeeks.planning.row) : null;
  const { week, meals, votes, recipes, shoppingList, options, picks, submissions, optionRequests } =
    cooking;

  const snapshot: HouseholdSnapshot = {
    household: {
      id: householdRow.id,
      name: householdRow.name,
      inviteCode: householdRow.invite_code,
      weekStartsOn: householdRow.week_starts_on,
      coupleNights: householdRow.couple_nights,
      familySize: householdRow.family_size,
      coupleSize: householdRow.couple_size,
      nightHeadcounts: normalizeNightHeadcounts(householdRow.night_headcounts, {
        coupleNights: householdRow.couple_nights,
        familySize: householdRow.family_size,
        coupleSize: householdRow.couple_size,
      }),
      timezone: householdRow.timezone,
      setupStep: clampHouseSetupStep(householdRow.setup_step ?? 8),
      weeklyBudgetCents:
        typeof householdRow.weekly_budget_cents === "number"
          ? householdRow.weekly_budget_cents
          : null,
      householdSize: clampHouseholdSize(householdRow.household_size ?? householdRow.family_size),
      nightsPlanned: clampNightsPlanned(
        householdRow.nights_planned ??
          nightsPlannedFromHeadcounts(householdRow.night_headcounts ?? []),
      ),
      postalCode:
        typeof householdRow.postal_code === "string" && householdRow.postal_code.trim()
          ? householdRow.postal_code
          : null,
      botCheckMode: botCheck.mode,
      botCheckIntervalHours: botCheck.intervalHours,
    },
    memberships: (membersRes.data ?? []).map(
      (row): Membership => ({
        id: row.id,
        householdId: row.household_id,
        userId: row.user_id,
        role: row.role,
        displayName: row.display_name,
        email: row.email ?? "",
      }),
    ),
    stores: (storesRes.data ?? []).map(
      (row): Store => ({
        id: row.id,
        householdId: row.household_id,
        name: row.name,
        slug: row.slug,
        sortOrder: row.sort_order,
      }),
    ),
    week,
    meals,
    votes,
    recipes,
    shoppingList,
    planning,
    pendingInvites: (invitesRes.data ?? []).map(
      (row): PendingInvite => ({
        id: row.id,
        householdId: row.household_id,
        displayName: row.display_name,
        email: row.email ?? "",
        role: row.role,
      }),
    ),
    joinToken: joinTokenRes.error ? null : (joinTokenRes.data?.token ?? null),
    ballotRequest: cooking.ballotRequest,
    options,
    picks,
    submissions,
    optionRequests,
    mealHistory: parseMealHistory(historyRes.error ? null : historyRes.data),
    savedMeals: parseSavedMeals(savedMealsRes.error ? null : savedMealsRes.data),
  };

  return redactUntilLocked(snapshot);
}

export async function supabaseSetVote(
  client: SupabaseClient,
  session: Session,
  mealId: string,
  choice: VoteChoice,
  note: string,
) {
  if (!session.membershipId || !session.householdId) throw new Error("Not in a household");
  if (!canActOnBallot(session.role)) throw new Error("Eaters can look, not change the ballot.");
  const { data: existingRows } = await client
    .from("votes")
    .select("id, household_id, meal_id, membership_id, choice, note, updated_at")
    .eq("meal_id", mealId);
  const previous = latestVoteForMeal(
    (existingRows ?? []).flatMap((row) => {
      const migrated = migrateVoteChoice(row.choice);
      if (!migrated) return [];
      return [{
        id: row.id,
        householdId: row.household_id,
        mealId: row.meal_id,
        membershipId: row.membership_id,
        choice: migrated,
        note: row.note ?? "",
        updatedAt: row.updated_at,
      }];
    }),
    mealId,
  );
  const { error } = await client.from("votes").upsert(
    {
      household_id: session.householdId,
      meal_id: mealId,
      membership_id: session.membershipId,
      choice,
      note: voteNotePersists(choice) ? note : "",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "meal_id,membership_id" },
  );
  if (error) throw new Error(error.message);
  return lastWriterWinsToast(previous, session.membershipId);
}

export async function supabaseProposeReplacement(
  client: SupabaseClient,
  session: Session,
  mealId: string,
  proposal: MealProposalInput,
) {
  if (!session.householdId) throw new Error("Not in a household");
  const { data: meal, error: mealError } = await client
    .from("meals")
    .select("*")
    .eq("id", mealId)
    .single();
  if (mealError || !meal) throw new Error(mealError?.message ?? "Meal not found");

  const { error: updateError } = await client
    .from("meals")
    .update({
      title: proposal.title,
      pitch: proposal.pitch,
      prep_minutes: proposal.prepMinutes,
      audience: proposal.audience ?? meal.audience,
      servings: proposal.servings ?? meal.servings,
      is_leftovers: false,
      leftover_of_meal_id: null,
    })
    .eq("id", mealId);
  if (updateError) throw new Error(updateError.message);

  await client.from("votes").delete().eq("meal_id", mealId);
  await client.from("recipes").delete().eq("meal_id", mealId);

  const { data: recipe, error: recipeError } = await client
    .from("recipes")
    .insert({
      household_id: session.householdId,
      meal_id: mealId,
      servings: proposal.servings ?? meal.servings,
      prep_minutes: Math.min(15, proposal.prepMinutes),
      cook_minutes: Math.max(0, proposal.prepMinutes - 15),
      steps: proposal.steps?.length ? proposal.steps : ["Cook and serve."],
    })
    .select("id")
    .single();
  if (recipeError || !recipe) throw new Error(recipeError?.message ?? "Could not save recipe");

  if (proposal.ingredients?.length) {
    const { error: ingError } = await client.from("recipe_ingredients").insert(
      proposal.ingredients.map((ingredient) => ({
        household_id: session.householdId,
        recipe_id: recipe.id,
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        store_id: ingredient.storeId,
      })),
    );
    if (ingError) throw new Error(ingError.message);
  }
}

export async function supabaseLockWeek(client: SupabaseClient, weekId: string) {
  const { error } = await client.rpc("lock_week", { target_week: weekId });
  if (error) throw new Error(error.message);
}

export async function supabaseSetMealPick(client: SupabaseClient, optionId: string) {
  const { error } = await client.rpc("set_meal_pick", { target_option: optionId });
  if (error) throw new Error(error.message);
}

export async function supabaseSubmitWeekVote(
  client: SupabaseClient,
  weekId: string,
): Promise<{ submitted: boolean; finalized: boolean }> {
  const { data, error } = await client.rpc("submit_week_vote", { target_week: weekId });
  if (error) throw new Error(error.message);
  const body = (data ?? {}) as { submitted?: boolean; finalized?: boolean };
  return { submitted: body.submitted !== false, finalized: body.finalized === true };
}

export async function supabaseReopenWeekVote(
  client: SupabaseClient,
  weekId: string,
  memberId?: string | null,
) {
  const { error } = await client.rpc("reopen_week_vote", {
    target_week: weekId,
    target_member: memberId ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function supabaseRequestNightOptions(
  client: SupabaseClient,
  weekId: string,
  dayIndex: number,
  note: string,
) {
  const { error } = await client.rpc("request_night_options", {
    target_week: weekId,
    target_day: dayIndex,
    note,
  });
  if (error) throw new Error(error.message);
}

export async function supabaseCancelNightOptionsRequest(client: SupabaseClient, requestId: string) {
  const { error } = await client.rpc("cancel_night_options_request", {
    target_request: requestId,
  });
  if (error) throw new Error(error.message);
}

export async function supabaseSetMyDisplayName(client: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await client.rpc("set_my_display_name", { new_name: name });
  if (error) throw new Error(error.message);
  return String(data ?? name);
}

export async function supabaseSetMemberDisplayName(
  client: SupabaseClient,
  memberId: string,
  name: string,
): Promise<string> {
  const { data, error } = await client.rpc("set_member_display_name", {
    member_id: memberId,
    new_name: name,
  });
  if (error) throw new Error(error.message);
  return String(data ?? name);
}

export async function supabaseUpsertPushSubscription(
  client: SupabaseClient,
  subscription: { endpoint?: string; keys?: { p256dh?: string; auth?: string } },
  userAgent: string,
) {
  const endpoint = subscription.endpoint ?? "";
  const p256dh = subscription.keys?.p256dh ?? "";
  const auth = subscription.keys?.auth ?? "";
  const { error } = await client.rpc("upsert_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: userAgent,
  });
  if (error) throw new Error(error.message);
}

export async function supabaseDeletePushSubscription(client: SupabaseClient, endpoint: string) {
  const { error } = await client.rpc("delete_push_subscription", { p_endpoint: endpoint });
  if (error) throw new Error(error.message);
}

export async function supabaseSetPushPrefs(
  client: SupabaseClient,
  endpoint: string,
  menuReady: boolean,
  weekLocked: boolean,
) {
  const { error } = await client.rpc("set_push_prefs", {
    p_endpoint: endpoint,
    p_menu_ready: menuReady,
    p_week_locked: weekLocked,
  });
  if (error) throw new Error(error.message);
}

export async function supabaseUnlockWeek(
  client: SupabaseClient,
  session: Session,
  weekId: string,
  editableFrom: string,
) {
  if (session.role !== "owner") throw new Error("Only an Admin can unlock the week.");
  const { error } = await client
    .from("weeks")
    .update({ status: "voting", locked_at: null, editable_from: editableFrom })
    .eq("id", weekId);
  if (error) throw new Error(error.message);
  await client.from("shopping_lists").delete().eq("week_id", weekId);
}

export async function supabaseSetShoppingPrompt(
  client: SupabaseClient,
  weekId: string,
  shoppingPrompt: Week["shoppingPrompt"],
) {
  const { error } = await client
    .from("weeks")
    .update({ shopping_prompt: shoppingPrompt })
    .eq("id", weekId);
  if (error) throw new Error(error.message);
}

export async function supabaseToggleItem(
  client: SupabaseClient,
  itemId: string,
  checked: boolean,
) {
  const { error } = await client.from("shopping_items").update({ checked }).eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function supabaseUpdateHousehold(
  client: SupabaseClient,
  session: Session,
  patch: HouseholdSettingsPatch,
) {
  if (session.role !== "owner" || !session.householdId) {
    throw new Error("Only an Admin can change household settings.");
  }
  const nightHeadcounts = patch.nightHeadcounts
    ? normalizeNightHeadcounts(patch.nightHeadcounts)
    : undefined;
  const coupleNights = nightHeadcounts
    ? coupleNightsFromHeadcounts(nightHeadcounts)
    : patch.coupleNights;

  const { error } = await client
    .from("households")
    .update({
      name: patch.name,
      week_starts_on: patch.weekStartsOn,
      couple_nights: coupleNights,
      family_size: patch.familySize,
      couple_size: patch.coupleSize,
      night_headcounts: nightHeadcounts,
      ...(patch.setupStep === undefined
        ? {}
        : { setup_step: clampHouseSetupStep(patch.setupStep) }),
      ...(patch.weeklyBudgetCents === undefined
        ? {}
        : { weekly_budget_cents: patch.weeklyBudgetCents }),
      ...(patch.householdSize === undefined
        ? {}
        : {
            household_size: clampHouseholdSize(patch.householdSize),
            family_size: clampHouseholdSize(patch.householdSize),
          }),
      ...(patch.nightsPlanned === undefined
        ? {}
        : { nights_planned: clampNightsPlanned(patch.nightsPlanned) }),
      ...(patch.postalCode === undefined ? {} : { postal_code: patch.postalCode }),
      ...botCheckUpdateColumns(patch),
      ...(nightHeadcounts
        ? { nights_planned: nightsPlannedFromHeadcounts(nightHeadcounts) }
        : {}),
    })
    .eq("id", session.householdId);
  if (error) throw new Error(error.message);
}

export async function supabaseJoinByCode(client: SupabaseClient, code: string) {
  const { error } = await client.rpc("join_household_by_code", { invite: code.trim() });
  if (error) throw new Error(error.message);
}

export const HOUSEHOLD_NOT_VISIBLE =
  "Household was created but this account cannot see it. Run the latest migrations, then refresh.";

export async function supabaseCreateHousehold(client: SupabaseClient, name: string) {
  const householdName = name.trim();
  if (!householdName) {
    throw new Error("Give the household a name.");
  }

  const { data, error } = await client.rpc("create_household", { household_name: householdName });
  if (error) throw new Error(error.message);
  if (data == null) throw new Error("Could not create a household.");

  const session = await fetchSupabaseSession(client);
  if (!session) throw new Error("Not signed in");
  if (!session.householdId) throw new Error(HOUSEHOLD_NOT_VISIBLE);
}

function requireAdmin(session: Session) {
  if (!isAdmin(session.role) || !session.householdId) {
    throw new Error("Only an Admin can manage people.");
  }
}

export async function supabaseInviteMember(
  client: SupabaseClient,
  session: Session,
  draft: MemberDraft,
) {
  requireAdmin(session);
  const { error } = await client.from("household_invites").insert({
    household_id: session.householdId,
    display_name: draft.displayName.trim(),
    email: draft.email.trim().toLowerCase(),
    role: draft.role,
  });
  if (error) throw new Error(error.message);
}

export async function supabaseSetMemberRole(
  client: SupabaseClient,
  session: Session,
  memberId: string,
  role: Role,
) {
  requireAdmin(session);
  const { error } = await client.rpc("set_member_role", {
    member_id: memberId,
    next_role: role,
  });
  if (error) throw new Error(error.message);
}

export async function supabaseRemoveMember(
  client: SupabaseClient,
  session: Session,
  memberId: string,
) {
  requireAdmin(session);
  const { error } = await client.rpc("remove_member", { member_id: memberId });
  if (error) throw new Error(error.message);
}

export async function supabaseRemoveInvite(
  client: SupabaseClient,
  session: Session,
  inviteId: string,
) {
  requireAdmin(session);
  const { error } = await client.from("household_invites").delete().eq("id", inviteId);
  if (error) throw new Error(error.message);
}

export async function supabasePeekJoinToken(
  client: SupabaseClient,
  token: string,
): Promise<JoinPeek> {
  const { data, error } = await client.rpc("peek_join_token", { join_token: token.trim() });
  if (error) throw new Error(error.message);
  return parseJoinPeek(data);
}

export async function supabaseClaimJoinToken(client: SupabaseClient, token: string) {
  const { error } = await client.rpc("claim_join_token", { join_token: token.trim() });
  if (error) throw new Error(error.message);
}

export async function supabaseCreateJoinToken(client: SupabaseClient, rotate = false) {
  const { data, error } = await client.rpc("create_join_token", { rotate });
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || !data) throw new Error("Could not create an invite link.");
  return data;
}

export async function supabaseRequestWeekBallot(client: SupabaseClient, startsOn?: string) {
  const { data, error } = startsOn
    ? await client.rpc("request_week_ballot", { target_starts: startsOn })
    : await client.rpc("request_week_ballot");
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || !data) throw new Error("Could not create this week's meals request.");
  return data;
}

export async function supabasePlanNextWeek(client: SupabaseClient) {
  const { data, error } = await client.rpc("plan_next_week");
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || !data) throw new Error("Could not plan next week.");
  return data;
}

export async function supabaseSavePlanningPeople(
  client: SupabaseClient,
  counts: number[],
  instructions: string,
) {
  const { data, error } = await client.rpc("save_planning_people", {
    counts,
    instructions,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || !data) throw new Error("Could not save people per night.");
  return data;
}

export async function supabaseSaveWeekPeople(
  client: SupabaseClient,
  weekId: string,
  counts: number[],
  instructions: string | null,
) {
  const { data, error } = await client.rpc("save_week_people", {
    target_week: weekId,
    counts: normalizeNightHeadcounts(counts),
    instructions,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || !data) throw new Error("Couldn’t save nights. Try again.");
  return data;
}

function requireVoter(session: Session) {
  if (!session.householdId) throw new Error("Not in a household");
  if (!canActOnBallot(session.role)) throw new Error("Eaters can look, not change saved meals.");
}

export async function supabaseSaveMeal(
  client: SupabaseClient,
  session: Session,
  input: {
    recipeKey: string;
    title: string;
    sourceRecipeId: string | null;
    lastLockedAt: string | null;
  },
) {
  requireVoter(session);
  const recipeKey = input.recipeKey.trim();
  const title = input.title.trim();
  if (!recipeKey || !title) throw new Error("Save when the recipe is ready.");
  const { error } = await client.from("saved_meals").upsert(
    {
      household_id: session.householdId,
      recipe_key: recipeKey,
      title,
      source_recipe_id: input.sourceRecipeId,
      last_locked_at: input.lastLockedAt,
      saved_at: new Date().toISOString(),
      requested_for_week: null,
    },
    { onConflict: "household_id,recipe_key" },
  );
  if (error) throw new Error(error.message);
}

export async function supabaseRemoveSavedMeal(
  client: SupabaseClient,
  session: Session,
  recipeKey: string,
) {
  requireVoter(session);
  const key = recipeKey.trim();
  if (!key) throw new Error("That saved meal is gone.");
  const { error } = await client
    .from("saved_meals")
    .delete()
    .eq("household_id", session.householdId)
    .eq("recipe_key", key);
  if (error) throw new Error(error.message);
}

export async function supabaseRequestSavedMeal(
  client: SupabaseClient,
  session: Session,
  recipeKey: string,
): Promise<"requested" | "already"> {
  requireVoter(session);
  const key = recipeKey.trim();
  const { data, error } = await client.rpc("request_saved_for_planning", { recipe_key: key });
  if (error) throw new Error(error.message);
  if (data === "already") return "already";
  if (data === "requested") return "requested";
  throw new Error("Could not request that meal.");
}

export type BotCheckStatusResult =
  | { ok: true; body: BotCheckStatus }
  | { ok: false; error: "unauthorized" | "no_household" };

const BOT_STATUS_HOUSEHOLD_COLUMNS =
  "bot_check_mode, bot_check_interval_hours, setup_step, household_size, night_headcounts, couple_nights, family_size, couple_size, timezone, week_starts_on";

function asRole(value: unknown): Role | null {
  switch (value) {
    case "owner":
    case "voter":
    case "eater":
      return value;
    default:
      return null;
  }
}

function asWeekStatus(value: unknown): "voting" | "locked" | null {
  switch (value) {
    case "voting":
    case "locked":
      return value;
    default:
      return null;
  }
}

function asSteps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((step) => (typeof step === "string" ? [step] : []));
}

/**
 * Quiet wakes skip recipe and shopping reads. A locked week reads only enough
 * to see whether dinners still need recipes or a shopping list.
 */
async function loadLockedWeekFill(
  client: SupabaseClient,
  householdId: string,
  weekId: string,
  mealIds: string[],
): Promise<{ recipes: Recipe[]; shoppingList: { items: readonly unknown[] } | null }> {
  const [recipesRes, listRes] = await Promise.all([
    client
      .from("recipes")
      .select("id, meal_id, steps")
      .eq("household_id", householdId)
      .in("meal_id", mealIds),
    client
      .from("shopping_lists")
      .select("id")
      .eq("household_id", householdId)
      .eq("week_id", weekId)
      .maybeSingle(),
  ]);
  if (recipesRes.error) throw new Error(recipesRes.error.message);
  if (listRes.error) throw new Error(listRes.error.message);

  const recipeRows = recipesRes.data ?? [];
  const recipeIds = recipeRows.map((row) => String(row.id));
  let ingredientRecipeIds: string[] = [];
  if (recipeIds.length) {
    const ingredientsRes = await client
      .from("recipe_ingredients")
      .select("recipe_id")
      .eq("household_id", householdId)
      .in("recipe_id", recipeIds);
    if (ingredientsRes.error) throw new Error(ingredientsRes.error.message);
    ingredientRecipeIds = (ingredientsRes.data ?? []).map((row) => String(row.recipe_id));
  }

  let shoppingList: { items: readonly unknown[] } | null = null;
  if (listRes.data?.id) {
    const itemsRes = await client
      .from("shopping_items")
      .select("id")
      .eq("shopping_list_id", String(listRes.data.id))
      .limit(1);
    if (itemsRes.error) throw new Error(itemsRes.error.message);
    shoppingList = { items: (itemsRes.data ?? []).length > 0 ? [{}] : [] };
  }

  const recipes: Recipe[] = recipeRows.map((row) => {
    const id = String(row.id);
    const hasIngredient = ingredientRecipeIds.includes(id);
    return {
      id,
      mealId: String(row.meal_id),
      servings: 0,
      prepMinutes: 0,
      cookMinutes: 0,
      steps: asSteps(row.steps),
      ingredients: hasIngredient
        ? [{ id: `${id}-ingredient`, name: "ingredient", quantity: 1, unit: "", storeId: "store" }]
        : [],
    };
  });

  return { recipes, shoppingList };
}

export async function supabaseCurrentWeekLocked(
  client: SupabaseClient,
  householdId: string,
): Promise<boolean> {
  const [weeksRes, householdRes] = await Promise.all([
    client
      .from("weeks")
      .select("id, status, starts_on")
      .eq("household_id", householdId)
      .order("starts_on", { ascending: false })
      .limit(8),
    client.from("households").select("timezone, week_starts_on").eq("id", householdId).maybeSingle(),
  ]);
  if (weeksRes.error) throw new Error(weeksRes.error.message);
  if (householdRes.error) throw new Error(householdRes.error.message);
  const today = todayInTimeZone(new Date(), String(householdRes.data?.timezone ?? ""));
  const split = splitOpenWeeks(
    rowsOf(weeksRes.data).flatMap((row) => {
      const status = asWeekStatus(row.status);
      if (!row.id || !status) return [];
      return [{
        status,
        startsOn: typeof row.starts_on === "string" ? row.starts_on.slice(0, 10) : null,
      }];
    }),
    today,
    Number(householdRes.data?.week_starts_on) || 0,
  );
  return split.cooking?.status === "locked" || split.planning?.status === "locked";
}

/** Quiet-wake read. Recipe and shopping rows load only after the week is locked. */
export async function supabaseBotCheckStatus(client: SupabaseClient): Promise<BotCheckStatusResult> {
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return { ok: false, error: "unauthorized" };

  const { data: membership, error: membershipError } = await client
    .from("memberships")
    .select("household_id")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership?.household_id) return { ok: false, error: "no_household" };

  const householdId = String(membership.household_id);
  const { data: householdRow, error: householdError } = await client
    .from("households")
    .select(BOT_STATUS_HOUSEHOLD_COLUMNS)
    .eq("id", householdId)
    .single();
  if (householdError || !householdRow) {
    throw new Error(householdError?.message ?? "Household not found");
  }

  const { data: weekData, error: weekError } = await client
    .from("weeks")
    .select("id, status, starts_on, ballot_mode, finalized_at, night_headcounts, editable_from")
    .eq("household_id", householdId)
    .order("starts_on", { ascending: false })
    .limit(8);
  if (weekError) throw new Error(weekError.message);

  const today = todayInTimeZone(new Date(), String(householdRow.timezone ?? ""));
  const split = splitOpenWeeks(
    rowsOf(weekData).flatMap((row) => {
      if (!row?.id) return [];
      return [{
        id: String(row.id),
        status: asWeekStatus(row.status) ?? "voting",
        startsOn: typeof row.starts_on === "string" ? row.starts_on.slice(0, 10) : null,
        ballotMode: row.ballot_mode === "choice3" ? ("choice3" as const) : ("single" as const),
        finalizedAt: typeof row.finalized_at === "string" ? row.finalized_at : null,
        nightHeadcounts: mapWeekPlates(row.night_headcounts),
        editableFrom: parseEditableFrom(row.editable_from),
      }];
    }),
    today,
    Number(householdRow.week_starts_on) || 0,
  );
  const openWeekRows = [split.cooking, split.planning].flatMap((week) => (week ? [week] : []));

  const botCheck = normalizeBotCheckSetting(
    householdRow.bot_check_mode,
    householdRow.bot_check_interval_hours,
  );
  const household = {
    botCheckMode: botCheck.mode,
    botCheckIntervalHours: botCheck.intervalHours,
    setupStep: clampHouseSetupStep(householdRow.setup_step ?? 8),
    householdSize: clampHouseholdSize(householdRow.household_size ?? householdRow.family_size),
    nightHeadcounts: normalizeNightHeadcounts(householdRow.night_headcounts, {
      coupleNights: householdRow.couple_nights,
      familySize: householdRow.family_size,
      coupleSize: householdRow.couple_size,
    }),
    coupleNights: Array.isArray(householdRow.couple_nights) ? householdRow.couple_nights : [],
    familySize: Number(householdRow.family_size) || 4,
    coupleSize: Number(householdRow.couple_size) || 2,
  };

  if (!openWeekRows.length) {
    return {
      ok: true,
      body: botCheckForSnapshot({
        household,
        meals: [],
        votes: [],
        memberships: [],
      }),
    };
  }

  const statuses = [];
  for (const openWeek of openWeekRows) {
    const [ballotRes, mealsRes] = await Promise.all([
      client
        .from("ballot_requests")
        .select("status, household_size, night_headcounts")
        .eq("household_id", householdId)
        .eq("week_id", openWeek.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("meals")
        .select("id, title, servings, night_date, week_id")
        .eq("household_id", householdId)
        .eq("week_id", openWeek.id),
    ]);
    if (ballotRes.error) throw new Error(ballotRes.error.message);
    if (mealsRes.error) throw new Error(mealsRes.error.message);

    const ballotStatus = parseBallotRequestStatus(ballotRes.data?.status);
    const ballot =
      ballotRes.data && ballotStatus
        ? {
            status: ballotStatus,
            householdSize: clampHouseholdSize(ballotRes.data.household_size),
            nightHeadcounts: normalizeNightHeadcounts(
              Array.isArray(ballotRes.data.night_headcounts)
                ? (ballotRes.data.night_headcounts as number[])
                : null,
            ),
          }
        : null;

    const sole = openWeekRows.length === 1;
    const meals: BotCheckMeal[] = rowsOf(mealsRes.data).flatMap((row) => {
      if (!sole && row.week_id != null && String(row.week_id) !== openWeek.id) return [];
      return [{
        id: String(row.id),
        title: String(row.title ?? ""),
        servings: Number(row.servings),
        nightDate: String(row.night_date),
      }];
    });

    let votes: Vote[] = [];
    let members: Membership[] = [];
    if (meals.length) {
      const mealIds = meals.map((meal) => meal.id);
      const [votesRes, membersRes] = await Promise.all([
        client
          .from("votes")
          .select("id, meal_id, membership_id, choice, updated_at")
          .eq("household_id", householdId)
          .in("meal_id", mealIds),
        client.from("memberships").select("id, role").eq("household_id", householdId),
      ]);
      if (votesRes.error) throw new Error(votesRes.error.message);
      if (membersRes.error) throw new Error(membersRes.error.message);
      members = rowsOf(membersRes.data).flatMap((row) => {
        const role = asRole(row.role);
        if (!role) return [];
        return [{
          id: String(row.id),
          householdId,
          userId: "",
          role,
          displayName: "",
          email: "",
        }];
      });
      votes = rowsOf(votesRes.data).flatMap((row) => {
        const choice = migrateVoteChoice(row.choice);
        if (!choice) return [];
        return [{
          id: String(row.id),
          householdId,
          mealId: String(row.meal_id),
          membershipId: String(row.membership_id),
          choice,
          note: "",
          updatedAt: String(row.updated_at ?? ""),
        }];
      });
    }

    const options: MealOption[] = [];
    let optionRequests: OptionRequest[] = [];
    const choiceOpen =
      openWeek.ballotMode === "choice3" &&
      openWeek.status === "voting" &&
      !openWeek.finalizedAt &&
      ballot != null &&
      ballot.status !== "pending";
    if (choiceOpen) {
      const [optionsRes, requestsRes] = await Promise.all([
        client
          .from("meal_options")
          .select("day_index")
          .eq("household_id", householdId)
          .eq("week_id", openWeek.id),
        client
          .from("meal_option_requests")
          .select("day_index, note")
          .eq("household_id", householdId)
          .eq("week_id", openWeek.id)
          .eq("status", "pending"),
      ]);
      if (optionsRes.error) throw new Error(optionsRes.error.message);
      if (requestsRes.error) throw new Error(requestsRes.error.message);
      const counts = new Map<number, number>();
      for (const row of rowsOf(optionsRes.data)) {
        const day = Number(row.day_index);
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
      for (const [day, count] of counts) {
        for (let rank = 1; rank <= count; rank += 1) {
          options.push({
            id: `${openWeek.id}-${day}-${rank}`,
            householdId,
            weekId: openWeek.id,
            dayIndex: day,
            nightDate: openWeek.startsOn ?? "",
            rank,
            title: "option",
            pitch: "",
            servings: 1,
            prepMinutes: 30,
            recipeKey: null,
          });
        }
      }
      optionRequests = rowsOf(requestsRes.data).map((row) => ({
        id: `${openWeek.id}-req-${String(row.day_index)}`,
        weekId: openWeek.id,
        dayIndex: Number(row.day_index),
        requestedBy: null,
        note: String(row.note ?? ""),
        status: "pending" as const,
      }));
    }

    let recipes: Recipe[] = [];
    let shoppingList: { items: readonly unknown[] } | null = null;
    if (openWeek.status === "locked" && meals.length) {
      const fill = await loadLockedWeekFill(
        client,
        householdId,
        openWeek.id,
        meals.map((meal) => meal.id),
      );
      recipes = fill.recipes;
      shoppingList = fill.shoppingList;
    }

    statuses.push(
      botCheckForSnapshot({
        household,
        meals,
        votes,
        memberships: members,
        ballotRequest: ballot,
        week: {
          id: openWeek.id,
          status: openWeek.status,
          startsOn: openWeek.startsOn,
          ballotMode: openWeek.ballotMode,
          finalizedAt: openWeek.finalizedAt,
          nightHeadcounts: openWeek.nightHeadcounts,
          editableFrom: openWeek.editableFrom,
        },
        recipes,
        shoppingList,
        options,
        optionRequests,
      }),
    );
  }

  return { ok: true, body: preferBotCheckStatus(statuses) };
}
