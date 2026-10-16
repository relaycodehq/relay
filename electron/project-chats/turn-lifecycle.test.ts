import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findExecutable } from "../platform/executables";
import type { AgentProvider } from "../../shared/projects";
import {
  recordedChoice,
  startScenario,
  type Scenario,
  type ScenarioOptions,
} from "../../tests/fixtures/turn-scenario";

vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));

// How a thread's turns start and end, as a person or a phone sees it: whether
// the thread reads running, what was news, what each answer ended as. See
// docs/turn-lifecycle.md.

let s: Scenario | undefined;
const start = async (options: Omit<ScenarioOptions, "findExecutable"> = {}) =>
  (s = await startScenario({
    findExecutable: vi.mocked(findExecutable),
    ...options,
  }));
afterEach(async () => {
  await s?.dispose();
  s = undefined;
  vi.restoreAllMocks();
});
const kinds = (news: { kind: string }[]) => news.map((n) => n.kind);
const answers = async (id: string) =>
  (await s!.messages(id)).filter((m) => m.role === "assistant");

const recorded = (provider: AgentProvider, scenario: string) =>
  existsSync(join("tests/fixtures/replays", provider, scenario, "01.jsonl"));
const replayed: AgentProvider[] = ["claude", "codex", "opencode", "cursor"];

describe.each(replayed.filter((p) => recorded(p, "simple")))(
  "a recorded %s",
  (provider) => {
    const replay = (scenario: string, fault?: "exit" | "close") =>
      start({ replay: { provider, scenario, fault } });
    const send = (id: string, body: string) =>
      s!.send(id, body, provider, { choice: recordedChoice(provider) });

    it("answers, reads running meanwhile, and is news once", async () => {
      await replay("simple");
      const id = await s!.thread();
      await send(id, "Reply with exactly the word pong and nothing else.");
      await s!.until(id, (c) => !!c.running);
      await s!.ended(id);
      expect(await answers(id)).toMatchObject([
        { status: "complete", body: "pong" },
      ]);
      expect(kinds(s!.news)).toEqual(["finished"]);
    });

    it.runIf(recorded(provider, "tool"))(
      "runs a tool and is news once",
      async () => {
        await replay("tool");
        const id = await s!.thread();
        await send(
          id,
          "Create a file named notes.txt in the current folder containing the word hello. Then reply with exactly: done",
        );
        await s!.ended(id);
        const [answer] = await answers(id);
        expect(answer.status).toBe("complete");
        expect(answer.trace?.some((e) => e.kind === "activity")).toBe(true);
        expect(kinds(s!.news)).toEqual(["finished"]);
      },
    );

    it.runIf(recorded(provider, "two-turns"))(
      "is news once for each of two turns",
      async () => {
        await replay("two-turns");
        const id = await s!.thread();
        await send(id, "Reply with exactly the word pong and nothing else.");
        await s!.ended(id);
        await send(id, "Now reply with exactly the word ping and nothing else.");
        await s!.ended(id);
        expect((await answers(id)).map((a) => a.status)).toEqual([
          "complete",
          "complete",
        ]);
        expect(kinds(s!.news)).toEqual(["finished", "finished"]);
      },
    );

    it.runIf(recorded(provider, "stop"))(
      "stops a running command without news",
      async () => {
        await replay("stop");
        const id = await s!.thread();
        await send(
          id,
          'Run this shell command in the foreground and wait for it: python3 -c "import time; time.sleep(30)" . Then reply with exactly: finished',
        );
        await s!.message(
          id,
          (m) =>
            !!m.trace?.some(
              (e) => e.kind === "activity" && e.activity.status === "running",
            ),
        );
        await s!.chats.cancel(id);
        await s!.ended(id);
        expect((await answers(id)).at(-1)?.status).toBe("cancelled");
        expect(s!.news).toEqual([]);
      },
    );

    it.each(["exit", "close"] as const)(
      "ends the turn when the agent's last line never comes (%s)",
      async (fault) => {
        await replay("simple", fault);
        const id = await s!.thread();
        await send(id, "Reply with exactly the word pong and nothing else.");
        await s!.ended(id);
        expect((await answers(id)).at(-1)?.status).toBe("failed");
        expect(kinds(s!.news)).toEqual(["failed"]);
      },
    );
  },
);

// Known bug: the turn gives the thread back before its summary moves
// `updated`, and a list already due goes out in between reading idle with
// nothing new, so the turn is never news.
it.runIf(recorded("claude", "background")).fails(
  "shows the turn Claude starts by itself and is news for it",
  async () => {
    // Claude went quiet for 4s before its own turn; a second and a half
    // keeps the two turns apart as they were.
    await start({
      replay: { provider: "claude", scenario: "background" },
      env: { RELAY_REPLAY_GAP_MS: "1500" },
    });
    const id = await s!.thread();
    await s!.send(
      id,
      `Start this shell command as a background task (run_in_background): python3 -c "import time; time.sleep(4); print('background-done')" . Reply with exactly: started, and end your turn without waiting for it.`,
      "claude",
      { choice: recordedChoice("claude") },
    );
    await s!.message(id, (m) => !!m.unprompted);
    await s!.until(id, (c) => !!c.running);
    await s!.ended(id);
    expect((await answers(id)).map((a) => a.status)).toEqual([
      "complete",
      "complete",
    ]);
    expect(kinds(s!.news)).toEqual(["finished", "finished"]);
  },
);

describe("known lifecycle bugs", () => {
  it(
    "reads stopping, not idle, while a stopped agent winds down",
    async () => {
      await start();
      const release = join(s!.root, "stop-release");
      vi.stubEnv("RELAY_FIXTURE_STOP_RELEASE", release);
      const id = await s!.thread();
      await s!.send(id, "fixture wait for cancellation");
      await s!.until(id, (c) => !!c.running);
      await s!.chats.cancel(id);
      // The agent hasn't let go yet: the thread is neither running nor idle.
      const stopping = await s!.until(id, (c) => !c.running);
      expect(stopping).toMatchObject({ stopping: true });
      await writeFile(release, "");
      await s!.ended(id);
      expect(s!.summary(id)).not.toMatchObject({ stopping: true });
    },
  );

  it(
    "keeps the thread running while a turn Claude started beside another one runs",
    async () => {
      await start();
      const id = await s!.thread();
      // Claude's background task ends while Codex holds the thread, so the
      // turn Claude starts rides beside Codex's and outlives it.
      await s!.send(id, "fixture background task to steer", "claude");
      await s!.ended(id);
      vi.stubEnv("RELAY_AGENT_TURN_MS", "600");
      await s!.send(id, "fixture echo: codex holds the thread");
      const idleWhileStreaming: string[] = [];
      const stop = s!.watch(() => {
        const listed = s!.summary(id);
        if (listed && !listed.running && s!.streaming(id).length)
          idleWhileStreaming.push(s!.streaming(id)[0].id);
      });
      await s!.message(id, (m) => !!m.unprompted && m.status === "streaming");
      await s!.message(
        id,
        (m) => m.provider === "codex" && m.status === "complete",
      );
      await s!.chats.cancel(id);
      await s!.ended(id);
      stop();
      expect(idleWhileStreaming).toEqual([]);
    },
  );

  it(
    "ignores word that an earlier Codex turn completed",
    async () => {
      await start();
      vi.stubEnv("RELAY_AGENT_TURN_MS", "300");
      const id = await s!.thread();
      await s!.send(id, "fixture echo: fixture stale completion");
      await s!.ended(id);
      const [answer] = await answers(id);
      expect(answer.status).toBe("complete");
      expect(answer.body).toContain("fixture stale completion");
    },
  );

  it(
    "is news once when a usage limit stops the answer",
    async () => {
      await start();
      const id = await s!.thread();
      await s!.send(id, "fixture usage limit");
      await s!.ended(id);
      await s!.until(id, (c) => !!c.limitResume);
      expect(kinds(s!.news)).toEqual(["failed"]);
    },
  );

  it.fails(
    "tells a phone about a turn that started and ended while it was away",
    async () => {
      await start();
      const id = await s!.thread();
      const phone = s!.phone();
      phone.drop();
      await s!.send(id, "fixture echo: while the phone was away");
      await s!.ended(id);
      phone.reconnect();
      expect(kinds(phone.news)).toEqual(["finished"]);
    },
  );
});
