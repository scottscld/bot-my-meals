# Bot My Meals

Public household PWA template. Worker name stays `bot-my-meals`.

DIY households deploy this Worker on **their** Cloudflare account and open **their** workers.dev URL or **their** domain — not `{handle}.botmymeals.com`. `wrangler deploy` does not flip DNS (routes stay commented). See `docs/domains.md` and `docs/workers-builds.md`.

GitHub Actions is CI-only (`npm ci`, `npm test`, `npm run lint`, `npm run build:worker`). Production deploy is Cloudflare Workers Builds.

Week and plan changes POST a wake (`week_locked`, `needs_work`, `check_now`) and the bot writes updates back to the site. A choice3 week uses `options_pending` and `submit_week_options` (3 options per night); the app writes the winning meals when every voter locks in. House → Wake your Bot is required before the first Create this week's meals. There is no check-frequency control. A cooking week and one planning week can both be open; `needs_work` looks at either. See `docs/bot-routines.md`.

Next.js agent notes: keep the block below when `next dev` rewrites it.


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
