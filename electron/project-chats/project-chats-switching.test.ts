import { it, expect, vi } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  root,
  store,
  chats,
  projectId,
  events,
  agentCalls,
  input,
  restart,
  useProjectChats,
} from "../../tests/fixtures/project-chats-harness";

vi.mock("../platform/executables");

useProjectChats();

it("asks the outgoing agent for a handoff note before another agent takes over", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  await chats.send(chat.id, {
    ...input("@claude Now fix it"),
    provider: "claude",
  });
  await vi.waitFor(async () => {
    const messages = (await chats.get(chat.id)).messages;
    expect(messages).toHaveLength(5);
    expect(messages.at(-1)?.status).toBe("complete");
  });
  const after = await chats.get(chat.id);
  const note = after.messages[3]!;
  expect(note).toMatchObject({
    role: "assistant",
    provider: "codex",
    handoff: { from: "codex", to: "claude" },
    status: "complete",
    body: "The cache guard prevents duplicate requests.",
  });
  expect(after.messages[4]).toMatchObject({
    role: "assistant",
    provider: "claude",
    status: "complete",
  });
  // The note is a hidden turn: not a queue pause, not the last real input,
  // and Codex has heard nothing new since its answer.
  expect(after.queuePaused).toBeFalsy();
  expect(after.lastInput?.body).toBe("@claude Now fix it");
  expect(after.sessions?.codex?.through).toBe(after.messages[1]!.id);
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const turns = calls.filter(
    (c) => c.turn && !c.turn.input[0].text.startsWith("Generate a short title"),
  );
  expect(turns).toHaveLength(2);
  expect(turns[1].turn.input[0].text).toContain(
    "Claude is taking over this conversation",
  );
  const claudePrompt = JSON.parse(
    calls.find((c) => c.provider === "claude").prompt,
  ).message.content.find((p: { type: string }) => p.type === "text")
    .text as string;
  expect(claudePrompt).toContain("Handoff note from Codex");
  expect(claudePrompt).toContain(
    "The cache guard prevents duplicate requests.",
  );
  // The history slice carries the earlier exchange, not the note again.
  expect(claudePrompt.split("Claude is taking over")).toHaveLength(1);
  expect(claudePrompt).toContain("Explain the cache guard");
});

it("asks the outgoing agent for a note in a fork it hasn't answered in yet", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(async () => {
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
      "complete",
    );
    expect(chats.hasActiveProject(projectId)).toBe(false);
  });
  const fork = await chats.fork(chat.id);
  await chats.send(fork.id, {
    ...input("@claude Now fix it"),
    provider: "claude",
  });
  await vi.waitFor(async () =>
    expect((await chats.get(fork.id)).messages.at(-1)).toMatchObject({
      provider: "claude",
      status: "complete",
    }),
  );
  const note = (await chats.get(fork.id)).messages.find((m) => m.handoff)!;
  expect(note).toMatchObject({
    provider: "codex",
    status: "complete",
    body: "The cache guard prevents duplicate requests.",
  });
  expect(note.handoff?.byRelay).toBeUndefined();
  const forked = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((r) => r.method === "thread/fork");
  expect(forked?.thread).toMatchObject({ threadId: "fixture-thread" });
});

/** Sends `body` to Claude after Codex's turn, and returns the thread and Claude's prompt. */
async function switchToClaude(chatId: string, body: string) {
  await chats.send(chatId, { ...input(body), provider: "claude" });
  await vi.waitFor(async () =>
    expect((await chats.get(chatId)).messages.at(-1)).toMatchObject({
      provider: "claude",
      status: "complete",
    }),
  );
  const prompt = JSON.parse(
    (await agentCalls())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((c) => c.provider === "claude").prompt,
  ).message.content.find((p: { type: string }) => p.type === "text")
    .text as string;
  return { chat: await chats.get(chatId), prompt };
}

it("briefs the new agent itself when a usage limit cut off the outgoing agent's turn", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture usage limit"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("failed"),
  );
  const { chat: after, prompt } = await switchToClaude(
    chat.id,
    "@claude Carry on",
  );
  expect(after.messages.at(-2)).toMatchObject({
    provider: "codex",
    status: "complete",
    handoff: { from: "codex", to: "claude", byRelay: true },
  });
  expect(prompt).toContain("Handoff note Relay wrote from the thread's record");
  expect(prompt).toContain(
    "didn't finish (failed: You've hit your usage limit.)",
  );
});

it("writes the note itself when the outgoing agent runs out while writing it", async () => {
  vi.stubEnv("RELAY_AGENT_NOTE_LIMIT", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const { chat: after, prompt } = await switchToClaude(
    chat.id,
    "@claude Now fix it",
  );
  // Codex's failed note became Relay's, not a second marker beside it.
  const notes = after.messages.filter((m) => m.handoff);
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({
    status: "complete",
    handoff: { byRelay: true },
  });
  expect(notes[0]!.error).toBeUndefined();
  expect(prompt).toContain("Handoff note Relay wrote");
  expect(prompt).toContain("Explain the cache guard");
});

it("accepts a message for another agent without waiting for the handoff note", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "2000");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  await chats.send(chat.id, {
    ...input("@claude Now fix it"),
    provider: "claude",
  });
  // Codex is still writing its note; the message is already in the thread.
  const messages = (await chats.get(chat.id)).messages;
  expect(messages.at(-2)?.body).toBe("@claude Now fix it");
  expect(messages.at(-1)).toMatchObject({
    handoff: { from: "codex", to: "claude" },
    status: "streaming",
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)).toMatchObject({
      provider: "claude",
      status: "complete",
    }),
  );
});

it("tells an agent coming back what was asked of the other agent meanwhile", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  for (const [body, count] of [
    ["@codex Explain the cache guard", 2],
    ["@claude Now fix it", 5],
    ["@codex Check the fix", 8],
  ] as const) {
    await chats.send(chat.id, {
      ...input(body),
      provider: body.startsWith("@claude") ? "claude" : "codex",
    });
    await vi.waitFor(async () => {
      const messages = (await chats.get(chat.id)).messages;
      expect(messages).toHaveLength(count);
      expect(messages.at(-1)?.status).toBe("complete");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
  }
  const codex = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((c) => c.turn)
    .map((c) => c.turn.input[0].text as string)
    .find((text) => text.startsWith("My request: Check the fix"))!;
  const history = JSON.parse(
    codex.slice(codex.indexOf("[", codex.indexOf("Conversation updates"))),
  );
  expect(history.map((m: { body: string }) => m.body)).toEqual([
    "@claude Now fix it",
    "Claude found the same cache guard.",
  ]);
});

it("still tells a compacted session the notes left since its last answer", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const settled = (count: number) =>
    vi.waitFor(async () => {
      const messages = (await chats.get(chat.id)).messages;
      expect(messages).toHaveLength(count);
      expect(messages.at(-1)?.status).toBe("complete");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await settled(2);
  await chats.send(chat.id, input("Keep the old API."));
  await chats.compact(chat.id);
  await settled(4);
  await chats.send(chat.id, input("@codex Go on"));
  await settled(6);
  const prompt = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((c) => c.turn)
    .map((c) => c.turn.input[0].text as string)
    .find((text) => text.startsWith("My request: Go on"))!;
  expect(prompt).toContain("Keep the old API.");
});

it("keeps what Claude compacted to beside the compaction, not as its answer", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const settled = (count: number) =>
    vi.waitFor(async () => {
      const messages = (await chats.get(chat.id)).messages;
      expect(messages).toHaveLength(count);
      expect(messages.at(-1)?.status).toBe("complete");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
  await chats.send(chat.id, {
    ...input("@claude Explain the cache guard"),
    provider: "claude",
  });
  await settled(2);
  await chats.compact(chat.id);
  await settled(3);
  const compaction = (await chats.get(chat.id)).messages.at(-1)!;
  expect(compaction.compaction).toBe(true);
  expect(compaction.body).toBe("");
  expect(compaction.compactSummary).toBe("Summary:\n1. Keep the old API.");
});

it("compacts when the running answer is done, ahead of what was already queued", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "1500");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await chats.send(chat.id, input("@codex Now fix it"));
  await chats.compact(chat.id);
  await chats.compact(chat.id);
  const queued = (await chats.get(chat.id)).queue!;
  expect(queued.map((q) => !!q.compact)).toEqual([true, false]);
  await vi.waitFor(
    async () => {
      const messages = (await chats.get(chat.id)).messages;
      expect(messages).toHaveLength(5);
      expect(messages.at(-1)?.status).toBe("complete");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    },
    { timeout: 10_000 },
  );
  const saved = await chats.get(chat.id);
  expect(saved.queue ?? []).toHaveLength(0);
  expect(
    saved.messages.map((m) =>
      m.compaction ? "compaction" : `${m.role}:${m.body.slice(0, 13)}`,
    ),
  ).toEqual([
    "user:@codex Explai",
    expect.stringMatching(/^assistant:/),
    "compaction",
    "user:@codex Now fi",
    expect.stringMatching(/^assistant:/),
  ]);
});

/** A thread with one Codex answer, saved as if its context was `cacheAge` ms past its last request. */
const answeredLongAgo = async (cacheAge: number) => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(async () => {
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete");
    expect(chats.hasActiveProject(projectId)).toBe(false);
  });
  await chats.dispose();
  const file = join(root, "chats", chat.id + ".json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.messages.at(-1).context = {
    usedTokens: 130_000,
    cache: { at: Date.now() - cacheAge, ttlMs: 60 * 60_000 },
  };
  await writeFile(file, JSON.stringify(saved));
  restart((e) => events.push(e));
  return chat;
};

/** Settings → Compaction with both switches on; unset is both off. */
const compactUnasked = () =>
  store.update((s) => {
    s.autoCompact = { idle: true, cold: true };
  });
const shape = async (id: string) =>
  (await chats.get(id)).messages.map((m) =>
    m.compaction
      ? `compaction${m.compactedCold ? " (cold)" : ""}${m.compactedIdle ? " (idle)" : ""}`
      : `${m.role}:${m.body.slice(0, 12)}`,
  );

it("compacts a big conversation whose cache went cold before the next message", async () => {
  await compactUnasked();
  const chat = await answeredLongAgo(2 * 60 * 60_000);
  await chats.send(chat.id, input("@codex Go on"));
  await vi.waitFor(
    async () => {
      expect(await shape(chat.id)).toEqual([
        "user:@codex Expla",
        expect.stringMatching(/^assistant:/),
        "compaction (cold)",
        "user:@codex Go on",
        expect.stringMatching(/^assistant:/),
      ]);
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      );
    },
    { timeout: 10_000 },
  );
});

it("sends straight away while the conversation's cache is still warm", async () => {
  const chat = await answeredLongAgo(10 * 60_000);
  await chats.send(chat.id, input("@codex Go on"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  expect(await shape(chat.id)).toEqual([
    "user:@codex Expla",
    expect.stringMatching(/^assistant:/),
    "user:@codex Go on",
    expect.stringMatching(/^assistant:/),
  ]);
});

it("sends to a cold cache as Settings say, unless the message asks otherwise", async () => {
  const answers = async (id: string) =>
    vi.waitFor(
      async () => {
        expect((await chats.get(id)).messages.at(-1)?.status).toBe("complete");
        expect((await chats.get(id)).messages.at(-1)?.role).toBe("assistant");
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 10_000 },
    );
  const unset = await answeredLongAgo(2 * 60 * 60_000);
  await chats.send(unset.id, input("@codex Go on"));
  await answers(unset.id);
  expect(await shape(unset.id)).not.toContain("compaction (cold)");

  await compactUnasked();
  const asIs = await answeredLongAgo(2 * 60 * 60_000);
  await chats.send(asIs.id, { ...input("@codex Go on"), compact: false });
  await answers(asIs.id);
  expect(await shape(asIs.id)).not.toContain("compaction (cold)");

  await store.update((s) => {
    s.autoCompact = { idle: true, cold: false };
  });
  const off = await answeredLongAgo(2 * 60 * 60_000);
  await chats.send(off.id, input("@codex Go on"));
  await answers(off.id);
  expect(await shape(off.id)).not.toContain("compaction (cold)");

  const asked = await answeredLongAgo(2 * 60 * 60_000);
  await chats.send(asked.id, { ...input("@codex Go on"), compact: true });
  await answers(asked.id);
  expect(await shape(asked.id)).toEqual([
    "user:@codex Expla",
    expect.stringMatching(/^assistant:/),
    "compaction (cold)",
    "user:@codex Go on",
    expect.stringMatching(/^assistant:/),
  ]);
});

it("compacts a big unread conversation just before its cache goes cold, without bumping the thread", async () => {
  await compactUnasked();
  const chat = await answeredLongAgo(57 * 60_000);
  const before = await chats.get(chat.id);
  chats.armWakeups();
  await vi.waitFor(
    async () => {
      expect(await shape(chat.id)).toEqual([
        "user:@codex Expla",
        expect.stringMatching(/^assistant:/),
        "compaction (idle)",
      ]);
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      );
    },
    { timeout: 10_000 },
  );
  expect((await chats.get(chat.id)).updated).toBe(before.updated);
});

/** The Codex turns asked for `body`, by the fixture's record of them. */
const turnsAsking = async (body: string) =>
  (await agentCalls())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((r) =>
      r.turn?.input?.some(
        (i: { type: string; text?: string }) =>
          i.type === "text" && i.text?.includes(body),
      ),
    );

it("sends the message anyway when compacting the cold conversation fails", async () => {
  vi.stubEnv("RELAY_FIXTURE_COMPACT_FAILS", "1");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await compactUnasked();
  const chat = await answeredLongAgo(2 * 60 * 60_000);
  await chats.send(chat.id, input("@codex Go on"));
  await vi.waitFor(
    async () => {
      expect(await shape(chat.id)).toEqual([
        "user:@codex Expla",
        expect.stringMatching(/^assistant:/),
        "compaction (cold)",
        "user:@codex Go on",
        expect.stringMatching(/^assistant:/),
      ]);
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      );
      expect(chats.hasActiveProject(projectId)).toBe(false);
    },
    { timeout: 10_000 },
  );
  const saved = await chats.get(chat.id);
  expect(saved.messages[2]!.status).toBe("failed");
  expect(saved.queuePaused).toBeFalsy();
  expect(saved.queue ?? []).toHaveLength(0);
  expect(await turnsAsking("Go on")).toHaveLength(1);
  expect(
    warn.mock.calls.some(([m]) => String(m).includes("cold conversation")),
  ).toBe(true);
});

it("holds the message back when the cold conversation's compaction is stopped", async () => {
  await compactUnasked();
  const chat = await answeredLongAgo(2 * 60 * 60_000);
  // The send returns once the compaction has started, with the message queued behind it.
  await chats.send(chat.id, input("@codex Go on"));
  expect(
    (await chats.get(chat.id)).messages.find((m) => m.compaction)?.status,
  ).toBe("streaming");
  await chats.cancel(chat.id);
  await vi.waitFor(async () => {
    expect(
      (await chats.get(chat.id)).messages.find((m) => m.compaction)?.status,
    ).toBe("cancelled");
    expect(chats.hasActiveProject(projectId)).toBe(false);
  });
  const saved = await chats.get(chat.id);
  expect(await shape(chat.id)).toEqual([
    "user:@codex Expla",
    expect.stringMatching(/^assistant:/),
    "compaction (cold)",
  ]);
  expect(saved.queuePaused).toBe(true);
  expect(saved.queue?.map((q) => q.input.body)).toEqual(["@codex Go on"]);
  expect(await turnsAsking("Go on")).toHaveLength(0);
});

it("takes a repeated compact's instructions in place of the queued one's", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "1500");
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(chat.id, claude("@claude Explain the cache guard"));
  await chats.send(chat.id, claude("@claude Now fix it"));
  await chats.compact(chat.id, undefined, "Keep the API decisions");
  const first = (await chats.get(chat.id)).queue![0]!;
  await chats.queueAction(chat.id, "move", first.input.id, 1);
  await chats.compact(chat.id, undefined, "Keep the test plan");
  let queue = (await chats.get(chat.id)).queue!;
  expect(queue.map((q) => !!q.compact)).toEqual([false, true]);
  expect(queue[1]!.input).toMatchObject({
    id: first.input.id,
    body: "/compact Keep the test plan",
  });
  await chats.compact(chat.id);
  queue = (await chats.get(chat.id)).queue!;
  expect(queue.filter((q) => q.compact).map((q) => q.input.body)).toEqual([
    "/compact",
  ]);
});

it("brings the sidebar summary up to date when a compaction finishes", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const finished = () =>
    vi.waitFor(async () => {
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      );
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await finished();
  await chats.triage(chat.id, { kind: "settle" });
  await chats.compact(chat.id);
  await finished();
  await vi.waitFor(async () => {
    const summary = chats.list(projectId).find((c) => c.id === chat.id)!;
    expect(summary.updated).toBe((await chats.get(chat.id)).updated);
  });
});

it("keeps a steer sent during a cold compaction behind the message it held back", async () => {
  await compactUnasked();
  const chat = await answeredLongAgo(2 * 60 * 60_000);
  await chats.send(chat.id, input("@codex First one"));
  await chats.send(chat.id, {
    ...input("@codex Second one"),
    delivery: "steer",
  });
  expect((await chats.get(chat.id)).queue?.map((q) => q.input.body)).toEqual([
    "@codex First one",
    "@codex Second one",
  ]);
});
