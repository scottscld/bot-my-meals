import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/config";
import { supabaseAuthCookieOptions } from "@/lib/supabase/auth-cookies";
import { managedForwardHeaders, requestHost } from "@/lib/tenant-host";

function managedHeaders(request: NextRequest): Headers | null {
  return managedForwardHeaders(request.headers, requestHost(request.headers));
}

/** Single-tenant: same `{ request }` forward as before. Managed: stamp the tenant header. */
function nextPassingRequest(request: NextRequest) {
  const forwarded = managedHeaders(request);
  if (!forwarded) return NextResponse.next({ request });
  return NextResponse.next({ request: { headers: forwarded } });
}

export async function proxy(request: NextRequest) {
  const config = getPublicSupabaseConfig();
  if (!config) {
    const forwarded = managedHeaders(request);
    if (!forwarded) return NextResponse.next();
    return NextResponse.next({ request: { headers: forwarded } });
  }

  let response = nextPassingRequest(request);
  const supabase = createServerClient(config.url, config.anonKey, {
    cookieOptions: supabaseAuthCookieOptions(request.nextUrl.protocol === "https:"),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = nextPassingRequest(request);
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/|favicon.ico|sw.js|icons/|brand/|manifest.webmanifest|apple-touch-icon.png).*)",
  ],
};
