#!/usr/bin/env node
// Manual deploy for Worker `bot-my-meals-managed-staging` only.
// Do not call this from Workers Builds for Worker `bot-my-meals`.
/**
 * Builds OpenNext, then deploys with `--config wrangler.managed-staging.jsonc`.
 * Refuses to run unless that config names `bot-my-meals-managed-staging`
 * and does not declare routes (so this command cannot attach DNS).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MANAGED_STAGING_WORKER = "bot-my-meals-managed-staging";
export const MANAGED_STAGING_CONFIG = "wrangler.managed-staging.jsonc";
export const PRODUCTION_WORKER = "bot-my-meals";

export function stripJsoncLineComments(src) {
  return src.replace(/^\s*\/\/.*$/gm, "");
}

export function assertManagedStagingConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("[cf-deploy-managed-staging] config is not an object");
  }
  if (config.name === PRODUCTION_WORKER) {
    throw new Error(
      "[cf-deploy-managed-staging] refusing to deploy production Worker bot-my-meals",
    );
  }
  if (config.name !== MANAGED_STAGING_WORKER) {
    throw new Error(
      `[cf-deploy-managed-staging] refusing to deploy: name is ${JSON.stringify(config.name)}, expected ${MANAGED_STAGING_WORKER}`,
    );
  }
  const services = Array.isArray(config.services) ? config.services : [];
  const self = services.find((entry) => entry && entry.binding === "WORKER_SELF_REFERENCE");
  if (!self || self.service !== MANAGED_STAGING_WORKER) {
    throw new Error(
      `[cf-deploy-managed-staging] WORKER_SELF_REFERENCE.service must be ${MANAGED_STAGING_WORKER}`,
    );
  }
  if (config.routes != null) {
    throw new Error(
      "[cf-deploy-managed-staging] routes must stay commented so deploy cannot attach DNS",
    );
  }
  return config;
}

export function loadManagedStagingConfig(cwd = process.cwd()) {
  const raw = readFileSync(path.join(cwd, MANAGED_STAGING_CONFIG), "utf8");
  return assertManagedStagingConfig(JSON.parse(stripJsoncLineComments(raw)));
}

export function wranglerDeployArgs() {
  return ["wrangler", "deploy", "--config", MANAGED_STAGING_CONFIG];
}

function runNpx(args) {
  console.log(`[cf-deploy-managed-staging] running: npx ${args.join(" ")}`);
  const result = spawnSync("npx", args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

export function main() {
  const config = loadManagedStagingConfig();
  console.log(`[cf-deploy-managed-staging] worker=${config.name}`);
  console.log(
    "[cf-deploy-managed-staging] This does not deploy Worker bot-my-meals and does not flip DNS.",
  );
  console.log(
    "[cf-deploy-managed-staging] NEXT_PUBLIC_SUPABASE_* are inlined by this build. Use a non-prod Supabase project, not the live DIY project. A local .env.local from DIY will be baked in if those vars are unset.",
  );
  console.log(
    "[cf-deploy-managed-staging] Stripe on this Worker is test mode only. Do not set sk_live_ or pk_live_.",
  );

  runNpx(["opennextjs-cloudflare", "build"]);
  runNpx(wranglerDeployArgs());
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
