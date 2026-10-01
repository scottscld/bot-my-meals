# Domains and Auth

`wrangler deploy` **does not flip DNS**. Do not uncomment `custom_domain` routes in `wrangler.jsonc`. Worker name stays **`bot-my-meals`** — do not rename it.

Paid managed `{handle}.botmymeals.com` is later. Do not build billing or multi-tenant hosting on the DIY Worker. A separate staging Worker is documented in [`docs/managed-staging.md`](managed-staging.md). DIY users are **not** put on `{handle}.botmymeals.com`.

## Your HTTPS origin

| Hostname | What it is |
| --- | --- |
| `https://bot-my-meals.<your-subdomain>.workers.dev` | Default Worker URL (`workers_dev` left on) |
| Your custom domain | Optional dashboard attach to **your** Worker |

Phones should open **your** final HTTPS origin. Set Supabase Auth to match that origin.

## Supabase Auth allowlist (DIY)

On **your** Supabase project:

- **Site URL** = `https://<your-host>` (workers.dev or your domain)
- **Redirect URLs**:
  - `https://<your-host>`
  - `https://<your-host>/auth/callback`
  - `https://<your-host>/login/new-password`

Do **not** set Site URL to someone else’s house. Do **not** add `{handle}.botmymeals.com` wildcards for DIY.

Create account and Sign in finish in the app. They do **not** depend on opening a mail link. Keep `/auth/callback` and `/login/new-password` on the allowlist for a leftover link or password reset.

## Email and password on phones

**Install sign-in is email + password** inside the app (installed PWA, or the Safari tab you add to the Home Screen). People use email + password in the app — not a magic link.

1. Open **your** HTTPS origin (not a marketing apex).
2. Tap **Create account**. Enter an email and a password (at least 8 characters). You stay in this app.
3. Sign out, then **Sign in** with the same email and password.
4. Partner join is `/join/<token>` only. They **Create account** with **their** email and password (or **Sign in**). There is no shared household password.

Do not use a magic link as the way people finish sign-in. Do not turn on Apple, Google, or other SSO for Install. Passkeys are not part of Install.

Turn **Confirm email OFF**. With it on, the first sign-up waits on a link that opens outside the Home Screen app. Do not treat that as proof they own the inbox.

## Forgot password

**Send reset link** emails a link. That link may open in the phone’s browser. Set the new password, then open Bot My Meals from the Home Screen and **sign in**.

On Free’s built-in mail, reset messages may only reach the Supabase project’s team addresses, about 2 an hour. Until custom SMTP, ask a household partner for a new invite if you can’t get into email.

## Optional later: sign-in codes

Not required to install. Optional later: custom SMTP + a code in the email template (`{{ .Token }}`) for sign-in codes. Keep email + password. Do not turn Confirm email ON with a link-only template.

Only these public keys: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. After an env change, rebuild/redeploy. There is no localStorage sign-in.

## Hard-refresh / Home Screen

- Hard-refresh your origin on both phones.
- If an old Home Screen icon opened the wrong host, delete it and **Share → Add to Home Screen** from your final HTTPS URL.
- A2HS is origin-scoped.

## Wrangler placeholders (do not uncomment)

`wrangler.jsonc` may show a commented example `routes` block with `custom_domain: true`. Uncommenting and deploying would attach DNS from Wrangler. Prefer the dashboard Workers domains UI so a deploy cannot flip DNS by accident.
