import { describe, expect, it } from "vitest";
import { memberName, nameLooksLikeHandle, normalizeDisplayName } from "./names";

describe("member names", () => {
  it("falls back to the email handle, then Someone", () => {
    expect(memberName({ displayName: "", email: "madison@example.com" })).toBe("madison");
    expect(memberName({ displayName: "   ", email: "ian@example.com" })).toBe("ian");
    expect(memberName({ displayName: "", email: "" })).toBe("Someone");
    expect(memberName({ displayName: null, email: null })).toBe("Someone");
  });

  it("collapses whitespace and rejects empty, long, or control-character names", () => {
    expect(normalizeDisplayName("  Scott   Rosemary ")).toBe("Scott Rosemary");
    expect(normalizeDisplayName("")).toBeNull();
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(normalizeDisplayName("a".repeat(40))).toBe("a".repeat(40));
    expect(normalizeDisplayName("a".repeat(41))).toBeNull();
    expect(normalizeDisplayName("Ann\nLee")).toBe("Ann Lee");
    expect(normalizeDisplayName("Ann\u0001Lee")).toBeNull();
  });

  it("treats a handle-shaped name as the nudge, and a real name as done", () => {
    expect(nameLooksLikeHandle({ displayName: "Madison", email: "madison@example.com" })).toBe(true);
    expect(nameLooksLikeHandle({ displayName: "MADISON", email: "madison@example.com" })).toBe(true);
    expect(nameLooksLikeHandle({ displayName: "Madison Lee", email: "madison@example.com" })).toBe(
      false,
    );
    expect(nameLooksLikeHandle({ displayName: "", email: "madison@example.com" })).toBe(false);
  });
});
