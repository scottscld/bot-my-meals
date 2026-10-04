import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { grokPromptPaste } from "./install-docs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function readRepo(rel: string) {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function expectPasswordInstallHappyPath(doc: string) {
  expect(doc).toMatch(/Confirm email OFF/);
  expect(doc).toMatch(/email \+ password/);
  expect(doc).toMatch(/Create account/);
  expect(doc).toMatch(/Sign in/);
  expect(doc).toMatch(/not a magic link/);
  expect(doc).toMatch(/Optional later: custom SMTP/);
  expect(doc).toMatch(/\{\{ \.Token \}\}/);
  expect(doc).toMatch(/auth\/callback/);
  expect(doc).toMatch(/login\/new-password/);
  expect(doc).toMatch(/at least 8/);
  expect(doc).toMatch(/no shared household password/i);
  expect(doc).not.toMatch(/Email OTP/);
  expect(doc).not.toMatch(/Send code/);
  expect(doc).not.toMatch(/Add custom SMTP/);
  expect(doc).not.toMatch(/need email codes/);
  expect(doc).not.toMatch(/first sign-in code/);
  expect(doc).not.toMatch(/Email me a sign-in link/);
  expect(doc).not.toMatch(/Enable Email magic link/);
  expect(doc).not.toMatch(/Gmail’s in-app browser/);
  expect(doc).not.toMatch(/open the (?:magic )?link on this same phone/i);
  expect(doc).not.toMatch(/after Request link/);
  expect(doc).not.toMatch(/grandma/i);
  expect(doc).not.toMatch(/email verified/i);
}

function expectWakeInstallPaste(paste: string) {
  expect(paste).toMatch(/Wake on app event/);
  expect(paste).toMatch(/Webhook URL/);
  expect(paste).toMatch(/House → Wake your Bot/);
  expect(paste).toMatch(/BOT_WAKE_WEBHOOK_URL/);
  expect(paste).toMatch(/BOT_WAKE_WEBHOOK_KEY/);
  expect(paste).toMatch(/sender key/);
  expect(paste).toMatch(/webhook trigger/);
  expect(paste).toMatch(/ballot \/ recipes \/ shopping list \/ setup/);
  expect(paste).toMatch(/for the week that needs work/);
  expect(paste).toMatch(/stay quiet if nothing changed/);
  expect(paste).toMatch(/Never NEXT_PUBLIC/);
  expect(paste).toMatch(/do not show the full secret again/i);
  expect(paste).toMatch(/required before Create this week's meals/);
  expect(paste).toMatch(/There is no Skip/);
  expect(paste).toMatch(/fallback/);
  expect(paste).toMatch(/do not create Adaptive/i);
  expect(paste).toMatch(/Required for every household/);
  expect(paste).toMatch(/not optional/);
  expect(paste).toMatch(/setup is incomplete/);
  expect(paste).toMatch(/Install must still create and save the webhook/);
  expect(paste).toMatch(/7\) Create a routine named Wake on app event/);
  expect(paste).toMatch(/Required before Create this week's meals/);
  expect(paste).toMatch(/Do not tap Create this week's meals yet/);
  expect(paste).toMatch(/Then walk house setup through Create this week's meals/);
  const wakeStepAt = paste.indexOf("7) Create a routine named Wake on app event");
  const createMealsAt = paste.indexOf("Tap Create this week's meals");
  expect(wakeStepAt).toBeGreaterThan(-1);
  expect(createMealsAt).toBeGreaterThan(wakeStepAt);
  expect(paste).not.toMatch(/Polling stays the fallback/);
  expect(paste).not.toMatch(/DIY alternative/);
  expect(paste).not.toMatch(/does not require creating a Grok Bot/);
  expect(paste).not.toMatch(/Copy POST to and key/);
  expect(paste).not.toMatch(/NEXT_PUBLIC_BOT_WAKE/);
  expect(paste).not.toMatch(/grandma/i);
}

function expectStripNavigatorInstallPaste(doc: string) {
  expect(doc).toMatch(/horizontal swipe/);
  expect(doc).toMatch(/date strip/);
  expect(doc).toMatch(/edge ‹ ›/);
  expect(doc).toMatch(/they are status, not the switcher/);
  expect(doc).toMatch(/This week/);
  expect(doc).toMatch(/Next week/);
  expect(doc).toMatch(/no chip row/);
  expect(doc).toMatch(/cannot open a week-after-next/);
  expect(doc).toMatch(/titles only/);
  expect(doc).toMatch(/House → Past weeks/);
  expect(doc).toMatch(/Plan next week/);
  expect(doc).toMatch(/0 gap/);
  expect(doc).not.toMatch(/This week \| Next week switcher/);
  expect(doc).not.toMatch(/When both exist, (?:a \*\*)?This week \| Next week/);
  expect(doc).not.toMatch(/the app shows a This week \| Next week switcher/);
}

function expectDualWeekInstallPaste(paste: string) {
  expect(paste).toMatch(/Create this week's meals/);
  expect(paste).toMatch(/do not create a planning week during setup/);
  expect(paste).toMatch(/one cooking week \+ one planning week/);
  expect(paste).toMatch(/Do not open a third week/);
  expect(paste).toMatch(/Home always opens on the cooking week/);
  expectStripNavigatorInstallPaste(paste);
  expect(paste).toMatch(/week-scoped/);
  expect(paste).toMatch(/Waiting, Lock, recipes, shopping, Check now, and Wake/);
  expect(paste).toMatch(/Shopping · This week/);
  expect(paste).toMatch(/Shopping · Next week/);
  expect(paste).toMatch(/never merge cooking \+ planning/);
  expect(paste).toMatch(/Request for next week/);
  expect(paste).toMatch(/planning week/);
  expect(paste).toMatch(/needs_work is true on any open week/);
  expect(paste).toMatch(/Fulfill by week/);
  expect(paste).toMatch(
    /Do not treat a settled cooking week as idle if the planning week still needs work/,
  );
  expect(paste).toMatch(/for the week that needs work/);
  expect(paste).not.toMatch(/7\) Tap Plan next week/);
  expect(paste).not.toMatch(/grandma/i);
}

function expectDualWeekProductLoop(readme: string) {
  expect(readme).toMatch(/Install does not create a planning week/);
  expect(readme).toMatch(/one cooking week \+ one planning week/);
  expectStripNavigatorInstallPaste(readme);
  expect(readme).toMatch(/Shopping · This week/);
  expect(readme).toMatch(/Shopping · Next week/);
  expect(readme).toMatch(/never merge cooking \+ planning/);
  expect(readme).toMatch(/Request for next week/);
  expect(readme).toMatch(/needs_work/);
  expect(readme).not.toMatch(/grandma/i);
}

function expectPlanningPeopleGateInstallPaste(doc: string) {
  expect(doc).toMatch(/People per night(?:\*\*)? first/);
  expect(doc).toMatch(/Special instructions/);
  expect(doc).toMatch(/Off \/ Solo \/ Couple \/ Family/);
  expect(doc).toMatch(/prefill from House defaults/);
  expect(doc).toMatch(/plates above zero/);
  expect(doc).toMatch(/Next week started\. Set people per night/);
  expect(doc).toMatch(/template for new weeks/);
  expect(doc).toMatch(/do(?:es)? not write/i);
  expect(doc).toMatch(/lands on (?:\*\*)?Next week/);
  expect(doc).toMatch(/future swipe or ›/);
  expect(doc).not.toMatch(/the future edge soft-stops or offers Plan next week/);
  expect(doc).not.toMatch(/grandma/i);
}

function expectEditNightsInstallPaste(doc: string) {
  expect(doc).toMatch(/title row has (?:\*\*)?Edit nights/);
  expect(doc).toMatch(/same line as the week title, right-aligned/);
  expect(doc).toMatch(/week-scoped (?:\*\*)?People per night/);
  expect(doc).toMatch(/empty (?:\*\*)?Next week(?:\*\*)? gate/);
  expect(doc).toMatch(/re-open/);
  expect(doc).toMatch(/does not rewrite House defaults/);
  expect(doc).toMatch(/no (?:\*\*)?Edit nights(?:\*\*)? until (?:\*\*)?Unlock/);
  expect(doc).toMatch(/Past weeks: no (?:\*\*)?Edit nights/);
  expect(doc).toMatch(/planning-only/);
  expect(doc).toMatch(/omit on cooking/);
  expect(doc).toMatch(
    /Used when you start a new week\. To change nights on This week or Next week, open that week and tap (?:\*\*)?Edit nights(?:\*\*)?\./,
  );
  expect(doc).toMatch(/template for new weeks/);
  expect(doc).toMatch(/Saving House defaults does not resize\/rewrite/);
  expect(doc).toMatch(/one cooking week/);
  expect(doc).toMatch(/do not create a planning week/i);
  expect(doc).toMatch(/night_headcounts/);
  expect(doc).toMatch(/special_instructions/);
  expect(doc).toMatch(/week_id/);
  expect(doc).not.toMatch(/grandma/i);
}

function expectTitleRowEditNightsWaitingFeedbackPaste(doc: string) {
  expect(doc).toMatch(/title row has (?:\*\*)?Edit nights/);
  expect(doc).toMatch(/same line as the week title, right-aligned/);
  expect(doc).toMatch(/not a free-floating chrome chip below the title/);
  expect(doc).toMatch(/Locked chip still hugs the title/);
  expect(doc).toMatch(/flush under the title row \(0 gap\)/);
  expect(doc).toMatch(
    /Hidden when locked, past, or the empty People gate is already the body/,
  );
  expect(doc).toMatch(
    /Used when you start a new week\. To change nights on This week or Next week, open that week and tap (?:\*\*)?Edit nights(?:\*\*)?\./,
  );
  expect(doc).toMatch(/does not rewrite House defaults/);
  expect(doc).toMatch(/template for new weeks/);
  expect(doc).toMatch(
    /returns to that week with a (?:\*\*)?Waiting(?:\*\*)? card immediately/,
  );
  expect(doc).toMatch(/ballot, blank new night, portions, swap/);
  expect(doc).toMatch(/Waiting for a meal/);
  expect(doc).toMatch(/not [“"]No dinner[”"]/);
  expect(doc).toMatch(/Checking…|Checking\u2026/);
  expect(doc).toMatch(/Waking…|Waking\u2026/);
  expect(doc).toMatch(/Your bot was notified/);
  expect(doc).toMatch(/recipes-and-list line/);
  expect(doc).toMatch(/[Ss]oft-fail re-enables the button/);
  expect(doc).toMatch(/does not claim a wake/);
  expect(doc).toMatch(/message the bot/);
  expect(doc).toMatch(/~30s cooldown/);
  expect(doc).toMatch(/Bot notified/);
  expect(doc).toMatch(/another tap is a no-op/);
  expect(doc).toMatch(/refetches briefly/);
  expect(doc).toMatch(/Waiting leaves when content is ready/);
  expect(doc).toMatch(/do (?:\*\*)?not(?:\*\*)? create Adaptive/i);
  expect(doc).not.toMatch(/silent backend fallback/);
  expect(doc).not.toMatch(/Polling stays the fallback/);
  expect(doc).not.toMatch(/Start that backend routine @every 1h/);
  expect(doc).not.toMatch(/grandma/i);
}

function expectWebhookWaitingInstallPaste(doc: string) {
  expect(doc).toMatch(/configured/);
  expect(doc).toMatch(/Your bot was notified/);
  expect(doc).toMatch(/Wake on app event/);
  expect(doc).toMatch(/webhook trigger/);
  expect(doc).toMatch(/message the Bot|message the bot/);
  expect(doc).toMatch(/do (?:\*\*)?not(?:\*\*)? create Adaptive/i);
  expect(doc).toMatch(/setup is incomplete/);
  expect(doc).toMatch(/required for every household|Required for every household/);
  expect(doc).toMatch(/not optional/);
  expect(doc).toMatch(/before Create this week's meals/);
  expect(doc).toMatch(/before first ballot|first ballot/);
  expect(doc).not.toMatch(/silent backend fallback/);
  expect(doc).not.toMatch(/When Wake is unset/);
  expect(doc).not.toMatch(/Polling stays the fallback/);
  expect(doc).not.toMatch(/Ask your Grok Bot \(optional\)/);
  expect(doc).not.toMatch(/does \*\*not\*\* require creating a Grok Bot/);
  expect(doc).not.toMatch(/DIY alternative/);
  expect(doc).not.toMatch(/cadence\.mode/);
  expect(doc).not.toMatch(/House → Bot check frequency/);
  expect(doc).not.toMatch(/Start that backend routine @every 1h/);
  expect(doc).not.toMatch(/Adaptive cadence/);
  expect(doc).not.toMatch(/countdown-to-next-poll/);
  expect(doc).not.toMatch(/While waiting, the page says how often the Bot checks/);
  expect(doc).not.toMatch(/While you(?:'|’)re waiting, the page says how often the Bot checks/);
  expect(doc).not.toMatch(
    /Bot checks are adaptive\. Start @every 1h while setup is incomplete or work is pending on any open week, otherwise @every 6h\. On each run/,
  );
  for (const para of doc.split(/\n+/)) {
    if (!/@every 1h/.test(para)) continue;
    expect(para).toMatch(/do (?:\*\*)?not(?:\*\*)? create Adaptive/i);
  }
  expect(doc).not.toMatch(/grandma/i);
}

function expectKeepingUpWithTim(doc: string) {
  expect(doc).toMatch(/Keeping up with Tim/);
  expect(doc).toMatch(
    /[Kk]eep up to date with the GitHub repo \[https:\/\/github\.com\/timdoes\/bot-my-meals\]\(https:\/\/github\.com\/timdoes\/bot-my-meals\)/,
  );
  expect(doc).toMatch(/not the Worker hostname/);
  expect(doc).toMatch(/not the marketing site botmymeals\.com/);
  expect(doc).toMatch(/[Pp]ull Tim(?:'|’)s updates/);
  expect(doc).toMatch(/that public repo/);
  expect(doc).toMatch(
    /git remote add upstream https:\/\/github\.com\/timdoes\/bot-my-meals\.git/,
  );
  expect(doc).toMatch(/upstream\/main/);
  expect(doc).toMatch(/Sync fork/);
  expect(doc).toMatch(/rebuilds and redeploys/);
  expect(doc).toMatch(/not \{handle\}\.botmymeals\.com/);
  expect(doc).toMatch(/service-role/);
  expect(doc).toMatch(/NEXT_PUBLIC_SUPABASE_URL|public Supabase URL/);
  expect(doc).not.toMatch(/grandma/i);
}

describe("Install docs — email + password + Wake on app event", () => {
  it("locks Auth, domains, and the #grok-prompt paste on password sign-in and Cos webhook wake", () => {
    const readme = readRepo("README.md");
    const domains = readRepo("docs/domains.md");
    const routines = readRepo("docs/bot-routines.md");
    const paste = grokPromptPaste(readme);

    expect(readme).toContain('id="grok-prompt"');
    expectPasswordInstallHappyPath(readme);
    expectPasswordInstallHappyPath(domains);
    expectPasswordInstallHappyPath(paste);
    expectWakeInstallPaste(paste);
    expectDualWeekInstallPaste(paste);
    expectDualWeekProductLoop(readme);
    expectPlanningPeopleGateInstallPaste(paste);
    expectPlanningPeopleGateInstallPaste(readme);
    expectEditNightsInstallPaste(paste);
    expectEditNightsInstallPaste(readme);
    expectTitleRowEditNightsWaitingFeedbackPaste(paste);
    expectTitleRowEditNightsWaitingFeedbackPaste(readme);
    expectWebhookWaitingInstallPaste(paste);
    expectWebhookWaitingInstallPaste(readme);
    expectKeepingUpWithTim(readme);
    expect(paste).toMatch(/Keeping up with Tim/);
    expect(paste).toMatch(
      /keep up to date with the GitHub repo https:\/\/github\.com\/timdoes\/bot-my-meals/,
    );
    expect(paste).toMatch(/not the Worker hostname, not botmymeals\.com/);
    expect(paste).toMatch(/pull Tim(?:'|’)s updates from that public repo/);
    expect(paste).toMatch(
      /git remote upstream https:\/\/github\.com\/timdoes\/bot-my-meals\.git/,
    );
    expect(paste).toMatch(/Workers Builds then rebuilds and redeploys/);
    expect(paste).toMatch(/Sync fork/);
    expect(paste).toMatch(/not \{handle\}\.botmymeals\.com/);
    expect(paste).toMatch(/Never put service-role in git/);

    expect(paste).toMatch(/Confirm email OFF/);
    expect(paste).toMatch(/email \+ password/);
    expect(paste).toMatch(/Create account/);
    expect(paste).toMatch(/Sign in/);
    expect(paste).toMatch(/\{\{ \.Token \}\}/);
    expect(paste).toMatch(/Optional later: custom SMTP/);
    expect(paste).toMatch(/Do not require custom SMTP/);
    expect(paste).toMatch(/auth\/callback/);
    expect(paste).toMatch(/login\/new-password/);
    expect(paste).toMatch(/at least 8/);
    expect(paste).toMatch(/Site URL/);
    expect(paste).toMatch(/not a magic link/);
    expect(paste).toMatch(/Do not turn on Apple or Google for Install/);
    expect(paste).not.toMatch(/Optional later: passwords/);
    expect(paste).toMatch(/Passkeys later/);
    expect(paste).toMatch(/easy for anyone/);
    expect(paste).toMatch(/cart adds only where the store actually supports them/);
    expect(paste).toMatch(/Do NOT invent prices/);
    expect(paste).toMatch(/Do NOT claim unsupported cart features/);
    expect(paste).not.toMatch(/Email me a sign-in link/);
    expect(paste).not.toMatch(/Enable Email magic link/);
    expect(paste).not.toMatch(/Gmail’s in-app browser/);
    expect(paste).not.toMatch(/open the (?:magic )?link on this same phone/i);
    expect(paste).not.toMatch(/after Request link/);
    expect(paste).not.toMatch(/grandma/i);
    expect(paste).not.toMatch(/no store cart-add claims/);

    expect(readme).toMatch(/3 options/);
    expect(readme).toMatch(/Lock in my vote/);
    expect(readme).toContain("supabase/migrations/20261003120000_three_choice_voting.sql");
    expect(paste).toMatch(/submit_week_options/);
    expect(paste).toMatch(/options_pending/);
    expect(readme).toMatch(/Wake on app event/);
    expect(readme).toMatch(/### 9\. Wake on app event \(required before first ballot\)/);
    expect(readme).toMatch(/### 10\. Add the other adult/);
    expect(readme).toMatch(/Do \*\*not\*\* tap \*\*Create this week's meals\*\* yet/);
    const setupSection = readme.slice(readme.indexOf("## Setup"));
    expect(setupSection.indexOf("### 9. Wake on app event")).toBeLessThan(
      setupSection.indexOf("Tap **Create this week's meals**"),
    );
    expect(readme).toMatch(/Webhook URL/);
    expect(readme).toMatch(/House → Wake your Bot/);
    expect(readme).toMatch(/BOT_WAKE_WEBHOOK_URL/);
    expect(readme).toMatch(/required for every household|Required for every household/);
    expect(readme).toMatch(/setup is incomplete/);
    expect(readme).not.toMatch(/Ask your Grok Bot \(optional\)/);
    expect(readme).not.toMatch(/does \*\*not\*\* require creating a Grok Bot/);
    expect(readme).not.toMatch(/grandma/i);

    expect(routines).toMatch(/Wake on app event/);
    expect(routines).toMatch(/Webhook URL/);
    expect(routines).toMatch(/House → Wake your Bot/);
    expect(routines).toMatch(/BOT_WAKE_WEBHOOK_URL/);
    expect(routines).toMatch(/BOT_WAKE_WEBHOOK_KEY/);
    expect(routines).toMatch(/sender key/);
    expect(routines).toMatch(/Never `NEXT_PUBLIC_`/);
    expect(routines).toMatch(/Saved · Replace/);
    expect(routines).toMatch(/stay quiet if nothing changed/);
    expect(routines).toMatch(/Waiting never shows a schedule/);
    expect(routines).toMatch(/required before Create this week's meals/);
    expect(routines).not.toMatch(/@every/);
    expect(routines).not.toMatch(/Bot check frequency/);
    expect(routines).not.toMatch(/Copy \*\*POST to\*\* \(the webhook URL\) and \*\*key\*\*/);
    expect(routines).not.toMatch(/grandma/i);
    expect(routines).toMatch(/any open week/);
    expect(routines).toMatch(/for the week that needs work/);
    expect(routines).toMatch(/Shopping · This week/);
    expect(routines).toMatch(/Shopping · Next week/);
    expect(routines).toMatch(/do not merge this week with next week/);
    expect(routines).toMatch(/horizontal swipe/);
    expect(routines).toMatch(/date strip/);
    expect(routines).toMatch(/edge ‹ ›/);
    expect(routines).toMatch(/no chip row|not a chip row/);
    expect(routines).toMatch(/status, not the switcher/);
    expect(routines).not.toMatch(/This week \| Next week switcher/);
  });

  it("locks dual-week Install paste after first-ballot setup without forcing a planning week on day 1", () => {
    const readme = readRepo("README.md");
    const routines = readRepo("docs/bot-routines.md");
    const saved = readRepo("docs/saved-meals.md");
    const paste = grokPromptPaste(readme);

    expectPasswordInstallHappyPath(paste);
    expectWakeInstallPaste(paste);
    expectDualWeekInstallPaste(paste);
    expectDualWeekProductLoop(readme);
    expectPlanningPeopleGateInstallPaste(paste);
    expectEditNightsInstallPaste(paste);
    expectEditNightsInstallPaste(readme);
    expectTitleRowEditNightsWaitingFeedbackPaste(paste);
    expectTitleRowEditNightsWaitingFeedbackPaste(readme);
    expectWebhookWaitingInstallPaste(paste);

    const wakeAt = paste.indexOf("create Wake on app event and paste Webhook URL");
    const setupAt = paste.indexOf("walk through house setup");
    const firstBallotAt = paste.indexOf("Tap Create this week's meals");
    const dualWeekAt = paste.indexOf("After the first ballot is live");
    expect(wakeAt).toBeGreaterThan(-1);
    expect(setupAt).toBeGreaterThan(wakeAt);
    expect(firstBallotAt).toBeGreaterThan(setupAt);
    expect(dualWeekAt).toBeGreaterThan(firstBallotAt);

    expect(saved).toMatch(/Request for next week/);
    expect(saved).toMatch(/planning week/);
    expect(saved).toMatch(/Requested for next week/);
    expect(saved).toMatch(/will not open a week after next/);
    expect(saved).toMatch(/do not say this week/);
    expect(saved).toMatch(/Plan next week/);
    expect(saved).toMatch(/same create path/);
    expect(saved).toMatch(/will not invent a third open week/);
    expect(saved).toMatch(/People per night(?:\*\*)? first/);
    expect(saved).toMatch(/Special instructions/);
    expect(saved).toMatch(/Next week started\. Set people per night/);
    expect(saved).toMatch(/template for new weeks/);
    expect(saved).not.toMatch(/grandma/i);

    expect(routines).toMatch(/Waiting titles name/);
    expect(routines).toMatch(/Shopping · This week/);
    expect(routines).toMatch(/fulfill `reason` for the week that needs work/);
    expect(routines).toMatch(/horizontal swipe/);
    expect(routines).toMatch(/not a chip row/);
    expect(routines).toMatch(/People per night(?:\*\*)? first/);
    expect(routines).toMatch(/Special instructions/);
    expect(routines).toMatch(/Waiting never shows a schedule/);
    expect(routines).toMatch(/Your bot was notified/);
    expect(routines).not.toMatch(/silent backend fallback/);
    expect(routines).not.toMatch(/@every/);
    expect(routines).toMatch(/Next week started\. Set people per night/);
    expect(routines).not.toMatch(/While waiting, the page says how often the Bot checks/);
    expect(routines).not.toMatch(/the future edge soft-stops or offers Plan next week/);
  });

  it("locks empty Next week People per night first and webhook-configured Waiting voice", () => {
    const readme = readRepo("README.md");
    const routines = readRepo("docs/bot-routines.md");
    const saved = readRepo("docs/saved-meals.md");
    const paste = grokPromptPaste(readme);

    expectPlanningPeopleGateInstallPaste(paste);
    expectPlanningPeopleGateInstallPaste(readme);
    expectEditNightsInstallPaste(paste);
    expectEditNightsInstallPaste(readme);
    expectTitleRowEditNightsWaitingFeedbackPaste(paste);
    expectTitleRowEditNightsWaitingFeedbackPaste(readme);
    expectWebhookWaitingInstallPaste(paste);
    expectWebhookWaitingInstallPaste(readme);
    expectWakeInstallPaste(paste);
    expectDualWeekInstallPaste(paste);
    expectPasswordInstallHappyPath(paste);

    expect(readme).toContain("20260928233000_planning_people_gate.sql");
    expect(readme).toContain("20260929001000_week_scoped_edit_nights.sql");
    expect(saved).toMatch(/People per night(?:\*\*)? first/);
    expect(saved).toMatch(/Special instructions/);
    expect(routines).toMatch(/Waiting never shows a schedule/);
    expect(routines).not.toMatch(/silent backend fallback/);
    expect(routines).not.toMatch(/@every/);
    expect(routines).toMatch(/People per night(?:\*\*)? first/);
    expect(paste).not.toMatch(/the page says how often the Bot checks/);
    expect(readme).not.toMatch(/the page says how often the Bot checks/);
  });

  it("locks Edit nights on This week / Next week and House defaults as the new-week template", () => {
    const readme = readRepo("README.md");
    const paste = grokPromptPaste(readme);

    expectEditNightsInstallPaste(paste);
    expectEditNightsInstallPaste(readme);
    expectTitleRowEditNightsWaitingFeedbackPaste(paste);
    expectTitleRowEditNightsWaitingFeedbackPaste(readme);
    expectPlanningPeopleGateInstallPaste(paste);
    expectPlanningPeopleGateInstallPaste(readme);
    expectDualWeekInstallPaste(paste);
    expectDualWeekProductLoop(readme);
    expectPasswordInstallHappyPath(paste);
    expectWakeInstallPaste(paste);

    expect(readme).toContain("20260929001000_week_scoped_edit_nights.sql");
    expect(paste).toMatch(/do not create a planning week during setup/);
    expect(readme).toMatch(/Install does not create a planning week/);
  });

  it("locks title-row Edit nights, immediate Waiting after Save, and Check now working-state feedback", () => {
    const readme = readRepo("README.md");
    const paste = grokPromptPaste(readme);

    expectTitleRowEditNightsWaitingFeedbackPaste(paste);
    expectTitleRowEditNightsWaitingFeedbackPaste(readme);
    expectEditNightsInstallPaste(paste);
    expectEditNightsInstallPaste(readme);
    expectWebhookWaitingInstallPaste(paste);
    expectWebhookWaitingInstallPaste(readme);
    expectPlanningPeopleGateInstallPaste(paste);
    expectDualWeekInstallPaste(paste);
    expectPasswordInstallHappyPath(paste);
    expectWakeInstallPaste(paste);

    expect(paste).toMatch(/not a free-floating chrome chip below the title/);
    expect(paste).toMatch(/Waiting for a meal/);
    expect(paste).toMatch(/Checking…|Checking\u2026/);
    expect(paste).toMatch(/Your bot was notified/);
    expect(paste).toMatch(/~30s cooldown/);
    expect(paste).toMatch(/does not claim a wake/);
    expect(readme).toMatch(/not a free-floating chrome chip below the title/);
    expect(readme).toMatch(/Waiting for a meal/);
    expect(readme).toMatch(/does not claim a wake/);
    expect(readme).not.toMatch(/grandma/i);
  });

  it("does not ship a monorepo apps/app README or marketing check-pages", () => {
    expect(existsSync(path.join(repoRoot, "apps/app/README.md"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "apps/marketing/scripts/check-pages.mjs"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "apps/marketing/public/setup/index.html"))).toBe(false);
  });
});
