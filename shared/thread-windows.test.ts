import { describe, expect, it } from "vitest";
import {
  placeOnScreen,
  savedThreadWindows,
  threadWindowExists,
  threadWindowOf,
  threadWindowSearch,
} from "./thread-windows";

const screen = { x: 0, y: 0, width: 1920, height: 1080 };

describe("thread window pages", () => {
  it("reads back the thread it was loaded for, odd ids and all", () => {
    const thread = { projectId: "p:1&x", chatId: "c/2?%" };
    expect(threadWindowOf(`?${threadWindowSearch(thread)}`)).toEqual(thread);
  });

  it("is the main window without both ids", () => {
    expect(threadWindowOf("")).toBeNull();
    expect(threadWindowOf("?sounds")).toBeNull();
    expect(threadWindowOf("?thread=c1")).toBeNull();
  });
});

describe("placeOnScreen", () => {
  it("keeps a window where it was while its display is there", () => {
    const saved = { x: 2000, y: 100, width: 900, height: 700 };
    const right = { x: 1920, y: 0, width: 2560, height: 1440 };
    expect(placeOnScreen(saved, [screen, right], screen)).toEqual(saved);
  });

  it("centres it on the main display when its display is gone", () => {
    const saved = { x: 2000, y: 100, width: 900, height: 700 };
    expect(placeOnScreen(saved, [screen], screen)).toEqual({
      x: 510,
      y: 190,
      width: 900,
      height: 700,
    });
  });

  it("doesn't count a sliver left at an edge as on screen", () => {
    const saved = { x: 1900, y: 100, width: 900, height: 700 };
    expect(placeOnScreen(saved, [screen], screen).x).toBe(510);
  });

  it("moves a window whose title bar was on a display above that's gone", () => {
    const saved = { x: 200, y: -1000, width: 1500, height: 1100 };
    expect(placeOnScreen(saved, [screen], screen).y).toBe(0);
  });

  it("keeps a window whose title bar sits on a display above", () => {
    const above = { x: 0, y: -1440, width: 2560, height: 1440 };
    const saved = { x: 200, y: -1000, width: 1500, height: 1100 };
    expect(placeOnScreen(saved, [screen, above], screen)).toEqual(saved);
  });

  it("shrinks a window bigger than the display it lands on", () => {
    const saved = { x: 5000, y: 0, width: 2500, height: 1400 };
    expect(placeOnScreen(saved, [screen], screen)).toEqual(screen);
  });
});

describe("savedThreadWindows", () => {
  it("drops what doesn't read as a window", () => {
    const good = {
      projectId: "p",
      chatId: "c",
      bounds: { x: -1200, y: 40, width: 900, height: 700 },
    };
    expect(
      savedThreadWindows([good, { chatId: "c" }, { ...good, bounds: null }, 3]),
    ).toEqual([good]);
    expect(savedThreadWindows(undefined)).toEqual([]);
  });
});

describe("threadWindowExists", () => {
  const projects = [{ id: "p" }, { id: "gone", removed: 1 }];
  const chats = [
    { id: "c", projectId: "p" },
    { id: "hidden", projectId: "gone" },
  ];

  it("keeps a window whose thread is still in its project", () => {
    expect(
      threadWindowExists({ projectId: "p", chatId: "c" }, projects, chats),
    ).toBe(true);
  });

  it("drops one whose project was removed, or whose thread is elsewhere or gone", () => {
    const exists = (projectId: string, chatId: string) =>
      threadWindowExists({ projectId, chatId }, projects, chats);
    expect(exists("gone", "hidden")).toBe(false);
    expect(exists("p", "hidden")).toBe(false);
    expect(exists("p", "deleted")).toBe(false);
  });
});
