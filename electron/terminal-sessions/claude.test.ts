import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  claudeQueued,
  claudeTurns,
  writeClaudeSession,
} from "../../tests/fixtures/terminal-sessions";
import {
  claudeHistory,
  claudeOrigin,
  claudePrompt,
  claudeSlug,
  claudeSummary,
  claudeTranscript,
} from "./claude";

it("names a folder the way Claude Code does, hashing very long paths", () => {
  expect(claudeSlug("/Users/me/My Project.v2")).toBe("-Users-me-My-Project-v2");
  const long = `/x/${"a".repeat(250)}`;
  const slug = claudeSlug(long);
  expect(slug).toMatch(/^-x-a{197}-[0-9a-z]+$/);
  // Claude Code's hash: ((h << 5) - h + code) | 0, absolute, base 36.
  expect(slug.slice(201)).toBe("bjrb96");
});

it("finds where a session ran from the raw head, even mid-line", () => {
  const line = JSON.stringify({
    type: "user",
    cwd: '/tmp/a "quoted" dir',
    entrypoint: "cli",
    message: { content: "x".repeat(500) },
  });
  expect(claudeOrigin(line.slice(0, 200))).toEqual({
    cwd: '/tmp/a "quoted" dir',
    terminal: true,
  });
  expect(
    claudeOrigin(JSON.stringify({ cwd: "/r", entrypoint: "sdk-cli" })),
  ).toEqual({ cwd: "/r", terminal: false });
  expect(claudeOrigin('{"type":"summary"}')).toBeUndefined();
});

it("keeps what the user typed and drops what Claude Code added", () => {
  const user = (content: unknown, extra = {}) => ({
    type: "user",
    message: { content },
    ...extra,
  });
  expect(claudePrompt(user("Fix it"))).toBe("Fix it");
  expect(
    claudePrompt(
      user([
        { type: "text", text: "Look" },
        { type: "image", source: {} },
      ]),
    ),
  ).toBe("Look\n(image)");
  expect(
    claudePrompt(
      user(
        "<command-name>/review</command-name><command-args>main</command-args>",
      ),
    ),
  ).toBe("/review main");
  expect(claudePrompt(user("<bash-input>ls</bash-input>"))).toBe("!ls");
  for (const dropped of [
    user("<local-command-stdout>hi</local-command-stdout>"),
    user("[Request interrupted by user]"),
    user([{ type: "tool_result", tool_use_id: "t", content: "x" }]),
    user("meta", { isMeta: true }),
    user("summary", { isCompactSummary: true }),
    user("side", { isSidechain: true }),
  ])
    expect(claudePrompt(dropped)).toBeUndefined();
});

it("turns a session into prompts and answers, with tool rows and commentary", () => {
  const { messages, cut } = claudeTranscript(
    claudeTurns([
      { prompt: "First", answer: "Done one." },
      { prompt: "Second", answer: "Done two." },
    ]),
    "s1",
  );
  expect(messages.map((m) => [m.role, m.body])).toEqual([
    ["user", "First"],
    ["assistant", "Done one."],
    ["user", "Second"],
    ["assistant", "Done two."],
  ]);
  const answer = messages[1]!;
  expect(answer).toMatchObject({
    provider: "claude",
    status: "complete",
    model: { name: "claude-opus-5-5" },
  });
  expect(answer.trace).toEqual([
    { kind: "commentary", id: "assistant-2", text: "Looking (0)." },
    {
      kind: "activity",
      id: "toolu_0",
      activity: expect.objectContaining({
        kind: "command",
        label: "ls 0",
        status: "complete",
        detail: "out 0",
      }),
    },
  ]);
  // The last finished answer is where a copy of the session is cut.
  expect(cut).toEqual({
    message: messages[3]!.id,
    point: { thread: "s1", at: "assistant-14" },
  });
  expect(
    messages.every((m, i) => !i || m.created > messages[i - 1]!.created),
  ).toBe(true);
});

it("has nowhere to cut while the last turn is still going", () => {
  const entries = claudeTurns([{ prompt: "Only", answer: "Answer" }]);
  // The turn's last answer hasn't come yet: it ends on a tool result.
  const { messages, cut } = claudeTranscript(entries.slice(0, 5), "s1");
  expect(messages).toHaveLength(2);
  expect(cut).toBeUndefined();
  expect(messages[1]!.body).toBe("");
});

it("marks an interrupted answer stopped", () => {
  const entries = claudeTurns([{ prompt: "Go", answer: "x" }]).slice(0, 4);
  entries.push({
    type: "user",
    uuid: "int",
    parentUuid: "assistant-3",
    message: {
      content: [
        { type: "text", text: "[Request interrupted by user for tool use]" },
      ],
    },
  });
  const { messages } = claudeTranscript(entries, "s1");
  expect(messages[1]!.status).toBe("cancelled");
  expect(messages[1]!.trace?.[1]).toMatchObject({
    activity: { status: "failed" },
  });
});

it("follows the session's current branch: a rewind drops, a compaction is crossed", async () => {
  const home = await mkdtemp(join(tmpdir(), "relay-claude-"));
  try {
    const entries = claudeTurns([{ prompt: "Kept", answer: "Kept answer" }]);
    const turn = (prefix: string, parent: string, text: string) => [
      {
        type: "user",
        uuid: `${prefix}-u`,
        parentUuid: parent,
        message: { content: text },
      },
      {
        type: "assistant",
        uuid: `${prefix}-a`,
        parentUuid: `${prefix}-u`,
        message: { content: [{ type: "text", text: `${text} answer` }] },
      },
    ];
    entries.push(
      // Rewound: the user went back to after the first answer.
      ...turn("old", "system-7", "Abandoned"),
      ...turn("new", "system-7", "Instead"),
      {
        type: "system",
        subtype: "compact_boundary",
        uuid: "boundary",
        parentUuid: null,
        logicalParentUuid: "new-a",
      },
      {
        type: "user",
        uuid: "summary",
        parentUuid: "boundary",
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
        message: { content: "This session is being continued…" },
      },
      ...turn("after", "summary", "After compaction"),
      {
        type: "system",
        subtype: "turn_duration",
        uuid: "dur",
        parentUuid: "after-a",
      },
    );
    const path = await writeClaudeSession(home, "/repo", "s1", entries);
    const { messages, cut } = await claudeHistory(path, "s1");
    expect(
      messages.filter((m) => m.role === "user").map((m) => m.body),
    ).toEqual(["Kept", "Instead", "After compaction"]);
    // A note after the last answer doesn't stop its turn counting as finished.
    expect(cut?.point.at).toBe("after-a");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("shows what the user typed while Claude worked, and nothing else that queued", async () => {
  const home = await mkdtemp(join(tmpdir(), "relay-claude-"));
  try {
    const entries = claudeTurns([
      { prompt: "First", answer: "Done one." },
      { prompt: "Second", answer: "Done two." },
    ]);
    // Mid-turn of the second, after its tool call: a steer, a background
    // task's notice and a message from another session.
    entries.splice(
      12,
      0,
      claudeQueued("q-human", "assistant-11", "Use the other key", {
        kind: "human",
      }),
      claudeQueued(
        "q-task",
        "q-human",
        "<task-notification>done</task-notification>",
        {
          kind: "task-notification",
        },
      ),
      claudeQueued("q-peer", "q-task", "from a peer", { kind: "peer" }),
    );
    entries[15] = { ...entries[15], parentUuid: "q-peer" };
    const path = await writeClaudeSession(home, "/repo", "s1", entries);
    const { messages, cut } = await claudeHistory(path, "s1");
    expect(
      messages.filter((m) => m.role === "user").map((m) => m.body),
    ).toEqual(["First", "Second", "Use the other key"]);
    expect(messages.at(-1)?.body).toBe("Done two.");
    expect(cut?.point.at).toBe("assistant-14");
    // Counted as a prompt in the list, too.
    expect((await claudeSummary(path)).turns).toBe(3);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
