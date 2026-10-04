# Push notifications

Home Screen web push for the household PWA (iOS 16.4 or later, and the same code on Android and desktop). The Worker encrypts and sends. Postgres writes the outbox and calls the Worker. The Worker never holds the Supabase service-role key.

## One-time setup

1. Make the keys on your Mac:

   ```bash
   npx web-push generate-vapid-keys --json
   openssl rand -hex 32
   ```

   Keep `publicKey`, `privateKey`, and the hex string. Do not commit them.

2. Put four **runtime** secrets on Worker `bot-my-meals` (dashboard → Workers & Pages → bot-my-meals → Settings → Variables and Secrets → Secret, or `npx wrangler secret put`):

   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` = `mailto:<your email>`
   - `PUSH_DISPATCH_SECRET` = the hex string

   Do not put these under Settings → Builds → Variables. Those are build-time only. Do not add a `vars` block in `wrangler.jsonc`.

3. Apply `supabase/migrations/20261004120000_realtime_names_push.sql` (SQL editor or `supabase db push`). It enables `pg_net`.

4. Store the dispatch URL and the same hex string in Supabase Vault. Use the real workers.dev host:

   ```sql
   select vault.create_secret(
     'https://bot-my-meals.scottscld.workers.dev/api/push/dispatch',
     'push_dispatch_url'
   );
   select vault.create_secret('<the same hex as PUSH_DISPATCH_SECRET>', 'push_dispatch_secret');
   ```

   If the hostname changes, update `push_dispatch_url`. To rotate the secret:

   ```sql
   select vault.update_secret(
     (select id from vault.secrets where name = 'push_dispatch_secret'),
     '<new>'
   );
   ```

   Then set the Worker secret to the same value.

5. Deploy `main`. Workers Builds ships `src/*` and `public/*`.

6. On each iPhone: Safari → Share → Add to Home Screen → open the icon → House → Notifications → Turn on notifications → Allow → Send a test. If the app was installed before this change, remove the Home Screen icon and add it again so `supper-shell-v6` takes over. Closing the old icon does not drop its saved pages.

## What gets sent

| Kind | When | Who |
| --- | --- | --- |
| Menu ready | The first time every active night of a choice3 voting week has at least 3 options | Owners and voters |
| Options refreshed | A later rewrite of those options (follows the menu-ready preference) | Owners and voters |
| Week locked | The week status becomes locked | Everyone |

Eaters do not get menu-ready. There is no “list is ready” push. Unlock and lock again sends week-locked again.

## Checks

```sql
select private.push_secret_ok('x'); -- false, and no error
select kind, sent_at, attempts, last_error
from private.push_outbox
order by id desc
limit 5;
select id, status_code, content
from net._http_response
order by id desc
limit 5;
```

`push_dispatch_claim` and `push_dispatch_report` are granted to `anon` and re-check the Vault secret. A wrong secret raises `42501`.

## Troubleshooting

- House shows no Notifications card. `/api/push/config` returned `publicKey: null`. The four Worker secrets are missing on the running version. Saving a secret creates a new version.
- The Safari tab says to add the app to the Home Screen. iOS web push works only from the standalone Home Screen app. Turn on notifications from that icon, and allow the prompt from the tap.
- Notifications are blocked. iPhone Settings → Notifications → Bot My Meals.
- Send a test does nothing. Confirm the phone allowed notifications, then look at `private.push_outbox` and `net._http_response`. A missing Vault secret means the outbox row stays and nothing is posted.
- A push arrives and the endpoint is gone (HTTP 404 or 410). The report deletes that subscription.
- Sign-out removes this device’s subscription before the session ends, so the next person on the phone does not get the household’s pushes.
- Live names and votes need the app open as a signed-in member. Realtime joins only after the session is loaded.
