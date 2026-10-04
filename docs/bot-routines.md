# Household bot wake

Shared Grok Bots wake when this household’s app POSTs. Week lock, plan changes, and Check now are the events. The bot writes ballot, recipes, and the shopping list back to the site.

**Wake your Bot is required before Create this week's meals.** On that setup step, paste the Webhook URL. **Create this week's meals** stays off until the save sticks (`configured` true). There is no Skip. After save: **Saved. Create this week’s meals will wake your bot.** House empty copy is **Required.** Paste the Webhook URL before you create this week’s meals.

## Wake on app event

1. Create a routine named exactly **Wake on app event** with a webhook trigger. On wake, sync ballot / recipes / shopping list / setup for the week that needs work; stay quiet if nothing changed.
2. Copy **Webhook URL** (the panel may say **POST to**) and the **sender key** if the panel shows one. The Worker sends the key as `Authorization: Bearer <key>`.
3. Paste them into the app at **House → Wake your Bot**. DIY alternative: Worker secrets `BOT_WAKE_WEBHOOK_URL` and optional `BOT_WAKE_WEBHOOK_KEY` (`npx wrangler secret put BOT_WAKE_WEBHOOK_URL`, and the key if you have one). Never `NEXT_PUBLIC_` for these. After save, the app does not show the full secret again (**Saved · Replace**).

To let House save those two secrets, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` on the Worker once (Workers Scripts edit for `bot-my-meals`). Without them, use the DIY `wrangler secret put` commands in step 3.

The Worker POSTs when the week locks (`week_locked`), when a week or plan change still needs the bot (`needs_work`, including a change while work was already waiting), and when someone taps **Check now** or **Get recipes now** (`check_now`). The JSON body is only `source`, `event`, `household_host`, and `at`. At most one POST per household per event about every 30 seconds. A failed POST is logged; the screen does not wait on it. The bot’s updates show up on the site.

With the URL set, **Check now** says “Wakes your Bot My Meals bot now.” **Get recipes now** says “Wakes your bot to fill recipes and the shopping list.” On next week those hints say **next week**. A recipe that is still waiting says “Wakes your bot to fill this recipe.” On next week it says next week. If the wake does not go through, the screen says “Couldn’t reach your bot. Try again or message it.” After you save in House, the page shows “Saved. Check now will wake your bot.” and **Saved · Replace**. It does not show the URL or key again. Without the URL, those hints still tell someone to message the Bot. Waiting never shows a schedule, whether or not the URL is set. When the webhook URL is set (`configured` true), voice is wake / instant / **Your bot was notified.** Updates show up on the site after the bot writes them. When Wake is unset, Check now asks you to message the bot. Week and plan changes POST. House → Wake your Bot is the Settings path. Waiting titles name **This week** or **Next week** when both weeks are open. Shopping list titles are **Shopping · This week** or **Shopping · Next week**. Someone changes week with a **horizontal swipe** on the date strip (or the optional edge ‹ ›) — not a chip row. From This week, that future swipe or › creates **Next week** when it is missing, lands there, and asks **People per night** first (all 7 nights, Off / Solo / Couple / Family, prefill from House defaults, optional **Special instructions** on the same step; empty OK) before any ballot. Save needs plates above zero on at least one night. Toast: **Next week started. Set people per night.** House People per night stays the template for new weeks only. It cannot open a week after next. Title labels **This week** / **Next week** are status, not the switcher.

## On each wake

`needs_work` can be true on **any open week** (this week or next week: ballot, meal, portion, a plate/people change the bot still needs to apply, options still needed, or a locked week still missing recipes or that week’s shopping list). A settled cooking week does not hide a next-week ballot.

1. `GET /api/bot/status` with a household member’s Supabase access token: `Authorization: Bearer <access_token>`. Row Level Security scopes the read to that household. The body is small: `needs_work`, `reason`, and `work` when `needs_work` is true. `work` has `week_id`, `starts_on`, and `ballot_mode`. On a choice3 `pending_ballot` or `options_pending`, `work.nights` lists each night (`day_index`, `night_date`, `plates`, `need` of `options` or `new_options`, and `note` when someone asked for a new set). It is not a full household snapshot.
2. If `needs_work` is false, stay silent. Do not send a “no update” message. `reason` may be `idle`, or `setup_incomplete` (still say nothing).
3. If `needs_work` is true, fulfill `reason` for the week that needs work and stop:
   - `pending_ballot` — waiting for dinners on an open week (this week or next week). For next week, use that ballot’s `night_headcounts` and optional `special_instructions`. Empty instructions mean nothing extra. Do not write them back onto House plate defaults.
   - `options_pending` — a choice3 week still needs 3 options on a night, or a night asked for a new set
   - `meal_pending` — an open swap or a new-dinner request on that week
   - `portion_pending` — a dinner’s servings don’t match the plates
   - `plate_or_people_change` — plates or household size changed and a dinner’s servings still need to catch up
   - `fill_pending` — that week is locked and a dinner is still missing a recipe, or that week’s shopping list is empty when a dinner needs groceries. Write those. Each week has its own list. Do not invent a list when nothing needs buying, and do not merge this week with next week.

On a `choice3` week, `pending_ballot` and `options_pending` mean: call `submit_week_options` with exactly 3 distinct options per listed night, servings = that night's plates. Don't write `meals` on a choice3 week; the app writes the winners when everyone locks in. Honor `note` on `new_options`. Include `saved_recipe_keys` from the week's `ballot_requests` among the options.

Never invent grocery prices. Never claim Smith’s cart adds.
