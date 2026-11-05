import { afterEach, expect, it, vi } from "vitest";
import { ToolHandlerSlot } from "./tool-handler-slot";

afterEach(() => vi.useRealTimers());

const handler = async () => ({
  content: [{ type: "text" as const, text: "ok" }],
});

it("hands a waiting call the handler once Relay can answer", async () => {
  const slot = new ToolHandlerSlot();
  const waiting = slot.waitFor(new AbortController().signal);
  slot.fill(handler);
  await expect(waiting).resolves.toBe(handler);
});

it("tells a waiting call to try again when Relay never answers tools", async () => {
  vi.useFakeTimers();
  const slot = new ToolHandlerSlot();
  const waiting = expect(
    slot.waitFor(new AbortController().signal),
  ).rejects.toThrow("Relay is still starting");
  await vi.advanceTimersByTimeAsync(60_000);
  await waiting;
  // A handler that comes later answers the next call.
  slot.fill(handler);
  await expect(slot.waitFor(new AbortController().signal)).resolves.toBe(
    handler,
  );
});
