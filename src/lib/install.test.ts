import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  INSTALL_DISMISSED_KEY,
  INSTALL_IOS_COPY,
  INSTALL_PROMPT_COPY,
  isIosDevice,
  isStandaloneDisplay,
  shouldHintIosInstall,
} from "./install";

const srcRoot = path.resolve(import.meta.dirname, "..");

describe("install hints", () => {
  it("keeps the existing supper dismiss key", () => {
    expect(INSTALL_DISMISSED_KEY).toBe("supper-install-dismissed");
  });

  it("hints iOS Safari only when not standalone and not dismissed", () => {
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
    expect(
      shouldHintIosInstall({
        standalone: false,
        dismissed: false,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      }),
    ).toBe(true);
    expect(
      shouldHintIosInstall({
        standalone: true,
        dismissed: false,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      }),
    ).toBe(false);
    expect(
      shouldHintIosInstall({
        standalone: false,
        dismissed: true,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      }),
    ).toBe(false);
  });

  it("treats standalone display-mode or navigator.standalone as installed", () => {
    expect(isStandaloneDisplay(() => ({ matches: true }), false)).toBe(true);
    expect(isStandaloneDisplay(() => ({ matches: false }), true)).toBe(true);
    expect(isStandaloneDisplay(() => ({ matches: false }), false)).toBe(false);
  });

  it("keeps install copy and 48px banner actions", () => {
    const banner = readFileSync(path.join(srcRoot, "components/install-prompt.tsx"), "utf8");
    expect(banner).toContain("INSTALL_IOS_COPY");
    expect(banner).toContain("INSTALL_PROMPT_COPY");
    expect(banner).toContain('size="fat"');
    expect(banner).toContain("shadow-card");
    expect(INSTALL_IOS_COPY).toMatch(/Share/);
    expect(INSTALL_PROMPT_COPY).toMatch(/Home Screen/);
  });
});

describe("Clear Sky PWA craft", () => {
  it("restyles the install banner and precaches /setup on Clear Sky tokens", () => {
    const banner = readFileSync(path.join(srcRoot, "components/install-prompt.tsx"), "utf8");
    const sw = readFileSync(path.resolve(srcRoot, "../public/sw.js"), "utf8");
    const shell = readFileSync(path.join(srcRoot, "components/app-shell.tsx"), "utf8");

    expect(banner).toContain('data-slot="install-banner"');
    expect(banner).not.toContain("mt-4");
    expect(banner).toContain("mb-4");
    expect(banner).toContain("ring-1 ring-primary/20");
    expect(banner).toContain("bg-card");
    expect(banner).toContain('size="fat"');
    expect(banner).not.toContain("#b35025");
    expect(banner).not.toContain("Fraunces");
    expect(banner).not.toContain("Clear Sky");
    expect(sw).toContain('"/setup"');
    expect(sw).toContain("supper-shell-v6");
    expect(sw).toContain("skipWaiting");
    expect(sw).not.toContain("addAll");
    expect(shell).toContain("flex-1 px-4 pt-4");
    expect(shell).toContain("bg-card/95");
    expect(shell).toContain("pt-[env(safe-area-inset-top)]");
    expect(shell).toContain("pb-[max(0.5rem,env(safe-area-inset-bottom))]");
  });
});
