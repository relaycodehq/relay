import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickSound, SoundCues, type SoundCue } from "./sound-cues";
import type { NewsItem } from "./thread-news";

let seq = 0;
const news = (
  chatId: string,
  kind: NewsItem["kind"],
  more: Partial<NewsItem> = {},
): NewsItem => ({
  chatId,
  kind,
  title: "Thread",
  body: "",
  projectId: "p",
  seq: ++seq,
  at: 1,
  ...more,
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
    cues.news(news("a", "finished"));
    cues.news(news("b", "waiting"));
    await vi.runAllTimersAsync();
    expect(heard).toEqual([
      [
        { event: "finished", projectId: "p" },
        { event: "waiting", projectId: "p" },
      ],
    ]);
  });

  it("stays quiet for a done thread an agent started, and where it isn't heard", async () => {
    hears = (id) => id !== "b";
    cues.news(news("a", "finished", { byAgent: true }));
    cues.news(news("b", "finished"));
    await vi.runAllTimersAsync();
    expect(heard).toEqual([]);
    // Its failure still sounds: the agent that started it may not notice.
    cues.news(news("a", "failed", { byAgent: true }));
    await vi.runAllTimersAsync();
    expect(heard).toEqual([[{ event: "failed", projectId: "p" }]]);
  });

  it("plays a thread that needs you right after another sound once the rest is over", async () => {
    cues.news(news("a", "finished"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(heard).toEqual([[{ event: "finished", projectId: "p" }]]);
    cues.news(news("b", "waiting"));
    await vi.advanceTimersByTimeAsync(500);
    expect(heard).toHaveLength(1);
    await vi.runAllTimersAsync();
    expect(heard).toEqual([
      [{ event: "finished", projectId: "p" }],
      [{ event: "waiting", projectId: "p" }],
    ]);
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
