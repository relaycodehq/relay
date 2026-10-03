import { it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { rearmOnWake } from "./wake";

it("arms again when the computer wakes or the screen unlocks", () => {
  const power = new EventEmitter();
  const rearm = vi.fn();
  rearmOnWake(power, rearm);
  power.emit("suspend");
  expect(rearm).not.toHaveBeenCalled();
  power.emit("resume");
  power.emit("unlock-screen");
  expect(rearm).toHaveBeenCalledTimes(2);
});
