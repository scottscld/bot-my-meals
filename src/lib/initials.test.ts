import { describe, expect, it } from "vitest";
import { memberInitials, memberProgressInitial } from "./initials";

describe("memberInitials", () => {
  it("uses the first two letters of a single given name", () => {
    expect(memberInitials("Alex")).toBe("AL");
    expect(memberInitials("Sam")).toBe("SA");
  });

  it("uses first and last initials for a multi-word name", () => {
    expect(memberInitials("Alex Rivera")).toBe("AR");
    expect(memberInitials("Sam Lee Park")).toBe("SP");
  });

  it("trims whitespace and ignores empty names", () => {
    expect(memberInitials("  Jordan  Miles  ")).toBe("JM");
    expect(memberInitials("   ")).toBe("?");
    expect(memberInitials("")).toBe("?");
  });

  it("keeps a single character name as one letter", () => {
    expect(memberInitials("Q")).toBe("Q");
  });

  it("uses two-word initials and the first two letters of a dotted handle", () => {
    expect(memberInitials("Scott Rosemary")).toBe("SR");
    expect(memberInitials("ledgers-cackle.0x")).toBe("LE");
  });
});

describe("memberProgressInitial", () => {
  it("uses the first letter of the display-name initials", () => {
    expect(memberProgressInitial("Alex")).toBe("A");
    expect(memberProgressInitial("Sam Lee")).toBe("S");
    expect(memberProgressInitial("")).toBe("?");
  });
});
