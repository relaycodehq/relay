import { describe, expect, it } from "vitest";
import type { AwayThread } from "../../../shared/handoff";
import {
  reachable,
  summary,
  threadLine,
  type Computer,
} from "./computer-status";

const min = 60_000;
const now = 1_000 * 24 * 60 * min;
const thread = (t: Partial<AwayThread>): AwayThread => ({
  chatId: "t",
  projectId: "p",
  project: "Relay",
  title: "A thread",
  state: "working",
  since: now,
  ...t,
});
const computer = (c: Partial<Computer>): Computer => ({
  id: "mini",
  name: "Mac mini",
  status: "online",
  threads: [],
  ...c,
});

describe("a thread's line on the computer card", () => {
  it("says how long it has been working or waiting", () => {
    expect(threadLine(thread({ since: now - 20_000 }), now)).toBe(
      "working · just now",
    );
    expect(
      threadLine(thread({ state: "waiting", since: now - 12 * min }), now),
    ).toBe("waiting for you · 12 min");
    expect(threadLine(thread({ since: now - 3 * 60 * min }), now)).toBe(
      "working · 3 h",
    );
    expect(threadLine(thread({ since: now - 72 * 60 * min }), now)).toBe(
      "working · 3 d",
    );
  });

  it("says when it finished", () => {
    expect(threadLine(thread({ state: "finished" }), now)).toBe(
      "finished just now",
    );
    expect(
      threadLine(thread({ state: "finished", since: now - 4 * min }), now),
    ).toBe("finished 4 min ago");
  });

  it("keeps only the first line of a stopped agent's error, cut at 120", () => {
    expect(
      threadLine(thread({ state: "stopped", error: "boom\nstack" }), now),
    ).toBe("stopped · boom");
    const line = threadLine(
      thread({ state: "stopped", error: "x".repeat(200) }),
      now,
    );
    expect(line).toBe(`stopped · ${"x".repeat(119)}…`);
    expect(threadLine(thread({ state: "stopped" }), now)).toBe(
      "stopped with an error",
    );
  });

  it("says why a thread on a sleeping or stopped WSL computer can't be checked", () => {
    const unknown = thread({ state: "unknown" });
    expect(threadLine(unknown, now)).toBe("can't check while it's offline");
    expect(threadLine(unknown, now, { asleep: true })).toBe(
      "checks once it's woken",
    );
    expect(threadLine(unknown, now, { stopped: true })).toBe(
      "can't check while WSL has it stopped",
    );
  });

  it("shows a failed hand-off's own error", () => {
    expect(threadLine(thread({ state: "failed", error: "No room" }), now)).toBe(
      "No room",
    );
    expect(threadLine(thread({ state: "failed" }), now)).toBe("didn't arrive");
    expect(
      threadLine(thread({ state: "failed", error: "Its work…\nhint: …" }), now),
    ).toBe("Its work…");
  });
});

describe("a computer's line on the map", () => {
  it("puts an update under way before anything else", () => {
    expect(
      summary(
        computer({
          outdated: true,
          update: {
            status: "downloading",
            current: "0.4.0",
            version: "0.5.0",
            progress: 0.426,
          },
        }),
      ),
    ).toBe("Downloading 0.5.0 · 43%");
  });

  it("counts the threads over there", () => {
    expect(summary(computer({}))).toBe("Connected");
    expect(summary(computer({ threads: [thread({})] }))).toBe(
      "Connected · 1 thread",
    );
    expect(summary(computer({ threads: [thread({}), thread({})] }))).toBe(
      "Connected · 2 threads",
    );
    expect(summary(computer({ outdated: true }))).toBe("Needs a Relay update");
  });

  it("drops the offline detail on the map but not a denied pairing", () => {
    expect(summary(computer({ status: "offline", detail: "timed out" }))).toBe(
      "Offline",
    );
    expect(summary(computer({ status: "denied" }))).toBe(
      "It no longer accepts this computer. Pair again.",
    );
  });

  it("tells a WSL distribution asleep, which use wakes, from one WSL stopped", () => {
    const asleep = computer({ status: "offline", asleep: true });
    expect(summary(asleep)).toBe("Asleep · wakes when used");
    expect(reachable(asleep)).toBe(true);
    const stopped = computer({
      status: "offline",
      stopped: true,
      detail: "WSL stopped it.",
    });
    expect(summary(stopped)).toBe("WSL stopped it");
    expect(reachable(stopped)).toBe(false);
  });
});
