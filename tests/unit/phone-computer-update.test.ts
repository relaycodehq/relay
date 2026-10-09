import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  followUpdates,
  updateComputer,
} from "../../mobile/src/remote/computer-update";
import type { RemoteClient } from "../../shared/remote-client";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const downloading = {
  status: "downloading",
  version: "0.10.0",
  progress: 0.1,
} as const;

function computer() {
  const asked = vi.fn();
  const call = (async (method: string) => {
    asked(method);
    return method === "updateNow"
      ? downloading
      : { version: "0.9.1", update: downloading };
  }) as unknown as RemoteClient["call"];
  return { asked, call };
}

it("stops watching a computer's update over its closed connection once the phone switches, and goes on over the next one", async () => {
  const mac = computer();
  await updateComputer("mac", "0.9.1", mac.call);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mac.asked).toHaveBeenLastCalledWith("computerInfo");

  followUpdates("linux", computer().call);
  mac.asked.mockClear();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(mac.asked).not.toHaveBeenCalled();

  // Back on the Mac, over a new connection.
  const again = computer();
  followUpdates("mac", again.call);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(again.asked).toHaveBeenCalledWith("computerInfo");
  expect(mac.asked).not.toHaveBeenCalled();
  followUpdates(undefined);
});
