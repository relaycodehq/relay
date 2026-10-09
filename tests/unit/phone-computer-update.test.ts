import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  followUpdates,
  updateComputer,
} from "../../mobile/src/remote/computer-update";
import type { RemoteClient } from "../../shared/remote-client";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  followUpdates(undefined);
  vi.useRealTimers();
});

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
  followUpdates("mac", mac.call);
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

it("does not revive the old connection when updateNow answers after switching", async () => {
  let answer!: (value: typeof downloading) => void;
  const asked = vi.fn();
  const call = ((method: string) => {
    asked(method);
    return new Promise<typeof downloading>((resolve) => { answer = resolve; });
  }) as RemoteClient["call"];
  followUpdates("late", call);
  const updating = updateComputer("late", "0.9.1", call);
  followUpdates("elsewhere", computer().call);
  answer(downloading);
  await updating;
  await vi.advanceTimersByTimeAsync(20_000);
  expect(asked.mock.calls).toEqual([["updateNow"]]);
  const again = computer();
  followUpdates("late", again.call);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(again.asked).toHaveBeenCalledWith("computerInfo");
});

it("ignores an old poll's answer and keeps only one poll in flight", async () => {
  const mac = computer();
  followUpdates("pending", mac.call);
  await updateComputer("pending", "0.9.1", mac.call);
  let answer!: (value: unknown) => void;
  const poll = vi.fn(() => new Promise((resolve) => { answer = resolve; }));
  followUpdates("pending", poll as RemoteClient["call"]);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(poll).toHaveBeenCalledTimes(1);
  const again = computer();
  followUpdates("pending", again.call);
  answer({ version: "0.10.0", update: { status: "idle" } });
  await vi.advanceTimersByTimeAsync(2_000);
  expect(again.asked).toHaveBeenCalledWith("computerInfo");
});
