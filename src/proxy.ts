import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/config";
import { supabaseAuthCookieOptions } from "@/lib/supabase/auth-cookies";

export async function proxy(request: NextRequest) {
  const config = getPublicSupabaseConfig();
  if (!config) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.anonKey, {
    cookieOptions: supabaseAuthCookieOptions(request.nextUrl.protocol === "https:"),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
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
    "/((?!_next/|favicon.ico|sw.js|icons/|brand/|manifest.webmanifest|apple-touch-icon.png|api/push/dispatch).*)",
  ],
};
