import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MANAGED_STAGING_CONFIG,
  MANAGED_STAGING_WORKER,
  PRODUCTION_WORKER,
  assertManagedStagingConfig,
  loadManagedStagingConfig,
  wranglerDeployArgs,
} from "../../scripts/cf-deploy-managed-staging.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function readRepo(rel: string) {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function jsoncWithoutLineComments(src: string) {
  return src.replace(/^\s*\/\/.*$/gm, "");
}

describe("managed staging worker config", () => {
  it("keeps the default Worker name and deploy path", () => {
    const prod = JSON.parse(jsoncWithoutLineComments(readRepo("wrangler.jsonc")));
    const pkg = JSON.parse(readRepo("package.json"));
    const cfDeploy = readRepo("scripts/cf-deploy.mjs");

    expect(prod.name).toBe(PRODUCTION_WORKER);
    expect(prod.name).toBe("bot-my-meals");
    expect(prod.routes).toBeUndefined();
    expect(prod.services[0].service).toBe("bot-my-meals");
    expect(pkg.scripts.deploy).toBe("opennextjs-cloudflare build && node scripts/cf-deploy.mjs");
    expect(pkg.scripts["deploy:managed-staging"]).toBe(
      "node scripts/cf-deploy-managed-staging.mjs",
    );
    expect(cfDeploy).not.toMatch(/managed-staging/);
    expect(cfDeploy).not.toMatch(/wrangler\.managed-staging/);
  });

  it("names a separate staging Worker and leaves the custom domain commented", () => {
    const raw = readRepo(MANAGED_STAGING_CONFIG);
    const staging = loadManagedStagingConfig(repoRoot);

    expect(raw).toMatch(/Do not uncomment/);
    expect(raw).toMatch(/managed-staging\.botmymeals\.com/);
    expect(raw).toMatch(/custom_domain/);
    expect(staging.name).toBe(MANAGED_STAGING_WORKER);
    expect(staging.name).not.toBe("bot-my-meals");
    expect(staging.routes).toBeUndefined();
    expect(staging.main).toBe(".open-next/worker.js");
    expect(staging.services).toEqual([
      { binding: "WORKER_SELF_REFERENCE", service: "bot-my-meals-managed-staging" },
    ]);
    expect(wranglerDeployArgs()).toEqual([
      "wrangler",
      "deploy",
      "--config",
      "wrangler.managed-staging.jsonc",
    ]);
  });

  it("refuses a config that would deploy the production Worker or attach DNS", () => {
    expect(() =>
      assertManagedStagingConfig({
        name: "bot-my-meals",
        services: [{ binding: "WORKER_SELF_REFERENCE", service: "bot-my-meals" }],
      }),
    ).toThrow(/refusing to deploy production Worker/);

    expect(() =>
      assertManagedStagingConfig({
        name: "bot-my-meals-managed-staging",
        services: [{ binding: "WORKER_SELF_REFERENCE", service: "bot-my-meals" }],
      }),
    ).toThrow(/WORKER_SELF_REFERENCE/);

    expect(() =>
      assertManagedStagingConfig({
        name: "bot-my-meals-managed-staging",
        routes: [{ pattern: "managed-staging.botmymeals.com", custom_domain: true }],
        services: [
          { binding: "WORKER_SELF_REFERENCE", service: "bot-my-meals-managed-staging" },
        ],
      }),
    ).toThrow(/routes must stay commented/);
  });
});

describe("managed staging docs", () => {
  it("documents the staging Worker, test-mode Stripe, and Access/DNS as ops", () => {
    const doc = readRepo("docs/managed-staging.md");

    expect(doc).toMatch(/bot-my-meals-managed-staging/);
    expect(doc).toMatch(/managed-staging\.botmymeals\.com/);
    expect(doc).toMatch(/npm run deploy:managed-staging/);
    expect(doc).toMatch(/wrangler\.managed-staging\.jsonc/);
    expect(doc).toMatch(/does not deploy Worker `bot-my-meals`/);
    expect(doc).toMatch(/Cloudflare Access/);
    expect(doc).toMatch(/email allowlist/);
    expect(doc).toMatch(/custom_domain/);
    expect(doc).toMatch(/sk_test_/);
    expect(doc).toMatch(/sk_live_/);
    expect(doc).toMatch(/Non-prod Supabase/);
    expect(doc).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(doc).toMatch(/timdoes\.botmymeals\.com/);
    expect(doc).not.toMatch(/sk_live_[A-Za-z0-9]/);
    expect(doc).not.toMatch(/pk_live_[A-Za-z0-9]/);
  });

  it("keeps proxy on the single-tenant path unless the host is managed", () => {
    const proxy = readRepo("src/proxy.ts");
    expect(proxy).toMatch(/managedForwardHeaders/);
    expect(proxy).toMatch(/if \(!forwarded\) return NextResponse\.next\(\)/);
    expect(proxy).toMatch(/NextResponse\.next\(\{ request \}\)/);
  });
});
