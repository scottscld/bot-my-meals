import { describe, expect, it, vi } from "vitest";
import { handlePushDispatch, type PushDispatchClaim } from "@/lib/push-dispatch";
import type { PushConfig } from "@/lib/push-config";

const config: PushConfig = {
  publicKey: "public",
  privateKey: "private",
  subject: "mailto:test@example.com",
  dispatchSecret: "secret-hex",
};

const claimBody: PushDispatchClaim = {
  id: 7,
  kind: "menu_ready",
  week_id: "week-1",
  message: { title: "Bot My Meals", body: "Ready", url: "/week", tag: "menu_ready:week-1" },
  subscriptions: [],
};

describe("handlePushDispatch", () => {
  it("rejects a wrong secret", async () => {
    const result = await handlePushDispatch({
      secretHeader: "nope",
      body: { outbox_id: 1 },
      config,
      claim: vi.fn(),
      send: vi.fn(),
      report: vi.fn(),
    });
    expect(result.status).toBe(401);
  });

  it("skips when the claim returns nothing", async () => {
    const result = await handlePushDispatch({
      secretHeader: config.dispatchSecret,
      body: { outbox_id: 4 },
      config,
      claim: async () => null,
      send: vi.fn(),
      report: vi.fn(),
    });
    expect(result).toEqual({ status: 200, body: { skipped: true } });
  });

  it("reports zero sends and passes gone endpoints to the report", async () => {
    const report = vi.fn(async () => undefined);
    const empty = await handlePushDispatch({
      secretHeader: config.dispatchSecret,
      body: { outbox_id: 7 },
      config,
      claim: async () => claimBody,
      send: vi.fn(),
      report,
    });
    expect(empty.body).toEqual({ sent: 0, gone: 0, failed: 0 });
    expect(report).toHaveBeenCalledWith(config.dispatchSecret, 7, [], [], null);

    const gone = await handlePushDispatch({
      secretHeader: config.dispatchSecret,
      body: { outbox_id: 8 },
      config,
      claim: async () => ({
        ...claimBody,
        id: 8,
        subscriptions: [{ endpoint: "https://push.example/gone", keys: { p256dh: "p", auth: "a" } }],
      }),
      send: async () => ({ ok: false, gone: true, status: 410 }),
      report,
    });
    expect(gone.body).toMatchObject({ sent: 0, gone: 1, failed: 0 });
    expect(report).toHaveBeenLastCalledWith(
      config.dispatchSecret,
      8,
      ["https://push.example/gone"],
      [],
      null,
    );
  });
});
