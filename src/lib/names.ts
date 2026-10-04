const CONTROL = /[\u0000-\u001F\u007F]/;

/** Same rules as private.clean_display_name. Null means the name is not stored. */
export function normalizeDisplayName(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value || value.length > 40 || CONTROL.test(value)) return null;
  return value;
}

/** The name the house sees. A blank name falls back to the email handle. */
export function memberName(member: { displayName?: string | null; email?: string | null }): string {
  const name = member.displayName?.trim();
  if (name) return name;
  const handle = member.email?.split("@")[0]?.trim();
  if (handle) return handle;
  return "Someone";
}

/** True when the stored name is still the email handle, so Settings can ask for a real name. */
export function nameLooksLikeHandle(member: {
  displayName?: string | null;
  email?: string | null;
}): boolean {
  const name = member.displayName?.trim();
  const handle = member.email?.split("@")[0]?.trim();
  if (!name || !handle) return false;
  return name.toLowerCase() === handle.toLowerCase();
}
