import { afterEach, expect, it, vi } from "vitest";
import { PendingPairing } from "../../mobile/src/remote/pairing";

afterEach(() => vi.useRealTimers());

const timedOut = () => new Error("timed out");

it("pairs on the new computer coming online, not the one it was on", async () => {
  const pairing = new PendingPairing<string>();
  const settled = vi.fn();
  const paired = pairing.wait(15_000, timedOut).then(settled);
  // Back from the QR scanner: the old computer reconnects while the new one's
  // cached lists still load.
  pairing.online("old computer");
  pairing.started("new computer");
  pairing.online("old computer");
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();

  pairing.online("new computer");
  await paired;
  expect(settled).toHaveBeenCalled();
});

it("fails only on the new computer saying no", async () => {
  const pairing = new PendingPairing<string>();
  const paired = pairing.wait(15_000, timedOut);
  pairing.started("new computer");
  pairing.denied("old computer", "This phone isn't paired with Relay anymore.");
  pairing.denied("new computer", "Wrong pairing code.");
  await expect(paired).rejects.toThrow("Wrong pairing code.");
});

it("gives up on a computer that never answers, without touching a pairing started since", async () => {
  vi.useFakeTimers();
  const pairing = new PendingPairing<string>();
  const first = vi.fn();
  void pairing.wait(15_000, timedOut).catch(first);
  vi.advanceTimersByTime(10_000);
  const second = pairing.wait(15_000, timedOut);
  pairing.started("second");
  vi.advanceTimersByTime(6_000);
  // The first one's time ran out, but the second is the one waiting now.
  expect(first).not.toHaveBeenCalled();
  pairing.online("second");
  await expect(second).resolves.toBeUndefined();

  const third = pairing.wait(15_000, timedOut);
  vi.advanceTimersByTime(15_000);
  await expect(third).rejects.toThrow("timed out");
});
