# Workers Builds (household Worker)

This is the dashboard runbook so `main` auto-deploys Worker **`bot-my-meals`**. **Merging a PR does not deploy and does not flip DNS.** You click in the Cloudflare dashboard. GitHub Actions stays CI-only — no `CLOUDFLARE_API_TOKEN` in GitHub.

Worker **`bot-my-meals`** is the household PWA. **Do not rename it.**

Official Cloudflare docs: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/).

## Commands (copy exactly)

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | leave blank (repo root) |
| Build command | `npm run build:worker` |
| Deploy command | `node scripts/cf-deploy.mjs` |
| Non-production branch deploy command | `npm run deploy:preview` |
| Build watch paths — **Include** | `src/*, public/*, scripts/*, package.json, package-lock.json, .npmrc, wrangler.jsonc, open-next.config.ts, next.config.ts` |
| Build watch paths — **Exclude** | (leave empty, or exclude docs-only paths if you prefer) |

Docs-only commits (including `docs/*`) do not match these include paths, so they do not start a Workers Build.

`npm run build:worker` runs OpenNext for this app. **Do not** put bare `npx opennextjs-cloudflare build` in the dashboard without the npm script — that can miss `prebuild` PWA icon copies.

`node scripts/cf-deploy.mjs`: `main` → `wrangler deploy` (promote Worker `bot-my-meals`); any other branch → `wrangler versions upload` (preview only).

## Click pass (do this once)

Tim’s household Worker `bot-my-meals` on his Cloudflare account deploys from this public repo (`timdoes/bot-my-meals`), not the marketing monorepo. DIY households still connect their own fork or template copy.

1. Open [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages).
2. Create or open Worker **`bot-my-meals`**. If the name is wrong, stop — do not rename; open/create the correct Worker.
3. **Settings → Builds**.
4. Connect GitHub → select **your** fork or template copy of this repo.
5. Set **Production branch** to **`main`**.
6. **Root directory**: empty / `.` / repo root.
7. **Build command**: `npm run build:worker`
8. **Deploy command**: `node scripts/cf-deploy.mjs`
9. **Non-production branch deploy command**: `npm run deploy:preview`
10. Optional **Build watch paths** from the table above.
11. Confirm runtime vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are on the Worker (**Settings → Variables & Secrets**). Also add them under **Build variables** so OpenNext can inline them. Never put the service-role key here. Optional secrets (not build variables, not `NEXT_PUBLIC_`): `BOT_WAKE_WEBHOOK_URL` and `BOT_WAKE_WEBHOOK_KEY`. See [`docs/bot-routines.md`](bot-routines.md).
12. **Save**. New settings apply to the **next** build.

## Verify

1. Push a tiny change to `main` (or trigger a build).
2. Open `https://bot-my-meals.<your-subdomain>.workers.dev` — setup gate or PWA, not a pitch site.
3. Custom domains are a separate dashboard pass: [`docs/domains.md`](domains.md).
