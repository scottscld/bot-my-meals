# H-E-B order

The bot is Scott's assistant driving **heb.com in a signed-in browser**. H-E-B has no ordering API. The app does not scrape heb.com. It wakes the bot and stores what `report_order_status` reports. See `docs/bot-routines.md` for the status payload and the RPC.

## Flow

1. **Wake.** The bot receives `list_approved`, or it sees `order_pending` on a check. It calls `GET /api/bot/status` with the member token and reads `work.order`.
2. **Start.** `report_order_status(list_id, 'carting', '{}')`.
3. **Store.** On heb.com, confirm the delivery address matches postal **76177** (Fort Worth). If H-E-B shows a different store, switch it. If that isn't possible, report `failed` with a message.
4. **Cart.** If the H-E-B cart already has items, empty it first, unless `resume` is true and those items came from this run. For each list item: search heb.com for `name` (plus `note`), choose the best match (prefer the H-E-B brand at a sensible size for `quantity` / `unit`; respect a brand in `note`), and set the quantity.
   - Record `added`, `substituted` (a different product than asked, with `product` set to the H-E-B product name), or `not_found`.
   - About every 10 items, call `report_order_status(list_id, 'carting', {items:[…]})` so the app shows progress.
   - Never add an item that is not on the list.
5. **Delivery.** Open checkout and pick a slot. Take the earliest available slot whose day is in `delivery.days` (or any day, when that list is empty) and that overlaps `[delivery.start, delivery.end]` in the household time zone. With no match, take the earliest slot in the next 3 days. If there is still no match, stop at `awaiting_review` with a message. Record `delivery_window_start`, `delivery_window_end`, and `delivery_label`.
6. **Decide.** Read the final total (items + fees + tip + tax).
   - **Automatic mode and the total is at or under `max_total_cents`:** place the order, read the order number, and report `ordered` with the total, window, number, and final items.
   - **Otherwise** (review mode, over the guard, no guard, a missing slot, or anything unexpected such as a payment prompt, a CAPTCHA, or an age-restricted item): stop on the cart or checkout page without placing the order. Report `awaiting_review` with `cart_url`, the totals, and a `message` (for example `Total $312.50 is over your $300 limit.`). Scott checks out, then taps **I placed the order**. A later wake can also confirm the order from H-E-B history and report `ordered`.
7. **Errors.** On sign-in expiry, a site error, or 3 failed retries, report `failed` with a plain message (`H-E-B asked me to sign in again.`). Never enter or change payment, the address, or account settings. Never tip above H-E-B's default.
8. **Quiet.** Don't message Scott separately. The app push covers it. The exception is a `failed` run that needs him to sign in again.

`over_guard` is true when the reported total is above `max_total_cents`, which falls back to the weekly budget when the max is empty. A carting run with no status update for more than 45 minutes becomes `order_pending` again with `resume: true`. Exactly 45 minutes is not stale.

## What Scott does once

- Sign in to heb.com in the bot's browser and leave remember-me on.
- Set a default delivery address and a saved payment method on that H-E-B account. Without them, automatic mode stops at `awaiting_review`.
- Sign in again when H-E-B expires the session. The bot reports `failed` with that message.
- In House → H-E-B checkout, leave **I'll review and check out** on for the first orders. Leave the max total empty to use the $300 weekly budget.
- On each phone, House → Notifications → turn on **H-E-B order updates**.
