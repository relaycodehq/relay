import { expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));
import {
  Presence,
  type PresenceEvent,
  type PresenceSignals,
} from "./presence";

function setup() {
  const at = { now: 0 };
  const state = {
    focused: true,
    idle: "active" as ReturnType<PresenceSignals["idleState"]>,
  };
  const listeners = new Map<PresenceEvent, () => void>();
  const presence = new Presence(
    {
      focused: () => state.focused,
      idleState: () => state.idle,
      on: (event, listener) => listeners.set(event, listener),
    },
    () => at.now,
  );
  const fire = (event: PresenceEvent) => listeners.get(event)?.();
  const leave = () => {
    state.focused = false;
    fire("blur");
  };
  return { presence, state, at, leave, fire };
}

it("counts someone as present for half an hour after Relay was in front, while they keep using the computer", () => {
  const { presence, at, leave } = setup();
  expect(presence.present()).toBe(true);
  leave();
  at.now = 29 * 60_000;
  expect(presence.present()).toBe(true);
  at.now = 31 * 60_000;
  expect(presence.present()).toBe(false);
});

it("hands the news back to the phone once the computer sits idle or locked, even with Relay in front", () => {
  const { presence, state, leave } = setup();
  state.idle = "idle";
  expect(presence.present()).toBe(false);
  state.idle = "locked";
  expect(presence.present()).toBe(false);
  leave();
  state.idle = "active";
  expect(presence.present()).toBe(true);
});

it("goes by input in Relay's own windows where the system can't tell idle", () => {
  const { presence, state, at, leave, fire } = setup();
  state.idle = "unknown";
  // Asked before anyone touched it, as when Relay restarts in front overnight.
  expect(presence.present()).toBe(false);
  fire("input");
  expect(presence.present()).toBe(true);
  // Left in front overnight.
  at.now = 11 * 60_000;
  expect(presence.present()).toBe(false);
  fire("input");
  at.now += 60_000;
  expect(presence.present()).toBe(true);
  leave();
  expect(presence.present()).toBe(false);
});

it("never counts someone who hasn't had Relay in front since launch", () => {
  const { presence, state } = setup();
  state.focused = false;
  expect(presence.present()).toBe(false);
});

it("counts nobody while the computer sleeps, and says so before it does", () => {
  const { presence, fire } = setup();
  const heard: boolean[] = [];
  const stop = presence.watch(() => heard.push(presence.present()));
  fire("suspend");
  fire("resume");
  stop();
  fire("suspend");
  expect(heard).toEqual([false, true]);
});

it("wakes on unlock too, as a resume can go missing", () => {
  const { presence, fire } = setup();
  fire("suspend");
  expect(presence.present()).toBe(false);
  fire("unlock");
  expect(presence.present()).toBe(true);
});

it("hears input from launch where the system can't tell idle, before anyone asks", () => {
  const listeners = new Map<PresenceEvent, () => void>();
  const at = { now: 0 };
  const presence = new Presence(
    {
      focused: () => true,
      idleState: () => "unknown",
      on: (event, listener) => listeners.set(event, listener),
    },
    () => at.now,
  );
  listeners.get("input")?.();
  at.now = 60_000;
  expect(presence.present()).toBe(true);
});
