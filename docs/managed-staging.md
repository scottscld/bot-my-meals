# Managed staging

Isolated Worker for the Managed product spike. `npm run deploy:managed-staging` deploys Worker **`bot-my-meals-managed-staging`** only. It does not deploy Worker `bot-my-meals`, does not change `timdoes.botmymeals.com`, and does not change the marketing apex `botmymeals.com`.

Default `wrangler.jsonc` still names Worker **`bot-my-meals`**. Workers Builds for that Worker stay on `node scripts/cf-deploy.mjs`. Do not point that build at `wrangler.managed-staging.jsonc`.

**HOLD merge** until Cos/Eng CLEAR. Merging ships the host→tenant scaffold to the existing Worker (a no-op unless the host is `managed-staging.botmymeals.com`). It does not create the staging Worker and does not attach DNS. Creating the staging Worker is the manual command below.

## What this spike is

| | |
| --- | --- |
| Worker name | `bot-my-meals-managed-staging` |
| Config | `wrangler.managed-staging.jsonc` |
| Deploy | `npm run deploy:managed-staging` |
| Hostname | `managed-staging.botmymeals.com` |
| Tenant id | `managed-staging` (that host only) |

DIY custom domains, `*.workers.dev`, `timdoes.botmymeals.com`, and `botmymeals.com` stay single-tenant. There is no Supabase migration and no billing UI in this change.

## Deploy the staging Worker

From a checkout of this repo, with Wrangler logged into the Cloudflare account that should own the staging Worker:

```bash
npm run deploy:managed-staging
```

That command checks the config name is `bot-my-meals-managed-staging`, builds OpenNext, then runs `wrangler deploy --config wrangler.managed-staging.jsonc`. It refuses to run if `routes` are uncommented.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are inlined at build time. Export the **non-prod** Supabase values in the shell before the command (or otherwise make them the values Next sees). A DIY `.env.local` is baked into this build when those vars are unset. Do not build staging with the live DIY project’s keys. Never put the service-role key in the shell, git, or Worker vars.

Until the custom hostname is attached, the Worker is also at `https://bot-my-meals-managed-staging.<account-subdomain>.workers.dev`. That workers.dev host is **not** in the tenant map (single-tenant mode). Tenant `managed-staging` resolves only on `managed-staging.botmymeals.com`.

## Attach the hostname (ops, outside this PR)

Leave `routes` commented in `wrangler.managed-staging.jsonc`. `custom_domain: true` on deploy creates DNS and can surprise the `botmymeals.com` zone.

1. Cloudflare dashboard → Workers & Pages → **`bot-my-meals-managed-staging`** → Settings → Domains & Routes.
2. Add **`managed-staging.botmymeals.com`** only.
3. Confirm the new record is that hostname. Do not move apex `botmymeals.com`. Do not move `timdoes.botmymeals.com` (that host stays on Worker `bot-my-meals`).

## Cloudflare Access (ops, required before the host is public)

Put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/) in front of `managed-staging.botmymeals.com` with an email allowlist before anyone can open it without a login. This repo does not configure Access. Do not leave the hostname open while Stripe test keys or a staging database are on the Worker.

## Secrets (staging Worker only)

Same public names the app already reads. Different values, on **this** Worker only.

| Name | Staging value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Non-prod Supabase project URL (or a branch URL). Not the live DIY project. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | That project’s anon key. |
| `STRIPE_SECRET_KEY` | Test secret `sk_test_…` only. Not read by the app yet. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret from a **test** webhook endpoint. Not read by the app yet. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Test publishable `pk_test_…` only. Not read by the app yet. |

Set Stripe secrets on the staging Worker, not in git:

```bash
npx wrangler secret put STRIPE_SECRET_KEY --config wrangler.managed-staging.jsonc
npx wrangler secret put STRIPE_WEBHOOK_SECRET --config wrangler.managed-staging.jsonc
```

Stripe is **test mode only**. Do not create live products, live prices, or live Checkout. Do not put `sk_live_` or `pk_live_` on this Worker. Do not put these secrets on Worker `bot-my-meals`.

Public Supabase vars still need a rebuild after they change, because OpenNext inlines `NEXT_PUBLIC_*`.

## Tenant resolution

`src/lib/tenant-host.ts` maps `managed-staging.botmymeals.com` → `managed-staging`. Any other host returns single-tenant (`tenantId: null`). `src/proxy.ts` stamps request header `x-bot-my-meals-tenant` only on that managed host. Single-tenant requests are forwarded the same way as before. Nothing in the household data path reads the header yet.

## Out of scope

- Wildcard `*.botmymeals.com`
- Live Stripe Checkout
- Billing UI, trials, or cancel/delete
- Shared Supabase Pro for DIY households
- Changing Workers Builds so Worker `bot-my-meals` deploys this config
