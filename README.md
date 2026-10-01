# Bot My Meals

This week's dinners, agreed.

Bot My Meals is a household dinner planner: one cooking week of meal titles, plus one next week when you plan ahead. Voting adults you add yourself, and recipes plus a store-split shopping list for that week only after it locks. It is a phone-first installable PWA. The data model is household-scoped from day one so a later paid multi-household product does not require a rewrite.

This is a public household PWA template (v1 for one family). There is no billing and no invented grocery prices. This README is the public setup guide.

Install a **real Cloudflare Worker + Supabase Free so both phones stay in sync.** Never demo/localStorage as the product path. If the two public keys are missing or invalid, every route shows the **setup gate** — not a household on this phone. Only two public keys; never service-role in git or Worker. Never invent grocery prices. Cart adds only where the store actually supports them — don’t claim Smith’s or any store cart add unless it’s real. Do NOT invent prices. Do NOT claim unsupported cart features.

## The loop

A new **This week** starts empty: **No dinners yet.** Empty week is one of these CTAs — no Seed / sample week:

- Setup incomplete → **Finish house setup**
- Setup done, no request → **Create this week's meals** (writes `ballot_requests` via `request_week_ballot()`)
- Pending → **Waiting for your Bot…**
- Ballot live → normal dual-approve UI

Once dinners are on the week:

1. A week has seven proposed dinners (title, who eats, servings, time, one-line pitch).
2. Each voting member can **Swap** or **Remove** a night. No tap leaves the dinner as-is.
3. Actions are visible live. A swap can include a note (“too heavy”, “want tacos”).
4. The week **locks after swaps and dinner requests are cleared.** Removed nights and untouched dinners do not block lock.
5. After lock: full recipes and a merged shopping list, split by store. Removed nights are omitted. Prices stay blank unless a real source and as-of date exist.
6. Before lock, the list screen shows meal titles only.

Swap a night, propose a replacement (or mark leftovers from an earlier night), and that row’s votes reset.

Day one is that one cooking week. Install does not create a planning week during setup.

After the first ballot is live, the house may also open **one** next week while still cooking this week. Cap is one cooking week + one planning week — no third open week. Home always opens on the cooking week. Change week with a **horizontal swipe** on the date strip (or the optional edge ‹ ›). Title row labels stay **This week** / **Next week** / a past date range — they are status, not the switcher. There is no chip row. The strip continuum is finished weeks ↔ cooking ↔ planning when that week exists; it cannot open a week-after-next. Title and strip sit flush (0 gap). Past via the strip is titles only; **House → Past weeks** still lists the same weeks and opens that week in the strip. With no planning week yet, a future swipe or › from cooking creates **Next week** (same create path as **Plan next week** / Saved → **Request for next week**), lands on **Next week**, and shows **People per night** first — all 7 nights, Off / Solo / Couple / Family steppers, prefill from House defaults, optional **Special instructions** on the same step (empty OK; week-scoped). Save requires at least one night with plates above zero. Then that week’s ballot / Ask Bot / Waiting. Toast after swipe-create: **Next week started. Set people per night.** From planning, a further future swipe cannot open a week-after-next. Waiting, Lock, recipes, shopping, Check now, and Wake follow the week on screen. When **House → Wake your Bot** / `BOT_WAKE` is configured (`configured` true), Waiting / Check now is wake / instant / **Your bot was notified** only. Without wake configured, setup is incomplete — **Check now** still means **message the Bot**, but Install must still create and save the webhook. **Do not** create Adaptive / `@every 1h` / `@every 6h` bot-check routines. Waiting and shopping titles name **This week** or **Next week** (`Shopping · This week` / `Shopping · Next week`). Each week has its own shopping list — never merge cooking + planning. Saved → **Request for next week** targets the planning week and creates that row if it is missing (People per night before that week’s ballot).

On **This week** or **Next week** (when edit is allowed), the title row has **Edit nights** on the same line as the week title, right-aligned — not a free-floating chrome chip below the title. It opens week-scoped **People per night** for that week (same control language as the empty **Next week** gate). The **Locked** chip still hugs the title. Date strip stays flush under the title row (0 gap). Hidden when locked, past, or the empty People gate is already the body. It works after a ballot or meals exist (re-open), not only the empty planning gate. Save updates that week’s plates/meals only — it does not rewrite House defaults. A locked week has no **Edit nights** until **Unlock** on the viewed week. Past weeks: no **Edit nights**. **Special instructions** stay planning-only on that editor (omit on cooking unless the week already has a note). After **Edit nights** Save, re-saved `night_headcounts` (plus `special_instructions` on planning) are what Meal Ops / the bot reads for that `week_id`. Closing **Edit nights** or the People gate returns to that week with a **Waiting** card immediately when the bot still has work (ballot, blank new night, portions, swap). A new blank night shows **Waiting for a meal…** (not “No dinner”).

Each household sets **People per night** (Sun–Sat) under **House**. That count is the **template** for new weeks only. Used when you start a new week. To change nights on This week or Next week, open that week and tap **Edit nights**. Saving House defaults does not resize/rewrite open cooking or planning week headcounts. Zero is an **Off night** (no dinner planned). One is **Solo night**. Two is **Couple night**. Any other count is **Family night**. Setup asks household size, then nights this week (1–7); active nights default to household size. Admins can change any night (0–12). Saving plates or **Special instructions** on empty **Next week** does not write onto House defaults.

**Check now** / **Get recipes now** shows **Checking…** / **Waking…** until the request settles, then **Your bot was notified…** (recipes keep the recipes-and-list line). Soft-fail re-enables the button. With no webhook, setup is incomplete — the tap asks you to message the bot and does not claim a wake. Install must still create and save the webhook. **Do not** create Adaptive / `@every 1h` / `@every 6h` bot-check routines. After a successful wake, ~30s cooldown (**Bot notified**) so another tap is a no-op. While work is pending, the week refetches briefly then Waiting leaves when content is ready. When Wake / `BOT_WAKE` is configured, Waiting / Check now is wake / **Your bot was notified** only.

**Users** can swap or remove a night. **Admins** also manage people, stores, people-per-night, and unlock the week. The last Admin cannot be removed or demoted.

A new household starts with **no stores**. Admins enter a zip or postal code and pick regional grocers from a static list, or type **Add a store**. Labels only — never invent grocery prices; cart adds only where the store actually supports them (don’t claim Smith’s or any store cart add unless it’s real). Trader Joe’s and Smith’s are not inserted on create.

## Setup

Do these in order. Phones stay in sync only after a real Worker, a new Supabase Free project, Auth, and the two public env vars all point at the same HTTPS origin. **Wake on app event** is required for every household — same path as Worker / Supabase / env. Without that webhook created and saved, setup is incomplete.

**Order that matters**

1. Deploy (or already know the **final HTTPS origin** phones will open) **before** setting Supabase Site URL.
2. Finish Auth + the two public env vars **before** creating the Admin or adding a partner.
3. **Add to Home Screen** can happen as soon as the HTTPS URL works (Safari **Share → Add to Home Screen**). Do not wait for household creation. Sign-in and adding people still need email + password + env.
4. Save **Wake on app event** in **House → Wake your Bot** **before** **Create this week's meals** (before the first ballot).

Missing, blank, or invalid `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` is an **incomplete install**. The app **builds** without those values, but every route shows the first-run **setup gate** (“Set up the real house”) until they are set and the Worker is rebuilt / redeployed. There is no localStorage household fallback.

### 1. Create a free Cloudflare account

Sign up at [Cloudflare](https://dash.cloudflare.com/sign-up). The free plan is enough.

You will also need a GitHub account so Cloudflare can connect a repo (see whose repo in step 2).

### 2. Deploy Worker `bot-my-meals` with Workers Builds

This is the easy default for anyone. Cloudflare dashboard → connect GitHub to Worker **`bot-my-meals`**. Do **not** start with a terminal `npm run deploy` (that is only for people who already develop).

1. Open the Cloudflare dashboard.
2. Create or open the Worker named **`bot-my-meals`**.
3. Go to **Settings → Builds**.
4. Connect the GitHub repo (see whose repo below).
5. Use this table:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | leave blank (repo root) |
| Build command | `npm run build:worker` |
| Deploy command | `node scripts/cf-deploy.mjs` |
| Non-production branch deploy command | `npm run deploy:preview` |
| Build watch paths — Include | `src/*, public/*, scripts/*, package.json, package-lock.json, .npmrc, wrangler.jsonc, open-next.config.ts, next.config.ts` |
| Build watch paths — Exclude | (leave empty, or exclude docs-only paths if you prefer) |

`npm run build:worker` (not bare `npx opennextjs-cloudflare build`) and `npm run deploy` (root or this repo) still target Worker **`bot-my-meals`**. `scripts/cf-deploy.mjs` promotes on `main` and uploads preview versions on other branches. If the Cloudflare dashboard still has the old build command `npx opennextjs-cloudflare build`, change it to `npm run build:worker`. That is a **command** update, not a hostname/DNS change. Managed staging is a different Worker and command: [`docs/managed-staging.md`](docs/managed-staging.md).

Watch paths and click-by-click: [`docs/workers-builds.md`](docs/workers-builds.md).

Save and let the first build finish.

**Whose GitHub repo to connect**

- Use **Use this template** or **Fork** on GitHub, then connect **your** copy to Workers Builds.
- Keep up to date with the GitHub repo [https://github.com/timdoes/bot-my-meals](https://github.com/timdoes/bot-my-meals): [Keeping up with Tim](#keeping-up-with-tim).

**Whose HTTPS origin**

- **DIY / households:** `https://bot-my-meals.<your-subdomain>.workers.dev`, or a custom domain **you** attach to **your** Worker. Not `{handle}.botmymeals.com`.
- Do not use `{handle}.botmymeals.com` — that is not a DIY hostname.

Do not use `www.botmymeals.com` as the app.

**Know this HTTPS origin now.** Site URL and the Auth redirect must match the host people actually open (custom domain or workers.dev — no `www` unless configured). Set Auth to that origin before anyone taps **Create account**. Auth allowlist details: [`docs/domains.md`](docs/domains.md).

Once this URL loads, you may already **hand back the HTTPS URL + Safari Add to Home Screen**. You do not need a household first. Without the two public keys, the page shows the setup gate — finish Auth + env before creating the Admin.

Hosting is Cloudflare Workers, Wrangler, and [OpenNext for Next.js](https://opennext.js.org/cloudflare). Not Vercel.

### 3. Create a new Supabase Free project

Create a **new** project. Do not reuse another app’s database.

A Las Vegas-adjacent region (`us-west-1`) is fine.

### 4. Run every migration, in filename order

The app needs **all nine** files under [`supabase/migrations/`](supabase/migrations/). Paste each into the Supabase SQL Editor and run it, in this order — or use `supabase db push` if the CLI is already linked to this project.

1. `supabase/migrations/20260902120000_init.sql`
2. `supabase/migrations/20260909120000_night_headcounts.sql`
3. `supabase/migrations/20260909130000_manage_members.sql`
4. `supabase/migrations/20260912205000_ballot_passive_lock.sql`
5. `supabase/migrations/20260913154500_off_night_headcounts.sql`
6. `supabase/migrations/20260917120000_grant_private_schema_usage.sql`
7. `supabase/migrations/20260917140000_house_setup_join_tokens.sql`
8. `supabase/migrations/20260917160000_wizard_v2_ballot_request.sql`
9. `supabase/migrations/20260927040000_bot_check_cadence.sql`

Skipping a file (or running them out of order) will break people, lock, off nights, or the post-create setup / invite link. File 6 grants `authenticated` `USAGE` on schema `private` — without it, Create household can succeed while you stay on **Create household**. File 7 adds `/join/<token>` links. File 8 is wizard v2 (`household_size`, `nights_planned`, `postal_code`, `ballot_requests`, no default Trader Joe’s / Smith’s on create). File 9 is `20260927040000_bot_check_cadence.sql` — run it with the others; it is not Install teaching for bot-check routines.

After those nine, run every later file in [`supabase/migrations/`](supabase/migrations/) in filename order. That includes meal history, store slugs, week chrome, `supabase/migrations/20260928183000_saved_meals.sql` (household Saved meals), `supabase/migrations/20260928210000_planning_week.sql` (one cooking week plus one next week), `supabase/migrations/20260928233000_planning_people_gate.sql` (this next week’s plates and optional special instructions; saving them does not change House defaults), `supabase/migrations/20260929001000_week_scoped_edit_nights.sql` (Edit nights on the week you are viewing, including this cooking week; House defaults stay the template for new weeks), and `supabase/migrations/20260930040000_saved_meal_cook_night.sql` (Saved meals "Last cooked" is that dinner's night, not the week lock). See [`docs/saved-meals.md`](docs/saved-meals.md).

### 5. Auth: Email on, Confirm email OFF

Do this only after you know the final HTTPS origin from step 2.

**Install sign-in is email + password** in the app — the installed Home Screen app, or the Safari tab you will Add to Home Screen. People tap **Create account** or **Sign in** and stay in that app. They do not finish sign-in by tapping a link in Mail. People use email + password in the app — not a magic link.

In Supabase → **Authentication**:

1. **Providers → Email** on.
2. **Confirm email: OFF.** Required so **Create account** returns a session in the app (important on iPhone Home Screen). Do not treat that as proof they own the inbox.
3. **Site URL** = the **same** HTTPS origin phones will open.
4. **Redirect URLs** include `https://<that-host>/auth/callback` and `https://<that-host>/login/new-password` for password reset (and a leftover link).
5. If a password minimum is shown, set it to **at least 8**.
6. Skip Google, Apple, and other SSO.

Do **not** set up custom SMTP or edit Auth email templates to install. Optional later: custom SMTP + a code in the email template (`{{ .Token }}`) for sign-in codes. Keep email + password if you add that. Do not turn Confirm email ON with a link-only template.

Examples for Site URL / Redirect URL:

- DIY: your workers.dev or your domain, `https://<that-host>/auth/callback`, and `https://<that-host>/login/new-password`
- Keep workers.dev on the allowlist if anyone still opens that host

**Set Site URL to the final phone URL before anyone taps Create account.** Changing the host later means updating Auth.

Forgot password emails a link. It may open in the phone’s browser. Set the new password, then open the Home Screen app and sign in. Free built-in mail may only reach the project’s team addresses (about 2 an hour) until custom SMTP. A partner invite is the reliable way back in. Passkeys are not part of install. Only the two public keys in the next step; there is no localStorage sign-in. Leaked-password checks are a paid Supabase option, not part of Free Install.

### 6. Set the two public env vars, then rebuild / redeploy

On the Worker (Worker variables **and** Builds variables, so the next build can see them), set **only** these two public keys:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Copy both from the Supabase project settings (Project URL and anon / public key).

Then **rebuild / redeploy** so Next picks them up. Setting the vars without a new build leaves the setup gate up (the running site still behaves as if they are missing).

**Never** put the Supabase **service-role** key in Worker vars, Builds vars, git, `.env.local`, `.dev.vars`, or `wrangler.jsonc`. Only two public keys; never service-role in git or Worker.

### 7. Hand back the HTTPS URL + Safari Add to Home Screen

Open the origin from step 2 on the phone.

On iPhone Safari: **Share → Add to Home Screen**. You can do this as soon as the URL works. Do not block A2HS on household creation.

The app ships a web manifest, service worker (offline shell), apple-touch icon, standalone display, and `viewport-fit=cover` safe areas.

Admin and partner sign-in still need Auth + the two env vars (steps 5–6). If you still see the setup gate, the install is incomplete — finish env and redeploy before creating the household.

### 8. First signed-in person creates the household (Admin)

Auth + env first. Then, on that phone:

1. Tap **Create account**.
2. Enter your email and a password of at least 8 characters. You stay in this app — no mail to open.
3. After that you will see **Create household**.
4. Enter a household name and tap **Create household**.
5. Do **not** tap **Create this week's meals** yet. Save Wake first ([step 9](#9-wake-on-app-event-required-before-first-ballot)), then walk house setup.

That person becomes the first **Admin**. Nobody is hard-coded. There is no Tim or Rose to recreate.

If Create household seems to work (or fails quietly) but you stay on **Create household** and never reach This week / House, the database grant is missing — see [Gotchas](#gotchas).

A household is a **Supabase row** on this same Worker — not a second Worker.

### 9. Wake on app event (required before first ballot)

Required for every household — not optional. Same Install path as the Worker, Supabase, and the two public env vars. Do this **before** **Create this week's meals** / the first ballot. Without this webhook created and saved, setup is incomplete.

1. Create a routine named exactly **Wake on app event** with a webhook trigger.
2. On wake it syncs ballot / recipes / shopping list / setup for the week that needs work, and stays quiet if nothing changed.
3. Copy **Webhook URL** (the panel may say **POST to**) and the **sender key** if the panel shows one.
4. Paste them in **House → Wake your Bot**, or set Worker secrets `BOT_WAKE_WEBHOOK_URL` and optional `BOT_WAKE_WEBHOOK_KEY`. Never `NEXT_PUBLIC_` for these. After save, the app does not show the full secret again.

When Wake is configured, Waiting / Check now is wake / **Your bot was notified** only. Without the webhook saved, **Check now** still means **message the Bot** — setup is still incomplete. Install must create and save this webhook. **Do not** create Adaptive / `@every 1h` / `@every 6h` bot-check routines.

#### Then walk house setup through Create this week's meals

After Wake is saved, walk through house setup (no Seed/sample week). Progress is **Setup · step N of 7**.

1. **Invite people** — share `https://<our-host>/join/<token>` via share sheet (invite links only). Partner opens the link, then creates an account with their own email and password (or signs in). There is no shared household password.
2. **How many people?** — household size stepper.
3. **Which nights?** — Sun–Sat toggles, all on by default. Easy off per day.
4. **Optional:** adjust plates on On nights (guests / couple nights).
5. **Stores** — enter zip/postal, multi-select regional grocers, or type in a store. No default stores. Labels only — never invent grocery prices; cart adds only where the store actually supports them.
6. **Optional** weekly meal budget (or skip).
7. **Wake your Bot** is required before **Create this week's meals**. Paste the Webhook URL on this step. The button stays off until it is saved. There is no Skip. After save: **Saved. Create this week’s meals will wake your bot.** Tap **Create this week's meals** — app writes a ballot request and shows **Waiting for your Bot…** until the ballot appears. **Copy paste for your Grok Bot** is DIY fallback only (collapsed).

Empty This week: **Finish house setup** (if incomplete), **Create this week's meals** / **Waiting for your Bot…** (if setup done), or the dual-approve ballot when it lands. When **House → Wake your Bot** / `BOT_WAKE` is configured (`configured` true), Waiting / Check now is wake / instant / **Your bot was notified** only.

After that first ballot, you can plan next week while still cooking this week. Do not create a planning week during Install. Cap is one cooking week + one planning week. Home stays on cooking. Change week with a **horizontal swipe** on the date strip (or the optional edge ‹ ›). Title labels stay **This week** / **Next week** / a past date range — they are status, not the switcher. There is no chip row. Title and strip sit flush (0 gap). Past via the strip is titles only; **House → Past weeks** still works. With no planning week yet, a future swipe or › from cooking creates **Next week** (same create path as **Plan next week** / Saved Request), lands on **People per night** first (optional **Special instructions** on the same step; empty OK), then that week’s ballot. Toast: **Next week started. Set people per night.** House **People per night** stays the template for new weeks only. Used when you start a new week. To change nights on This week or Next week, open that week and tap **Edit nights**. Saving House defaults does not resize/rewrite open cooking or planning week headcounts. On **This week** or **Next week** (when edit is allowed), the title row has **Edit nights** on the same line as the week title, right-aligned — not a free-floating chrome chip below the title. It opens week-scoped **People per night** for that week (same control language as the empty **Next week** gate). The **Locked** chip still hugs the title. Date strip stays flush under the title row (0 gap). Hidden when locked, past, or the empty People gate is already the body. It works after a ballot or meals exist (re-open), not only the empty planning gate. Save updates that week’s plates/meals only — it does not rewrite House defaults. A locked week has no **Edit nights** until **Unlock** on the viewed week. Past weeks: no **Edit nights**. **Special instructions** stay planning-only on that editor (omit on cooking unless the week already has a note). After **Edit nights** Save, re-saved `night_headcounts` (plus `special_instructions` on planning) are what Meal Ops / the bot reads for that `week_id`. Closing **Edit nights** or the People gate returns to that week with a **Waiting** card immediately when the bot still has work (ballot, blank new night, portions, swap). A new blank night shows **Waiting for a meal…** (not “No dinner”). Waiting and shopping titles name the week. Shopping lists stay per week. Saved → **Request for next week** opens the planning week (creates it if missing). Wake treats `needs_work` on any open week — a settled cooking week is not idle if next week still needs work.

**Check now** / **Get recipes now** shows **Checking…** / **Waking…** until the request settles, then **Your bot was notified…** (recipes keep the recipes-and-list line). Soft-fail re-enables the button. With no webhook, setup is incomplete — the tap asks you to message the bot and does not claim a wake. Install must still create and save the webhook. **Do not** create Adaptive / `@every 1h` / `@every 6h` bot-check routines. After a successful wake, ~30s cooldown (**Bot notified**) so another tap is a no-op. While work is pending, the week refetches briefly then Waiting leaves when content is ready. When Wake / `BOT_WAKE` is configured, Waiting / Check now is wake / **Your bot was notified** only.

### 10. Add the other adult

Share the textable invite link from setup step 1 or **House → Invite** (**Share invite link**). The URL looks like `https://<host>/join/<token>`. Optional share text: “Join our Bot My Meals house — open this on your phone:” plus the URL. Invite links only — there is no code to type. Partner opens the link on their phone, then creates their own account.

You can still **House → People** → **Add a person** (name, email, Admin or User). They appear under **Waiting to sign in** until they sign in. Bot My Meals does not email this invite. There is no SMS gateway.

On the second phone they:

1. Open the **invite link** on that phone (or the same HTTPS origin, then sign in).
2. Add to Home Screen if they want (Safari **Share → Add to Home Screen**) — they do not need a household first.
3. New person: **Create account** with **their** email and password in the app (or **Sign in** if they already have one). The app claims the invite and puts them in the house. There is no shared household password.
4. Already signed in: tap **Continue**.
5. Expired, used, or invalid link: the page says why and asks them to get a new link.

**Users** can vote. **Admins** can also manage the house.

Row Level Security is household-scoped (`household_id`). Admins manage memberships (`set_member_role`, `remove_member`) and `household_invites`. Recipes and shopping rows are readable only after that household’s week is locked. A database trigger refuses to lock if a swap or dinner request is still open. The last Admin cannot be removed or demoted.

## Gotchas

- **Missing env = incomplete install.** Blank, unset, or invalid `NEXT_PUBLIC_*` shows the **setup gate** on every route. That is not a household. Do not stop at “try it without Supabase.” There is no localStorage household fallback.
- **Wake webhook is required before Create this week's meals.** Without **House → Wake your Bot** / `BOT_WAKE` saved, setup is incomplete. **Check now** still means message the Bot. Do not skip [step 9](#9-wake-on-app-event-required-before-first-ballot).
- **Stuck on Create household.** Create household can look like it worked (or fail with no message) while you never enter This week / House. Likely cause: migrations incomplete — `authenticated` needs `USAGE` on schema `private`. Run every file in [step 4](#4-run-every-migration-in-filename-order) in order, including `20260917120000_grant_private_schema_usage.sql`, then hard-refresh.
- **Vars need a rebuild.** After setting the two public keys, rebuild/redeploy so Next inlines them.
- **`npm run deploy` is not the easy household path.** If you already develop: it only promotes production from `main`; any other branch → preview upload only (`wrangler versions upload`).
- **Confirm email stays OFF.** Create account and Sign in happen in the app. A confirm link opens outside the Home Screen app. Do not treat that as proof they own the inbox.
- **Forgot password uses a link.** Set the new password in the browser that opens the email, then open the Home Screen app and sign in. Free built-in mail may only reach the project’s team addresses until custom SMTP. Ask a partner for a new invite if email doesn’t arrive. House → People does not email anyone.
- **Optional later: custom SMTP** plus `{{ .Token }}` in the Auth email template for sign-in codes. Not required to install.
- **RLS is household-scoped.** Other families cannot see this table. The last Admin cannot be removed or demoted.
- **One Worker name.** Script name `bot-my-meals`. Same Cloudflare account → name collision if you try to reuse it. Households are extra Supabase rows, not extra Workers.

## Rules we do not break

- Real Cloudflare Worker + Supabase Free so both phones stay in sync.
- Never demo/localStorage as the product path. Missing keys show the setup gate, not a phone-only household.
- Only two public keys; never service-role in git or Worker.
- Hand back HTTPS URL + Safari Add to Home Screen.
- Never invent grocery prices. Cart adds only where the store actually supports them — don’t claim Smith’s or any store cart add unless it’s real. Do NOT invent prices. Do NOT claim unsupported cart features.

## Keeping up with Tim

Keep up to date with the GitHub repo [https://github.com/timdoes/bot-my-meals](https://github.com/timdoes/bot-my-meals). That is Tim’s public code — not the Worker hostname and not the marketing site botmymeals.com. You used **Use this template** or **Fork**, so your house runs from **your** GitHub copy. Pull Tim’s updates from that public repo when you want them, then Workers Builds rebuilds and redeploys.

**One-time:** add that public repo as a git remote named `upstream` (skip this if you already have it):

```bash
git remote add upstream https://github.com/timdoes/bot-my-meals.git
```

**When you want Tim’s updates**, fetch and merge from that remote into **your** `main`:

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

If you **Fork**ed on GitHub, you can instead open your fork → **Sync fork**. That pulls Tim’s updates from [https://github.com/timdoes/bot-my-meals](https://github.com/timdoes/bot-my-meals) into your `main`. A **Use this template** copy is not a fork, so it has no Sync button — use the commands above.

Cloudflare **Workers Builds** then rebuilds and redeploys Worker `bot-my-meals` when those `main` changes match the watch paths. Let that build finish.

**Leave your host alone.** Site URL and Redirect URLs stay **your** workers.dev or **your** custom domain. Do not change them to `{handle}.botmymeals.com`.

**Never** put the Supabase **service-role** key in git. Only the two public keys belong in Worker / Builds vars: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

If the merge adds files under [`supabase/migrations/`](supabase/migrations/), run the new ones in filename order (same as [step 4](#4-run-every-migration-in-filename-order)).

## Ask your Grok Bot

Paste this so the Bot walks the same Install path. **Wake on app event** is required for every household — not optional.

<a id="grok-prompt"></a>

```
Set up Bot My Meals for our household. Use only free Cloudflare Workers + Supabase Free — no localStorage/demo-only path.


Do this, one decision at a time if you need me to click:
1) Help me create a Cloudflare account and deploy the Worker named bot-my-meals from https://github.com/timdoes/bot-my-meals via Workers Builds (Cloudflare dashboard → connect GitHub). Terminal npm run deploy only if I already develop.
2) Create a new Supabase Free project.
3) Run every file in supabase/migrations/ in filename order (SQL editor or supabase db push).
4) Turn on Email sign-in. Turn Confirm email OFF so people create an account and stay in the app (important on iPhone Home Screen). Set Site URL to our HTTPS origin, and add /auth/callback and /login/new-password (our workers.dev or our own domain — not {handle}.botmymeals.com). People use email + password in the app — not a magic link. If a password minimum is shown, set it to at least 8. Optional later: custom SMTP + a code in the email template ({{ .Token }}) for sign-in codes. Do not turn on Apple or Google for Install. Passkeys later. Do not require custom SMTP to install.
5) Set only these two public Worker env vars, then redeploy: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. Never use the service-role key.
6) Give me the HTTPS link, walk me through Add to Home Screen, and create the household Admin. Do not tap Create this week's meals yet.
7) Create a routine named Wake on app event with a webhook trigger. Required for every household — not optional. Same path as Worker / Supabase / env. Required before Create this week's meals / the first ballot. On wake, sync ballot / recipes / shopping list / setup for the week that needs work; stay quiet if nothing changed. Copy Webhook URL (the panel may say POST to) and the sender key if the panel shows one. Paste them into House → Wake your Bot, or set Worker secrets BOT_WAKE_WEBHOOK_URL and optional BOT_WAKE_WEBHOOK_KEY. Never NEXT_PUBLIC for these. After save, do not show the full secret again. The Worker sends the key as Authorization: Bearer. Without wake configured, setup is incomplete — Check now still means message the Bot, but Install must still create and save the webhook. Do not create Adaptive / @every 1h / @every 6h bot-check routines.
8) Then walk house setup through Create this week's meals. Add my partner (share the /join/<token> link; House → People still works).

Keeping up with Tim: keep up to date with the GitHub repo https://github.com/timdoes/bot-my-meals (not the Worker hostname, not botmymeals.com). If we Used this template or Forked, pull Tim’s updates from that public repo (add git remote upstream https://github.com/timdoes/bot-my-meals.git — skip if present — then fetch + merge into our main, or GitHub Sync fork). Workers Builds then rebuilds and redeploys. Site URL / Redirect URLs stay our host — not {handle}.botmymeals.com. Never put service-role in git; only the public Supabase URL + anon key.

Sign-in: Create account or Sign in with email and password in the app. You stay in the app. Do not finish sign-in by tapping a link in Mail.

After Create household, create Wake on app event and paste Webhook URL into House → Wake your Bot (required before Create this week's meals / the first ballot). Then walk through house setup (no Seed/sample week):
1) Invite people — share https://<our-host>/join/<token> via share sheet (invite links only). Partner opens the link, then creates their own account with their email and password, or signs in. There is no shared household password.
2) How many people? — household size stepper.
3) Which nights? — Sun–Sat toggles, all on by default. Easy off per day.
4) Optional: adjust plates on On nights (guests / couple nights).
5) Stores — enter zip/postal, multi-select regional grocers, or type in a store. No default stores. Labels only — never invent grocery prices; cart adds only where the store actually supports them.
6) Optional weekly meal budget (or skip).
7) Wake your Bot is required before Create this week's meals. Paste the Webhook URL on this step. Create this week's meals stays off until it is saved. There is no Skip. After save: Saved. Create this week’s meals will wake your bot. Tap Create this week's meals — app writes a ballot request and shows Waiting for your Bot… until the ballot appears. Copy paste for your Grok Bot is DIY fallback only (collapsed).
Empty This week: Finish house setup (if incomplete), Create this week's meals / Waiting for your Bot… (if setup done), or the dual-approve ballot when it lands. When House → Wake your Bot / BOT_WAKE is configured (configured true), Waiting / Check now is wake / instant / Your bot was notified only. Without wake configured, setup is incomplete — Check now still means message the Bot, but Install must still create and save the webhook. Do not create Adaptive / @every 1h / @every 6h bot-check routines.

After the first ballot is live, the house may also plan next week while cooking this week. Day-1 Install is still one cooking week — do not create a planning week during setup.

Cap: one cooking week + one planning week. Do not open a third week. Home always opens on the cooking week. Change week with a horizontal swipe on the date strip (or the optional edge ‹ ›). Title row labels stay This week / Next week / a past date range — they are status, not the switcher. There is no chip row. The strip continuum is finished weeks ↔ cooking ↔ planning when that week exists; it cannot open a week-after-next. Title and strip sit flush (0 gap). Past via the strip is titles only; House → Past weeks still lists the same weeks and opens that week in the strip. With no planning week yet, a future swipe or › from cooking creates Next week (same create path as Plan next week / Saved → Request for next week), lands on Next week, and shows People per night first — all 7 nights, Off / Solo / Couple / Family steppers, prefill from House defaults, optional Special instructions on the same step (empty OK; week-scoped). Save requires at least one night with plates above zero. Then that week’s ballot / Ask Bot / Waiting. Toast after swipe-create: Next week started. Set people per night. House → People per night stays the template for new weeks only — do not write this week’s plates or Special instructions onto House defaults. Used when you start a new week. To change nights on This week or Next week, open that week and tap Edit nights. Saving House defaults does not resize/rewrite open cooking or planning week headcounts. From planning, a further future swipe cannot open a week-after-next. Waiting, Lock, recipes, shopping, Check now, and Wake are week-scoped. Waiting and shopping titles name This week or Next week (Shopping · This week / Shopping · Next week). Each week has its own shopping list — never merge cooking + planning.

On This week or Next week (when edit is allowed), the title row has Edit nights on the same line as the week title, right-aligned — not a free-floating chrome chip below the title. It opens week-scoped People per night for that week (same control language as the empty Next week gate). The Locked chip still hugs the title. Date strip stays flush under the title row (0 gap). Hidden when locked, past, or the empty People gate is already the body. It works after a ballot or meals exist (re-open), not only the empty planning gate. Save updates that week’s plates/meals only — it does not rewrite House defaults. A locked week has no Edit nights until Unlock on the viewed week. Past weeks: no Edit nights. Special instructions stay planning-only on that editor (omit on cooking unless the week already has a note). After Edit nights Save, re-saved night_headcounts (plus special_instructions on planning) are what Meal Ops / the bot reads for that week_id. Closing Edit nights or the People gate returns to that week with a Waiting card immediately when the bot still has work (ballot, blank new night, portions, swap). A new blank night shows Waiting for a meal… (not “No dinner”).

Check now / Get recipes now shows Checking… / Waking… until the request settles, then Your bot was notified… (recipes keep the recipes-and-list line). Soft-fail re-enables the button. With no webhook, setup is incomplete — the tap asks you to message the bot and does not claim a wake. Install must still create and save the webhook. Do not create Adaptive / @every 1h / @every 6h bot-check routines. After a successful wake, ~30s cooldown (Bot notified) so another tap is a no-op. While work is pending, the week refetches briefly then Waiting leaves when content is ready. When Wake / BOT_WAKE is configured, Waiting / Check now is wake / Your bot was notified only.

Saved → Request for next week always targets the planning week. Create that week if it is missing. People per night first (optional Special instructions) before that week’s ballot. Confirm Requested for next week. Do not request a week after next.

On each wake, GET /api/bot/status with a household member access token (Authorization: Bearer). Do the work when needs_work is true on any open week, including fill_pending after lock when that week's recipes or shopping list are still empty. Fulfill by week. Do not treat a settled cooking week as idle if the planning week still needs work. Stay silent when nothing changed — no “no update” message. When Wake / webhook is configured (configured true), Waiting / Check now is wake / Your bot was notified only. Without wake configured, setup is incomplete — Check now still means message the Bot, but Install must still create and save the webhook. Do not create Adaptive / @every 1h / @every 6h bot-check routines.

Rules: easy for anyone; never invent grocery prices; cart adds only where the store actually supports them (don’t claim Smith’s or any store cart add unless it’s real). Do NOT invent prices. Do NOT claim unsupported cart features. Don’t stop at “try it without Supabase.” Worker name stays bot-my-meals.
```

## If you already develop

CLI-first order is for developers only — not the household install path. The easy default for anyone remains Workers Builds (dashboard → connect GitHub). Run these from the **repo root** (workspaces) or from this repo.

```bash
npm ci
npm test
npm run lint
npm run build:worker
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147) for the household app. Copy [`.env.example`](.env.example) to `.env.local` and fill `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the same new Supabase project. Leave them blank only to confirm the setup gate. There is no localStorage household fallback. Two-phone / real-house use needs those vars.

```bash
npm run deploy
```

`npm run deploy` (root or this repo) is only this alternate: it builds with OpenNext, then runs [`scripts/cf-deploy.mjs`](scripts/cf-deploy.mjs) (root [`scripts/cf-deploy.mjs`](scripts/cf-deploy.mjs) delegates there). **Production promote is `main` only** (`wrangler deploy` on Worker `bot-my-meals`). Any other branch → preview upload only (`wrangler versions upload`).

`npm run build` (and OpenNext) run `prebuild`, which writes PWA icons into `public/icons` and `src/app/favicon.ico` / `src/app/icon.png`.

## CI/CD

[![CI](https://github.com/timdoes/bot-my-meals/actions/workflows/ci.yml/badge.svg)](https://github.com/timdoes/bot-my-meals/actions/workflows/ci.yml)

`main` → production is the intended path. GitHub Actions is the **gate**. Workers Builds is the **deploy**. Do not run both as competing production deploys.

| Job | Where | When |
| --- | --- | --- |
| Checks | GitHub Actions [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Every pull request, every push to `main`, and `workflow_call` |
| Production deploy (household) | Cloudflare **Workers Builds** | `main` changes matching the watch paths in [`docs/workers-builds.md`](docs/workers-builds.md) (`src/*`, `public/*`, `scripts/*`, `package.json`, `package-lock.json`, `.npmrc`, `wrangler.jsonc`, `open-next.config.ts`, `next.config.ts`) → Worker **`bot-my-meals`**. Build `npm run build:worker`. Deploy `node scripts/cf-deploy.mjs`. After cutover phones use https://bot-my-meals.<your-subdomain>.workers.dev ([`docs/domains.md`](docs/domains.md)). |

Actions runs `npm ci`, `npm test`, `npm run lint`, and `npm run build:worker`. The OpenNext smoke build does **not** need Cloudflare credentials. Actions does **not** deploy. Keep the Cloudflare API token out of this repo and out of GitHub unless you later retire Workers Builds and switch deploy to Actions on purpose.

Required GitHub secrets for an Actions deploy (not used today): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. If those are ever added, delete or disable the Workers Builds production deploy first so two systems do not both promote `main`.

### One-time: connect GitHub in the Cloudflare dashboard


1. [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → open Worker **`bot-my-meals`**.
2. **Settings → Builds → Connect** (skip Connect if Git is already linked; still fix commands + watch paths).
3. If prompted, install / authorize the **Cloudflare Workers and Pages** GitHub App on your GitHub account. Limit it to **your** fork or template copy of this repo.
4. Select **your** fork or template copy of this repo.
5. **Settings → Builds → Branch control**: production branch `main`. Check **Builds for non-production branches** if you want PR preview URLs and Cloudflare PR comments.
6. Save. The next matching push (or merge) to `main` should build and go live. Watch-path skips apply after you save.


Optional on GitHub: **Settings → Branches** → protect `main` and require the **CI / Test** check before merge.

## Schema

`Household` (including `setup_step` 1–7 wizard / 8 done, `household_size`, `nights_planned`, `postal_code`, optional `weekly_budget_cents`, `bot_check_mode` leftover / not Install teaching), `Membership` (owner / voter / eater), `User` (`auth.users` + `profiles`), `Week`, `Meal`, `Vote`, `Recipe`, `ShoppingList`, `ShoppingItem` (store tag, quantity, optional `price_cents` + `price_source` + `priced_at`). Pending people live in `household_invites` until they sign in. Textable partner links live in `household_join_tokens` (`/join/<token>`). Meal Ops inbox is `ballot_requests` (pending → fulfilled when meals are inserted). `saved_recipe_keys` are explicit Saved meal requests for that week (cool-down bypass). `saved_pool_keys` is the random-suggest snapshot (21 days after `last_locked_at`, no outstanding request). Household rows live in `saved_meals` (`recipe_key`, `saved_at`, `last_locked_at`, optional `requested_for_week`). Read path: [`docs/saved-meals.md`](docs/saved-meals.md). Quiet bot wakes use `GET /api/bot/status`.

Eaters can belong to the household later without voting. Only owner and voter roles count toward lock. Households are rows in this schema, not separate Workers.

## PWA

The app ships a web manifest, service worker (offline shell), apple-touch icon, standalone display, and `viewport-fit=cover` safe areas. On iPhone Safari: Share → Add to Home Screen. You can install as soon as the HTTPS URL works; you do not need a household first.

## Tests

`npm test` runs Vitest once (`vitest run`). Specs are `src/**/*.test.ts` and run in Node (`vitest.config.ts`). There is no coverage script.

GitHub Actions runs `npm ci`, then `npm test`, `npm run lint`, and `npm run build:worker` (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

