import { describe, expect, it } from "vitest";
import {
  MANAGED_HOST_TENANTS,
  MANAGED_STAGING_HOST,
  MANAGED_STAGING_TENANT_ID,
  MANAGED_TENANT_HEADER,
  hostnameFromHostHeader,
  managedForwardHeaders,
  requestHost,
  resolveTenantFromHost,
} from "@/lib/tenant-host";

describe("resolveTenantFromHost", () => {
  it("maps the managed staging host to the staging tenant", () => {
    expect(MANAGED_HOST_TENANTS).toEqual({
      [MANAGED_STAGING_HOST]: MANAGED_STAGING_TENANT_ID,
    });
    expect(resolveTenantFromHost("managed-staging.botmymeals.com")).toEqual({
      mode: "managed",
      tenantId: "managed-staging",
    });
    expect(resolveTenantFromHost("Managed-Staging.BotMyMeals.com:443")).toEqual({
      mode: "managed",
      tenantId: "managed-staging",
    });
    expect(
      resolveTenantFromHost("managed-staging.botmymeals.com, evil.example"),
    ).toEqual({
      mode: "managed",
      tenantId: "managed-staging",
    });
  });

  it("stays single-tenant for DIY, timdoes, apex, and unknown hosts", () => {
    const single = { mode: "single" as const, tenantId: null };
    expect(resolveTenantFromHost("timdoes.botmymeals.com")).toEqual(single);
    expect(resolveTenantFromHost("botmymeals.com")).toEqual(single);
    expect(resolveTenantFromHost("www.botmymeals.com")).toEqual(single);
    expect(resolveTenantFromHost("meals.example.com")).toEqual(single);
    expect(resolveTenantFromHost("bot-my-meals.example.workers.dev")).toEqual(single);
    expect(resolveTenantFromHost("bot-my-meals-managed-staging.example.workers.dev")).toEqual(
      single,
    );
    expect(resolveTenantFromHost("managed-staging.botmymeals.com.evil.com")).toEqual(single);
    expect(resolveTenantFromHost("notmanaged-staging.botmymeals.com")).toEqual(single);
    expect(resolveTenantFromHost(null)).toEqual(single);
    expect(resolveTenantFromHost("")).toEqual(single);
    expect(resolveTenantFromHost("not a host")).toEqual(single);
    expect(hostnameFromHostHeader("timdoes.botmymeals.com:443")).toBe("timdoes.botmymeals.com");
  });

  it("forwards a tenant header only for the managed host", () => {
    const incoming = new Headers({
      cookie: "sb=session",
      host: "timdoes.botmymeals.com",
      [MANAGED_TENANT_HEADER]: "spoofed",
    });

    expect(managedForwardHeaders(incoming, "timdoes.botmymeals.com")).toBeNull();
    expect(managedForwardHeaders(incoming, "meals.example.com")).toBeNull();
    expect(incoming.get(MANAGED_TENANT_HEADER)).toBe("spoofed");

    const forwarded = managedForwardHeaders(incoming, "managed-staging.botmymeals.com");
    expect(forwarded?.get(MANAGED_TENANT_HEADER)).toBe("managed-staging");
    expect(forwarded?.get("cookie")).toBe("sb=session");
    expect(incoming.get(MANAGED_TENANT_HEADER)).toBe("spoofed");
  });

  it("prefers the first forwarded host over host", () => {
    const headers = new Headers({
      "x-forwarded-host": "managed-staging.botmymeals.com, proxy",
      host: "timdoes.botmymeals.com",
    });
    expect(requestHost(headers)).toBe("managed-staging.botmymeals.com, proxy");
    expect(resolveTenantFromHost(requestHost(headers))).toEqual({
      mode: "managed",
      tenantId: "managed-staging",
    });

    const diy = new Headers({ host: "timdoes.botmymeals.com" });
    expect(resolveTenantFromHost(requestHost(diy))).toEqual({
      mode: "single",
      tenantId: null,
    });
  });
});
