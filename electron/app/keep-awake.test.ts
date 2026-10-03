import { expect, it, vi } from "vitest";

vi.mock("electron", () => ({ powerMonitor: {}, powerSaveBlocker: {} }));
import { KeepAwake, type Power } from "./keep-awake";

function setup(state: {
  enabled?: boolean;
  busy: boolean;
  battery: boolean;
  level?: number;
}) {
  let next = 1;
  const held = new Set<number>();
  const power: Power = {
    hold: () => {
      held.add(next);
      return next++;
    },
    release: (id) => held.delete(id),
    onBattery: () => state.battery,
    batteryLevel: vi.fn(async () => state.level),
  };
  let time = 0;
  const awake = new KeepAwake(
    { enabled: () => state.enabled ?? true, busy: () => state.busy },
    power,
    () => time,
  );
  return { awake, held, power, pass: (ms: number) => (time += ms) };
}

it("holds one blocker while plugged in, busy or not, and lets go when turned off", async () => {
  const state = { enabled: true, busy: false, battery: false };
  const { awake, held } = setup(state);
  await awake.refresh();
  await awake.refresh();
  expect(held.size).toBe(1);
  state.enabled = false;
  await awake.refresh();
  expect(held.size).toBe(0);
});

it("on battery, holds only while busy", async () => {
  const state = { busy: true, battery: true, level: 80 };
  const { awake, held } = setup(state);
  await awake.refresh();
  expect(held.size).toBe(1);
  state.busy = false;
  await awake.refresh();
  expect(held.size).toBe(0);
});

it("lets a computer on low battery sleep, and holds again once plugged in", async () => {
  const state = { busy: true, battery: true, level: 19 };
  const { awake, held } = setup(state);
  await awake.refresh();
  expect(held.size).toBe(0);
  state.battery = false;
  await awake.refresh();
  expect(held.size).toBe(1);
});

it("keeps holding on battery when the level can't be read", async () => {
  const { awake, held } = setup({ busy: true, battery: true });
  await awake.refresh();
  expect(held.size).toBe(1);
});

it("reads the battery every couple of minutes, not on every refresh", async () => {
  const state = { busy: true, battery: true, level: 80 };
  const { awake, held, power, pass } = setup(state);
  await awake.refresh();
  state.level = 10;
  await awake.refresh();
  expect(held.size).toBe(1);
  pass(3 * 60_000);
  await awake.refresh();
  expect(held.size).toBe(0);
  expect(power.batteryLevel).toHaveBeenCalledTimes(2);
});
