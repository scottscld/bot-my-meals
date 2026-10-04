import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseConfig } from "@/lib/config";
import { cookieSecureFromLocation, supabaseAuthCookieOptions } from "@/lib/supabase/auth-cookies";

export function createSupabaseBrowserClient() {
  const config = getPublicSupabaseConfig();
  if (!config) return null;
  const secure = cookieSecureFromLocation(
    typeof window === "undefined" ? undefined : window.location.protocol,
  );
  // Realtime auth is set in the provider: getSession, then realtime.setAuth, before subscribe.
  return createBrowserClient(config.url, config.anonKey, {
    cookieOptions: supabaseAuthCookieOptions(secure),
    auth: {
      // Recovery links are adopted on /login/new-password. Don't consume them here.
      detectSessionInUrl: false,
    },
  });
}
