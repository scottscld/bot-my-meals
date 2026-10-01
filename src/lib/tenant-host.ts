/**
 * Host → tenant scaffold for Managed staging.
 *
 * A map hit is the only managed path. Every other host — including
 * timdoes.botmymeals.com, DIY custom domains, workers.dev, and the
 * marketing apex — stays single-tenant. This module does not read
 * Supabase and does not change household data access.
 */

export const MANAGED_TENANT_HEADER = "x-bot-my-meals-tenant";

export const MANAGED_STAGING_HOST = "managed-staging.botmymeals.com";
export const MANAGED_STAGING_TENANT_ID = "managed-staging";

/** Exact hostnames only. Do not add a `*.botmymeals.com` wildcard here. */
export const MANAGED_HOST_TENANTS: Readonly<Record<string, string>> = {
  [MANAGED_STAGING_HOST]: MANAGED_STAGING_TENANT_ID,
};

export type TenantResolution =
  | { mode: "single"; tenantId: null }
  | { mode: "managed"; tenantId: string };

export function hostnameFromHostHeader(host: string | null | undefined): string {
  const raw = host?.split(",")[0]?.trim() ?? "";
  if (!raw) return "";
  try {
    return new URL(`https://${raw}`).hostname.replace(/\.$/, "").toLowerCase();
  } catch {
    return "";
  }
}

export function requestHost(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-host")?.trim();
  if (forwarded) return forwarded;
  const host = headers.get("host")?.trim();
  return host || null;
}

export function resolveTenantFromHost(host: string | null | undefined): TenantResolution {
  const tenantId = MANAGED_HOST_TENANTS[hostnameFromHostHeader(host)];
  if (tenantId) return { mode: "managed", tenantId };
  return { mode: "single", tenantId: null };
}

/**
 * Headers to forward when the request is a known managed host.
 * Returns null for single-tenant hosts so the caller can leave the
 * request untouched (DIY / timdoes stay on today's path).
 */
export function managedForwardHeaders(
  headers: Headers,
  host: string | null | undefined,
): Headers | null {
  const resolution = resolveTenantFromHost(host);
  switch (resolution.mode) {
    case "single":
      return null;
    case "managed": {
      const next = new Headers(headers);
      next.set(MANAGED_TENANT_HEADER, resolution.tenantId);
      return next;
    }
    default: {
      const _exhaustive: never = resolution;
      return _exhaustive;
    }
  }
}
