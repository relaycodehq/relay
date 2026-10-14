import { expect, it } from "vitest";
import { consumeReset } from "./codex-resets";
import type { CodexTransport } from "./codex-transport";

function wire(outcome: unknown) {
  const sent: { method: string; params: unknown }[] = [];
  const transport: CodexTransport = {
    request: async () => ({}),
    call: async (method, params, schema) => {
      sent.push({ method, params });
      return schema.parse({ outcome });
    },
    notify: async () => {},
  };
  return { transport, sent };
}

it("sends the attempt as Codex's idempotency key, with the reset to spend", async () => {
  const { transport, sent } = wire("reset");
  await expect(consumeReset(transport, "credit-1", "attempt-1")).resolves.toBe(
    "reset",
  );
  expect(sent).toEqual([
    {
      method: "account/rateLimitResetCredit/consume",
      params: { idempotencyKey: "attempt-1", creditId: "credit-1" },
    },
  ]);
});

it("passes on Codex's refusals and doesn't guess at an outcome it doesn't know", async () => {
  await expect(
    consumeReset(wire("nothingToReset").transport, null, "a"),
  ).resolves.toBe("nothingToReset");
  await expect(
    consumeReset(wire("partiallyReset").transport, null, "a"),
  ).resolves.toBe("unknown");
});
