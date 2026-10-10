import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSummary } from "./projects";
import { pickSound, SoundCues, type SoundCue } from "./sound-cues";

const chat = (patch: Partial<ChatSummary>): ChatSummary => ({
  id: "a",
  projectId: "p",
  title: "Thread",
  scope: { kind: "project" },
  created: 1,
  updated: 1,
  ...patch,
});

describe("SoundCues", () => {
  let heard: SoundCue[][];
  let hears: (chatId: string) => boolean;
  let cues: SoundCues;
  beforeEach(() => {
    vi.useFakeTimers();
    heard = [];
    hears = () => true;
    cues = new SoundCues({
      hears: (id) => hears(id),
      play: async (c) => {
        heard.push(c);
        return true;
      },
    });
  });
  afterEach(() => vi.useRealTimers());

  it("sounds once for threads that land together", async () => {
    cues.list("p", [
      chat({ id: "a", running: true }),
      chat({ id: "b", running: true }),
    ]);
    cues.list("p", [
      chat({ id: "a", updated: 2 }),
      chat({ id: "b", updated: 2, waiting: true }),
    ]);
    await vi.runAllTimersAsync();
    expect(heard).toEqual([
      [
        { event: "finished", projectId: "p" },
        { event: "waiting", projectId: "p" },
      ],
    ]);
  });

  it("stays quiet for a done thread an agent started, and where it isn't heard", async () => {
    const started = { chatId: "lead", agent: "claude" } as const;
    cues.list("p", [
      chat({ id: "a", running: true, startedBy: started }),
      chat({ id: "b", running: true }),
    ]);
    hears = (id) => id !== "b";
    cues.list("p", [
      chat({ id: "a", updated: 2, startedBy: started }),
      chat({ id: "b", updated: 2 }),
    ]);
    await vi.runAllTimersAsync();
    expect(heard).toEqual([]);
  });
});

describe("pickSound", () => {
  const app = { finished: "marimba", waiting: "ask" } as const;
  it("plays the most urgent cue that has a sound, at the app's volume", () => {
    expect(
      pickSound(
        [
          { event: "finished", projectId: "p" },
          { event: "waiting", projectId: "p" },
          { event: "failed", projectId: "p" },
        ],
        app,
        () => undefined,
      ),
    ).toEqual({ sound: "ask", volume: 0.7 });
  });

  it("follows a project's own pick, and its silence", () => {
    const own = { p: { finished: "tink" }, q: { finished: "off" } } as const;
    const project = (id: string) => own[id as keyof typeof own];
    expect(
      pickSound([{ event: "finished", projectId: "p" }], app, project),
    ).toEqual({ sound: "tink", volume: 0.7 });
    expect(
      pickSound([{ event: "finished", projectId: "q" }], app, project),
    ).toBeUndefined();
  });
});
