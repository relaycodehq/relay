import { describe, expect, it } from "vitest";
import { unreadStart } from "../../../shared/chat-activity";
import { nextArrival, type Arrival } from "./arrival";

const step = (
  prev: Arrival | undefined,
  patch: Partial<Parameters<typeof nextArrival>[1]>,
) =>
  nextArrival(prev, {
    chatId: "c",
    readTo: 0,
    updated: 0,
    now: 0,
    opened: false,
    refocused: false,
    ...patch,
  });

describe("arrival", () => {
  it("holds still while you watch answers land", () => {
    const opened = step(undefined, { opened: true, readTo: 100, now: 200 });
    expect(step(opened, { readTo: 250, updated: 300, now: 300 })).toBe(opened);
  });

  it("starts afresh in another thread", () => {
    const opened = step(undefined, { opened: true, readTo: 100, now: 200 });
    expect(
      step(opened, { chatId: "d", readTo: 50, updated: 60, now: 300 }),
    ).toEqual({ chatId: "d", away: [{ from: 50, to: 300 }], read: false });
  });

  it("marks what landed while Relay was behind another app, not what you watched", () => {
    const thread = [
      { id: "ask", created: 100 },
      { id: "watched", created: 210, ended: 240 },
      { id: "landed", created: 400, ended: 450 },
    ];
    // Opened with nothing new, watched an answer, then left the window at 250.
    const opened = step(undefined, { opened: true, readTo: 150, now: 200 });
    expect(unreadStart(thread, opened!.away)).toBeUndefined();
    const back = step(opened, {
      refocused: true,
      readTo: 240,
      updated: 450,
      now: 500,
    });
    expect(unreadStart(thread, back!.away)).toEqual({
      id: "landed",
      since: 240,
    });
  });

  it("keeps an unseen divider where it was when more lands", () => {
    const opened = step(undefined, { opened: true, readTo: 100, now: 200 });
    const back = step(opened, {
      refocused: true,
      readTo: 250,
      updated: 300,
      now: 400,
    });
    expect(back!.away).toEqual([
      { from: 100, to: 200 },
      { from: 250, to: 400 },
    ]);
  });

  it("starts at the new answers once the divider has faded", () => {
    const opened = step(undefined, { opened: true, readTo: 100, now: 200 });
    const back = step(
      { ...opened!, read: true },
      { refocused: true, readTo: 250, updated: 300, now: 400 },
    );
    expect(back).toEqual({
      chatId: "c",
      away: [{ from: 250, to: 400 }],
      read: false,
    });
  });

  it("leaves a faded divider faded when nothing landed meanwhile", () => {
    const faded = {
      ...step(undefined, { opened: true, readTo: 100, now: 200 })!,
      read: true,
    };
    expect(step(faded, { refocused: true, readTo: 300, updated: 300 })).toBe(
      faded,
    );
  });
});
