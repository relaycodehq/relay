import { it, expect, vi } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { findExecutable } from "../platform/executables";
import { lastComposerSettings, sentSettingsOf } from "../../shared/projects";
import { openCodeNativeFixture } from "../../tests/fixtures/opencode-native";
import { fakeCli } from "../../tests/fixtures/fake-cli";
import {
  root,
  chats,
  projectId,
  events,
  waitForChatEvent,
  agentCalls,
  input,
  restart,
  useProjectChats,
  tinyPng,
} from "../../tests/fixtures/project-chats-harness";
vi.mock("../platform/executables");

useProjectChats();

it("generates a title for Claude conversations, which have no thread-name event", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude Explain the cache guard"),
    provider: "claude",
  });
  await vi.waitFor(async () => {
    const saved = await chats.get(chat.id);
    expect(saved.title).toBe("Cache guard behavior");
    expect(saved.messages.at(-1)?.status).toBe("complete");
  });
  const titling = (await agentCalls({ helpers: true }))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((r) => r.provider === "claude" && r.prompt.includes("short title"));
  expect(titling).toHaveLength(1);
  expect(titling[0].args.join(" ")).toContain(
    "--model fixture-model --effort low",
  );
  expect((await chats.get(chat.id)).messages).toHaveLength(2);
});
it("shows a turn Claude starts by itself as its own answer, so later answers stay under their questions", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(
    chat.id,
    claude("@claude Start the fixture background task"),
  );
  await vi.waitFor(
    async () =>
      expect(
        (await chats.get(chat.id)).messages.find((m) => m.unprompted)?.status,
      ).toBe("complete"),
    { timeout: 10_000 },
  );
  await vi.waitFor(
    () => expect(chats.hasActiveProject(projectId)).toBe(false),
    { timeout: 10_000 },
  );
  await chats.send(chat.id, claude("@claude Explain the cache guard"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 10_000 },
  );
  expect(
    (await chats.get(chat.id)).messages.map((m) => [
      m.role,
      !!m.unprompted,
      m.body,
    ]),
  ).toEqual([
    ["user", false, "@claude Start the fixture background task"],
    ["assistant", false, "Started the background task."],
    ["assistant", true, "The background task finished."],
    ["user", false, "@claude Explain the cache guard"],
    ["assistant", false, "Claude found the same cache guard."],
  ]);
});
it("steers a turn Claude started by itself", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(
    chat.id,
    claude("@claude Start the fixture background task to steer"),
  );
  await vi.waitFor(
    async () =>
      expect(
        (await chats.get(chat.id)).messages.find((m) => m.unprompted)?.body,
      ).toBe("Looking into it."),
    { timeout: 30_000 },
  );
  await chats.send(chat.id, {
    ...claude("@claude Use the blue one"),
    delivery: "steer",
  });
  await vi.waitFor(
    async () => {
      expect(chats.hasActiveProject(projectId)).toBe(false);
      expect((await chats.get(chat.id)).messages).toHaveLength(5);
    },
    { timeout: 30_000 },
  );
  expect(
    (await chats.get(chat.id)).messages.map((m) => [
      m.role,
      m.body,
      !!m.unprompted,
      !!m.steered,
    ]),
  ).toEqual([
    [
      "user",
      "@claude Start the fixture background task to steer",
      false,
      false,
    ],
    ["assistant", "Started the background task.", false, false],
    ["assistant", "Looking into it.", true, false],
    ["user", "@claude Use the blue one", false, true],
    ["assistant", "Noted: Use the blue one", false, false],
  ]);
});
it.each([
  ["reads it mid-turn", "fixture wait for steer", "Looking into it."],
  ["reads it after finishing", "fixture late steer", "Done before your note."],
])(
  "continues Claude's answer below a steering message once Claude %s",
  async (_, prompt, earlier) => {
    const chat = await chats.create(projectId, { kind: "project" });
    const claude = (body: string) => ({
      ...input(body),
      provider: "claude" as const,
    });
    await chats.send(chat.id, claude(`@claude ${prompt}`));
    await vi.waitFor(
      async () =>
        expect((await chats.get(chat.id)).messages.at(-1)?.body).toBe(
          "Looking into it.",
        ),
      { timeout: 30_000 },
    );
    await chats.send(chat.id, {
      ...claude("@claude Use the blue one"),
      delivery: "steer",
    });
    await vi.waitFor(
      async () => {
        expect(chats.hasActiveProject(projectId)).toBe(false);
        expect((await chats.get(chat.id)).messages).toHaveLength(4);
      },
      { timeout: 30_000 },
    );
    const messages = (await chats.get(chat.id)).messages;
    expect(
      messages.map((m) => [m.role, m.body, m.status, !!m.steered]),
    ).toEqual([
      ["user", `@claude ${prompt}`, "complete", false],
      ["assistant", earlier, "complete", false],
      ["user", "@claude Use the blue one", "complete", true],
      ["assistant", "Noted: Use the blue one", "complete", false],
    ]);
    expect(messages[3]!.created).toBeGreaterThan(messages[2]!.created);
    // Shown as waiting until Claude picks it up.
    const steerEvents = events.filter((e) => e.message.id === messages[2]!.id);
    expect(steerEvents[0]?.message.unread).toBe(true);
    expect(steerEvents.at(-1)?.message.unread).toBeUndefined();
    expect(messages[2]!.unread).toBeUndefined();
    expect((await chats.get(chat.id)).sessions?.claude?.through).toBe(
      messages[3]!.id,
    );
  },
);
it("continues Codex's answer below a steering message once Codex reads it", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture codex steer"));
  await vi.waitFor(async () =>
    expect(
      (await chats.get(chat.id)).messages.at(-1)?.trace?.length,
    ).toBeGreaterThan(0),
  );
  const steer = {
    ...input("@codex Use the blue one"),
    delivery: "steer" as const,
  };
  await chats.send(chat.id, steer);
  await vi.waitFor(async () => {
    expect(chats.hasActiveProject(projectId)).toBe(false);
    expect((await chats.get(chat.id)).messages).toHaveLength(4);
  });
  const messages = (await chats.get(chat.id)).messages;
  expect(messages.map((m) => [m.role, m.body, m.status])).toEqual([
    ["user", "@codex fixture codex steer", "complete"],
    ["assistant", "", "complete"],
    ["user", "@codex Use the blue one", "complete"],
    ["assistant", "Noted: Use the blue one", "complete"],
  ]);
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(calls.find((c) => c.steer)?.steer.clientUserMessageId).toBe(steer.id);
});
it("publishes findings in any thread, from a turn Claude started itself too", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude Start the fixture background task with findings"),
    provider: "claude",
  });
  await vi.waitFor(async () => {
    const { findings, messages } = await chats.get(chat.id);
    const own = messages.find((m) => m.unprompted);
    expect(own?.status).toBe("complete");
    expect(findings?.reports.map((r) => r.messageId)).toEqual([own!.id]);
    expect(own!.body).not.toContain("relay-findings");
  });
});
/** An answer that ends with a valid findings block, as the fake agent echoes it. */
const endsWithFindings = (title: string) =>
  `fixture echo: Found one.\n\n\`\`\`relay-findings\n${JSON.stringify({
    findings: [{ id: "F1", priority: "P2", title, files: [], reviewers: [] }],
  })}\n\`\`\`\nfixture echo end`;
it("publishes no findings from an answer that was stopped", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(
    chat.id,
    input(`@codex wait for cancellation ${endsWithFindings("Stopped")}`),
  );
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toMatch(/```$/),
  );
  await chats.cancel(chat.id);
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
      "cancelled",
    ),
  );
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  const { findings, messages } = await chats.get(chat.id);
  expect(findings).toBeUndefined();
  expect(messages.at(-1)?.body).toContain("```relay-findings");
});
it("publishes no findings from a side question's answers", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await waitForChatEvent(
    chat.id,
    ({ message }) =>
      message.role === "assistant" && message.status === "complete",
  );
  const side = {
    ...input(`@codex ${endsWithFindings("Side question")}`),
    side: true as const,
  };
  await chats.send(chat.id, side);
  await waitForChatEvent(
    chat.id,
    ({ message }) =>
      message.parentId === side.id && message.status === "complete",
  );
  // Carrying on in the side conversation stays on its branch too.
  const reply = {
    ...input(`@codex ${endsWithFindings("Side reply")}`),
    parentId: side.id,
  };
  // The side turn lets go a moment after its answer completes.
  await vi.waitFor(() => chats.send(chat.id, reply));
  await vi.waitFor(async () =>
    expect(
      (await chats.get(chat.id)).messages.filter(
        (m) => m.role === "assistant" && m.parentId && m.status === "complete",
      ),
    ).toHaveLength(2),
  );
  const { findings, messages } = await chats.get(chat.id);
  expect(findings).toBeUndefined();
  const answers = messages.filter((m) => m.role === "assistant" && m.parentId);
  for (const m of answers)
    expect(m.body).toMatch(/```relay-findings[\s\S]*```$/);
  expect(messages.find((m) => m.id === side.id)?.sentSettings).toEqual(
    sentSettingsOf(side),
  );
  expect(lastComposerSettings(await chats.get(chat.id), side.id)).toEqual({
    ...sentSettingsOf(reply),
    id: reply.id,
  });
});
it("keeps a question's answer under it when Claude's own turn follows it", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(
    chat.id,
    claude("@claude Start the fixture background task"),
  );
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  // Sent before the task ends, so Claude's own turn arrives after this answer.
  await chats.send(chat.id, claude("@claude Explain the cache guard"));
  await vi.waitFor(async () => {
    const messages = (await chats.get(chat.id)).messages;
    expect(messages.find((m) => m.unprompted)?.status).toBe("complete");
    expect(messages.every((m) => m.status === "complete")).toBe(true);
  });
  const messages = (await chats.get(chat.id)).messages;
  const question = messages.findIndex(
    (m) => m.body === "@claude Explain the cache guard",
  );
  expect(messages.find((m, i) => i > question && !m.unprompted)?.body).toBe(
    "Claude found the same cache guard.",
  );
  expect(messages.filter((m) => m.unprompted).map((m) => m.body)).toEqual([
    "The background task finished.",
  ]);
});
it("saves a pasted screenshot outside chat JSON and sends a local image to Codex", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@codex What is in this screenshot?"),
    images: [
      {
        name: "screen.png",
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${tinyPng}`,
      },
    ],
  });
  // The thread stays active a moment after its answer reads complete.
  await vi.waitFor(async () => {
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete");
    expect(chats.hasActiveProject(projectId)).toBe(false);
  });
  const image = (await chats.get(chat.id)).messages[0].images?.[0];
  expect(image).toMatchObject({ name: "screen.png", mimeType: "image/png" });
  expect(await chats.image(chat.id, image!.id)).toBe(
    `data:image/png;base64,${tinyPng}`,
  );
  await expect(chats.image(chat.id, randomUUID())).rejects.toThrow(
    "Screenshot not found",
  );
  expect(
    await readFile(join(root, "chats", chat.id + ".json"), "utf8"),
  ).not.toContain(tinyPng);
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(requests.find((r) => r.turn).turn.input[1]).toMatchObject({
    type: "localImage",
  });
  await expect(
    chats.send(chat.id, {
      ...input("@codex bad image"),
      images: [
        {
          name: "bad.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,YmFk",
        },
      ],
    }),
  ).rejects.toThrow("Screenshot is invalid");
});
it("passes a pasted screenshot as an image block to Claude", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude Describe this image"),
    provider: "claude",
    images: [
      {
        name: "screen.png",
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${tinyPng}`,
      },
    ],
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const message = JSON.parse(
    requests.find((r) => r.provider === "claude").prompt,
  );
  expect(message.message.content[1]).toMatchObject({
    type: "image",
    source: { type: "base64", media_type: "image/png", data: tinyPng },
  });
});
it("shows the title helper the screenshots sent with a vague message", async () => {
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude huh"),
    provider: "claude",
    images: [
      {
        name: "screen.png",
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${tinyPng}`,
      },
    ],
  });
  const titling = async () =>
    (await agentCalls({ helpers: true }))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((r) => r.provider === "claude" && r.prompt.startsWith("{"))
      .map((r) => JSON.parse(r.prompt).message.content)
      .find((content) => content[0].text.startsWith("Generate a short title"));
  await vi.waitFor(async () => expect(await titling()).toBeDefined());
  expect((await titling())[1]).toMatchObject({
    type: "image",
    source: { type: "base64", media_type: "image/png", data: tinyPng },
  });
});
it("sends a screenshot on its own without inventing a request", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude"),
    provider: "claude",
    images: [
      {
        name: "screen.png",
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${tinyPng}`,
      },
    ],
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const saved = await chats.get(chat.id);
  expect(saved.messages[0].body).toBe("@claude");
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const content = JSON.parse(
    requests.find((r) => r.provider === "claude").prompt,
  ).message.content;
  expect(content.at(-1)).toMatchObject({ type: "image" });
  for (const block of content.filter(
    (b: { type: string }) => b.type === "text",
  )) {
    expect(block.text).not.toBe("");
    expect(block.text).not.toContain("My request");
  }
});
it("sends a Claude slash command as the whole prompt so Claude runs it", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude /security-review focus on auth"),
    provider: "claude",
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const message = JSON.parse(
    requests.find((r) => r.provider === "claude").prompt,
  );
  expect(message.message.content[0].text).toBe(
    "/security-review focus on auth",
  );
});
it("tells a Claude session begun with a command what the thread is about on its next turn", async () => {
  const chat = await chats.create(projectId, {
    kind: "pr",
    ref: { owner: "Web", name: "portal", number: 7 },
  });
  for (const body of ["@claude /security-review", "@claude Fix the first"]) {
    await chats.send(chat.id, { ...input(body), provider: "claude" });
    await vi.waitFor(async () => {
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      );
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
  }
  const prompts = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((r) => r.provider === "claude" && !r.args.includes("--print"))
    .map((r) => JSON.parse(r.prompt).message.content[0].text as string);
  expect(prompts[0]).toBe("/security-review");
  expect(prompts[1]).toContain("This discussion concerns PR #7 in Web/portal");
  // Nothing came before the command, so its session has heard it all.
  expect(prompts[1]).not.toContain("Conversation updates");
});
it("tells Claude on its next turn what a command it began with couldn't carry", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  for (const body of [
    "@codex Explain the cache guard",
    "@claude /security-review",
    "@claude Fix the first",
  ]) {
    const provider = body.startsWith("@claude") ? "claude" : "codex";
    await chats.send(chat.id, { ...input(body), provider });
    await vi.waitFor(async () => {
      const messages = (await chats.get(chat.id)).messages;
      expect(messages.at(-1)?.role).toBe("assistant");
      expect(messages.at(-1)?.status).toBe("complete");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
  }
  const prompt = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((r) => r.provider === "claude" && !r.args.includes("--print"))
    .map((r) => JSON.parse(r.prompt).message.content[0].text as string)
    .find((text) => text.startsWith("My request: Fix the first"))!;
  expect(prompt).toContain("Explain the cache guard");
  expect(prompt).toContain("The cache guard prevents duplicate requests.");
  // A note Claude couldn't be given isn't asked of Codex.
  expect((await chats.get(chat.id)).messages.some((m) => m.handoff)).toBe(
    false,
  );
});

it("keeps replies one level deep, isolates their agent session, and retains local-only activity", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const ask = async (body: string, parentId?: string) => {
    const request = { ...input(body), ...(parentId ? { parentId } : {}) };
    await chats.send(chat.id, request);
    await vi.waitFor(async () => {
      const saved = await chats.get(chat.id);
      const index = saved.messages.findIndex((m) => m.id === request.id);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(saved.messages[index + 1]?.status).toBe("complete");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
    return (await chats.get(chat.id)).messages.at(-1)!;
  };
  const main = await ask("@codex MAIN question");
  const first = await ask("@codex BRANCH question", main.id);
  const second = await ask("@codex BRANCH followup", first.id);
  expect(first.parentId).toBe(main.id);
  expect(second.parentId).toBe(main.id);
  await ask("@codex MAIN followup");
  const saved = await chats.get(chat.id);
  expect(saved.messages.at(-1)?.parentId).toBeUndefined();
  expect(saved.replySessions?.[main.id]?.codex?.through).toBe(second.id);
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  // The side conversation continues Codex's own session, cut after its answer.
  expect(requests.filter((r) => r.thread).map((r) => r.method)).toEqual([
    "thread/start",
    "thread/fork",
  ]);
  expect(requests.find((r) => r.method === "thread/fork").thread).toMatchObject(
    { threadId: "fixture-thread", lastTurnId: "fixture-turn" },
  );
  expect(main.forkPoint).toEqual({
    thread: "fixture-thread",
    at: "fixture-turn",
  });
  const prompts = requests
    .filter((r) => r.turn)
    .map((r) => r.turn.input[0].text);
  expect(prompts[0]).toContain("general discussion of the linked project");
  // The fork already holds the main conversation and the scope.
  expect(prompts[1]).toContain("side conversation branching off your answer");
  expect(prompts[1]).not.toContain("MAIN question");
  expect(prompts[1]).not.toContain("general discussion");
  expect(prompts[2]).not.toContain("side conversation");
  expect(prompts[2]).not.toContain("MAIN question");
  expect(prompts[3]).not.toContain("BRANCH");
  expect(prompts[3]).not.toContain("general discussion");
  expect(
    saved.messages
      .at(-1)
      ?.trace?.flatMap((e) => (e.kind === "activity" ? [e.activity] : [])),
  ).toMatchObject([
    {
      kind: "command",
      status: "complete",
      label: "git diff --stat",
      detail: "example.ts | 2 +-",
    },
  ]);
  expect(saved.messages.at(-1)?.activity).toBeUndefined();
  await expect(
    chats.send(chat.id, {
      ...input("@codex Unknown reply"),
      parentId: randomUUID(),
    }),
  ).rejects.toThrow("Reply target is missing");
  expect((await chats.get(chat.id)).messages).toHaveLength(
    saved.messages.length,
  );
  await chats.dispose();
  restart(() => {});
  expect((await chats.get(chat.id)).replySessions).toEqual(saved.replySessions);
});

it("forks Claude's session for a side conversation, and gives another agent the conversation up to its message", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const ask = async (
    body: string,
    provider: "codex" | "claude",
    count: number,
    parentId?: string,
  ) => {
    await chats.send(chat.id, {
      ...input(body),
      provider,
      ...(parentId ? { parentId } : {}),
    });
    await vi.waitFor(async () => {
      const messages = (await chats.get(chat.id)).messages;
      expect(messages).toHaveLength(count);
      expect(messages.at(-1)?.status).toBe("complete");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
    return (await chats.get(chat.id)).messages.at(-1)!;
  };
  const main = await ask("@claude MAIN question", "claude", 2);
  expect(main.forkPoint).toEqual({
    thread: "fixture-claude",
    at: "fixture-assistant",
  });
  await ask("@claude BRANCH question", "claude", 4, main.id);
  // Codex joins the side conversation: Claude's side session hands off first.
  await ask("@codex OTHER question", "codex", 7, main.id);
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const claudeText = (call: { prompt: string }) =>
    JSON.parse(call.prompt).message.content.find(
      (p: { type: string }) => p.type === "text",
    ).text as string;
  const branch = calls.find(
    (c) => c.provider === "claude" && c.prompt?.includes("BRANCH question"),
  );
  expect(branch.args).toEqual(
    expect.arrayContaining([
      "--resume=fixture-claude",
      "--fork-session",
      "--resume-session-at=fixture-assistant",
    ]),
  );
  expect(claudeText(branch)).toContain(
    "side conversation branching off your answer",
  );
  expect(claudeText(branch)).not.toContain("MAIN question");
  const codex = calls.find((c) => c.turn)!.turn.input[0].text as string;
  expect(codex).toContain('side conversation about the message marked "focus"');
  expect(codex).toContain("general discussion of the linked project");
  expect(codex).toContain("Handoff note from Claude");
  const history = JSON.parse(
    codex.slice(codex.indexOf("[", codex.indexOf("Conversation updates"))),
  );
  expect(history.map((m: { body: string }) => m.body)).toEqual([
    "@claude MAIN question",
    main.body,
    "@claude BRANCH question",
    "Claude found the same cache guard.",
  ]);
  expect(history[1].focus).toBe(true);
  // Codex answered last, on the side; Claude still holds the main conversation.
  expect(chats.list(projectId).find((c) => c.id === chat.id)).toMatchObject({
    provider: "codex",
    contextAgent: "claude",
  });
});

it("forks a thread at an answer, and its first turn continues that answer's session", async () => {
  const ask = async (chatId: string, body: string, count: number) => {
    await chats.send(chatId, { ...input(body), provider: "claude" });
    await vi.waitFor(async () => {
      const messages = (await chats.get(chatId)).messages;
      expect(messages).toHaveLength(count);
      expect(messages.at(-1)?.status).toBe("complete");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
    return (await chats.get(chatId)).messages.at(-1)!;
  };
  const chat = await chats.create(projectId, { kind: "project" });
  const first = await ask(chat.id, "@claude FIRST question", 2);
  await ask(chat.id, "@claude LATER question", 4);
  const fork = await chats.fork(chat.id, first.id);
  const forked = await chats.get(fork.id);
  expect(forked.messages.map((m) => m.body)).toEqual([
    "@claude FIRST question",
    first.body,
  ]);
  expect(forked.messages.map((m) => m.id)).not.toContain(first.id);
  expect(forked.forkedAt).toBe(forked.messages[1].id);
  expect((await chats.get(chat.id)).messages).toHaveLength(4);

  await ask(fork.id, "@claude FORKED question", 4);
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const call = calls.find(
    (c) => c.provider === "claude" && c.prompt?.includes("FORKED question"),
  );
  expect(call.args).toEqual(
    expect.arrayContaining([
      "--resume=fixture-claude",
      "--fork-session",
      "--resume-session-at=fixture-assistant",
    ]),
  );
  const text = JSON.parse(call.prompt).message.content.find(
    (p: { type: string }) => p.type === "text",
  ).text as string;
  expect(text).toContain("forked from another after your answer");
  expect(text).not.toContain("FIRST question");
  expect(text).not.toContain("LATER question");
});

it("runs a picked OpenCode skill through the thread's real prompt wrapper", async () => {
  const native = await openCodeNativeFixture();
  try {
    const codex = await findExecutable("codex");
    const cli = await fakeCli(
      join(root, "opencode"),
      await readFile(resolve("tests/fixtures/acp-agent.cjs"), "utf8"),
      "opencode v2.0.28",
    );
    vi.mocked(findExecutable).mockImplementation(async (name) =>
      name === "opencode" ? cli : codex,
    );
    const capture = join(root, "opencode-capture.jsonl");
    vi.stubEnv("RELAY_ACP_LOG", capture);
    vi.stubEnv(
      "RELAY_ACP_SCENARIO",
      JSON.stringify({
        nativeUrl: native.url,
        serviceUrl: native.url,
        skills: [
          {
            id: "explain",
            name: "Explain",
            path: join(root, "repo", "SKILL.md"),
            content: "Explain the requested code carefully.",
          },
        ],
        turn: [
          {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Explained." },
            },
          },
        ],
      }),
    );
    const chat = await chats.create(projectId, { kind: "project" });
    await chats.send(chat.id, {
      ...input("@opencode $explain the cache"),
      provider: "opencode",
      choice: { model: "", reasoningEffort: "", fast: false },
    });
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    );
    const calls = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const prompt = calls.find(
      (c) =>
        c.method === "session/prompt" &&
        c.params.prompt.some((p: { text?: string }) =>
          p.text?.includes(
            "This is a general discussion of the linked project",
          ),
        ),
    );
    const text = prompt?.params.prompt
      .map((p: { text: string }) => p.text)
      .join("\n");
    expect(text).toContain("Explain the requested code carefully.");
    expect(text).toContain("the cache");
    expect(text).toContain(
      "This is a general discussion of the linked project",
    );
  } finally {
    await chats.dispose();
    await native.close();
  }
});

it("lets an OpenCode steer go once admitted and sends one the turn never read as the next turn", async () => {
  const native = await openCodeNativeFixture();
  try {
    native.controls.deliver = false;
    const codex = await findExecutable("codex");
    const cli = await fakeCli(
      join(root, "opencode"),
      await readFile(resolve("tests/fixtures/acp-agent.cjs"), "utf8"),
      "opencode v2.0.32",
    );
    vi.mocked(findExecutable).mockImplementation(async (name) =>
      name === "opencode" ? cli : codex,
    );
    const capture = join(root, "opencode-capture.jsonl");
    vi.stubEnv("RELAY_ACP_LOG", capture);
    vi.stubEnv(
      "RELAY_ACP_SCENARIO",
      JSON.stringify({
        nativeUrl: native.url,
        serviceUrl: native.url,
        turn: [
          { waitNative: true },
          {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Answered." },
            },
          },
        ],
      }),
    );
    const release = (sessionID: string) =>
      fetch(native.url + "/fixture/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionID }),
      });
    const choice = { model: "", reasoningEffort: "" as const, fast: false };
    const chat = await chats.create(projectId, { kind: "project" });
    await chats.send(chat.id, {
      ...input("@opencode Write the notes"),
      provider: "opencode",
      choice,
    });
    await vi.waitFor(() => expect(native.active.size).toBe(1));
    const sessionID = [...native.active][0];
    const steer = {
      ...input("@opencode Keep them short"),
      provider: "opencode" as const,
      choice,
      delivery: "steer" as const,
    };
    // Returns while OpenCode still holds it undelivered, mid-turn.
    await chats.send(chat.id, steer);
    expect(native.inbox.size).toBe(1);
    expect(
      (await chats.get(chat.id)).messages.find((m) => m.id === steer.id),
    ).toMatchObject({ steered: true, unread: true });
    await release(sessionID);
    // The next turn waits too; let it through once it asks.
    await release(sessionID);
    await vi.waitFor(async () => {
      const prompts = (await readFile(capture, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((c) => c.method === "session/prompt");
      expect(prompts).toHaveLength(2);
      const text = prompts[1].params.prompt
        .map((p: { text?: string }) => p.text ?? "")
        .join("\n");
      expect(text).toContain("Keep them short");
      expect(text).toContain("ended before you read");
    });
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    );
    const saved = await chats.get(chat.id);
    expect(saved.messages.find((m) => m.id === steer.id)).not.toMatchObject({
      status: "failed",
    });
    expect(saved.queue ?? []).toHaveLength(0);
    expect(native.inbox.size).toBe(0);
  } finally {
    await chats.dispose();
    await native.close();
  }
});

it("lists Codex's enabled skills and sends a picked one as the `$name` Codex parses", async () => {
  const { agentRuntime } = await import("../agents");
  const skills = await agentRuntime("codex").commands(join(root, "repo"));
  expect(skills.map((s) => s.name)).toEqual(["explain"]);
  const discovery = (await agentCalls())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(discovery).toEqual([expect.objectContaining({ discovery: true })]);
  const chat = await chats.create(projectId, { kind: "project" });
  // Any currency sign picks a skill; Codex only reads `$`.
  await chats.send(chat.id, input("@codex Explain the cache using €explain"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  const turn = calls.find((c) => c.turn).turn.input as {
    type: string;
    text?: string;
  }[];
  expect(turn.map((i) => i.type)).not.toContain("skill");
  expect(turn.find((i) => i.type === "text")?.text).toContain(
    "Explain the cache using $explain",
  );
});

it("records a steer at another effort with the effort Codex's running turn answers it at", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const first = input("@codex wait for cancellation");
  await chats.send(chat.id, first);
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  const followup = {
    ...input("@codex Focus only on the cache key"),
    parentId: null,
    delivery: "steer" as const,
  };
  const lower = { ...followup.choice, reasoningEffort: "low" as const };
  const asked = { ...followup, choice: lower };
  await chats.send(chat.id, asked);
  const steered = (await chats.get(chat.id)).messages.at(-1);
  expect(steered?.id).toBe(asked.id);
  expect(steered?.sentSettings?.choice).toEqual(first.choice);
  await chats.cancel(chat.id);
  await vi.waitFor(async () =>
    expect(
      (await chats.get(chat.id)).messages.find((m) => m.role === "assistant")
        ?.status,
    ).toBe("cancelled"),
  );
});

it("steers an active Codex turn natively, and resumes its saved session with the steer it never read after stop", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  const followup = {
    ...input("@codex Focus only on the cache key"),
    parentId: null,
    delivery: "steer" as const,
  };
  await chats.send(chat.id, followup);
  expect((await chats.get(chat.id)).queue).toHaveLength(0);
  expect((await chats.get(chat.id)).messages.at(-1)?.id).toBe(followup.id);
  expect((await chats.get(chat.id)).messages.at(-1)?.sentSettings).toEqual(
    sentSettingsOf(followup),
  );
  await chats.cancel(chat.id);
  await vi.waitFor(async () =>
    expect(
      (await chats.get(chat.id)).messages.find((m) => m.role === "assistant")
        ?.status,
    ).toBe("cancelled"),
  );
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  await chats.resume(chat.id);
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(calls.find((c) => c.steer)?.steer).toMatchObject({
    threadId: "fixture-thread",
    expectedTurnId: "fixture-turn",
    input: [{ type: "text", text: "Focus only on the cache key" }],
  });
  expect(calls.some((c) => c.interrupt)).toBe(true);
  expect(calls.filter((c) => c.turn).at(-1).turn.input[0].text).toMatch(
    /^My request: Focus only on the cache key\n\nYour previous response ended/,
  );
  expect(calls.filter((c) => c.thread).map((c) => c.method)).toEqual([
    "thread/start",
    "thread/resume",
  ]);
});

it("resuming a stopped answer sends the queue its stop paused once the answer is done", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  const queued = input("@codex Then add a test");
  await chats.send(chat.id, queued);
  await chats.cancel(chat.id);
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  expect((await chats.get(chat.id)).queuePaused).toBe(true);
  await chats.resume(chat.id);
  await vi.waitFor(async () => {
    const saved = await chats.get(chat.id);
    expect(saved.queue ?? []).toHaveLength(0);
    expect(saved.messages.at(-1)?.status).toBe("complete");
    expect(chats.hasActiveProject(projectId)).toBe(false);
  });
  const saved = await chats.get(chat.id);
  expect(saved.queuePaused).toBeFalsy();
  expect(
    saved.messages.filter((m) => m.role === "user").map((m) => m.body),
  ).toEqual([
    "@codex wait for cancellation",
    expect.stringMatching(/^@codex Continue from where/),
    "@codex Then add a test",
  ]);
});

it("steers an active Codex turn with a currency-prefixed skill", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  const followup = {
    ...input("@codex use €review src/a.ts"),
    parentId: null,
    delivery: "steer" as const,
  };
  await chats.send(chat.id, followup);
  expect((await chats.get(chat.id)).queue).toHaveLength(0);
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(calls.find((c) => c.steer)?.steer).toMatchObject({
    input: [{ type: "text", text: "use $review src/a.ts" }],
  });
  await chats.cancel(chat.id);
});

it("steers an active Codex turn with a screenshot", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  const followup = {
    ...input("@codex Look at this"),
    parentId: null,
    delivery: "steer" as const,
    images: [
      {
        name: "screen.png",
        mimeType: "image/png" as const,
        dataUrl: `data:image/png;base64,${tinyPng}`,
      },
    ],
  };
  await chats.send(chat.id, followup);
  const saved = await chats.get(chat.id);
  expect(saved.queue).toHaveLength(0);
  const steered = saved.messages.find((m) => m.id === followup.id);
  expect(steered?.steered).toBe(true);
  expect(steered?.images).toHaveLength(1);
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(calls.find((c) => c.steer)?.steer.input).toEqual([
    expect.objectContaining({ type: "text", text: "Look at this" }),
    expect.objectContaining({ type: "localImage" }),
  ]);
  await chats.cancel(chat.id);
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
});

it("shows a stop at once and sends the next message once the agent lets go", async () => {
  // The agent winds down only once the test lets it go; until then only
  // Relay's own 3 s give-up in electron/agents/codex/codex.ts frees it.
  const release = join(root, "stop-release");
  vi.stubEnv("RELAY_FIXTURE_STOP_RELEASE", release);
  const turns = (
    chats as unknown as {
      active: { finished(id: string): Promise<void> };
    }
  ).active;
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  const answerId = (await chats.get(chat.id)).messages.at(-1)!.id;
  const order: string[] = [];
  const stopping = chats
    .cancel(chat.id)
    .then(() => order.push("stop returned"));
  // The turn is stopping now, so this waits for the agent to let go.
  const letGo = turns.finished(chat.id).then(() => order.push("agent let go"));
  await Promise.race([stopping, letGo]);
  // A stop that waited for the agent would return only after the give-up.
  expect(order).toEqual(["stop returned"]);
  const shown = events.filter((e) => e.message.id === answerId).at(-1)?.message;
  expect(shown?.status).toBe("cancelled");
  expect(
    chats.list(projectId).find((c) => c.id === chat.id)?.running,
  ).toBeUndefined();
  await vi.waitFor(async () =>
    expect(await agentCalls()).toContain('"interrupt"'),
  );

  const finished = turns.finished.bind(turns);
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => (reached = resolve));
  vi.spyOn(turns, "finished").mockImplementation((id) => {
    if (id === chat.id) reached();
    return finished(id);
  });
  const next = input("@codex carry on");
  const sending = chats.send(chat.id, next).then(() => order.push("sent"));
  // Either the send waits for the held agent, or it went out without waiting.
  await Promise.race([waiting, sending]);
  expect(order).toEqual(["stop returned"]);
  await writeFile(release, "");
  await sending;
  expect(order).toEqual(["stop returned", "agent let go", "sent"]);
  const saved = await chats.get(chat.id);
  expect(saved.queue ?? []).toHaveLength(0);
  expect(saved.messages.find((m) => m.id === answerId)?.status).toBe(
    "cancelled",
  );
  expect(saved.messages.some((m) => m.id === next.id)).toBe(true);
});

it("resumes a stopped answer with the agent picked since", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  await chats.cancel(chat.id);
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  const choice = { model: "", reasoningEffort: "" as const, fast: false };
  await chats.resume(chat.id, {
    provider: "claude",
    choice,
    runtimeMode: "approval-required",
    interactionMode: "default",
  });
  // Codex's handoff note lands complete before Claude's answer is added.
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)).toMatchObject({
      provider: "claude",
      status: "complete",
    }),
  );
  const after = await chats.get(chat.id);
  expect(after.lastInput).toMatchObject({ provider: "claude", choice });
  expect(after.lastInput?.body).toMatch(/^@claude Continue/);
  const resume = after.messages.find((m) => m.resumed);
  expect(resume).toMatchObject({
    role: "user",
    provider: "claude",
    body: after.lastInput?.body,
  });
  expect(after.messages[0].resumed).toBeUndefined();
  expect(
    events.some((e) => e.message.id === resume?.id && e.message.resumed),
  ).toBe(true);
  await chats.dispose();
  restart((e) => events.push(e));
  expect(
    (await chats.get(chat.id)).messages.find((m) => m.id === resume?.id)
      ?.resumed,
  ).toBe(true);
});

it("tells an agent about steering that went to the other agent", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const idle = () =>
    vi.waitFor(async () => {
      expect((await chats.get(chat.id)).messages.at(-1)?.status).not.toBe(
        "streaming",
      );
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(chat.id, claude("@claude Explain the cache guard"));
  await idle();
  await chats.send(chat.id, input("@codex wait for cancellation"));
  // Claude's handoff note comes first; steer Codex's own answer.
  await vi.waitFor(async () => {
    const last = (await chats.get(chat.id)).messages.at(-1);
    expect(last?.provider).toBe("codex");
    expect(last?.body).toContain("cache guard");
  });
  await chats.send(chat.id, {
    ...input("@codex Focus only on the cache key"),
    delivery: "steer",
  });
  expect((await chats.get(chat.id)).messages.at(-1)?.steered).toBe(true);
  await chats.cancel(chat.id);
  await idle();
  await chats.send(chat.id, claude("@claude Carry on"));
  await idle();
  const prompt = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((c) => c.provider === "claude" && !c.args.includes("--print"))
    .map((c) => JSON.parse(c.prompt).message.content[0].text as string)
    .find((text) => text.startsWith("My request: Carry on"))!;
  expect(prompt).toContain("Focus only on the cache key");
});

it("carries a steer Claude never read before the stop, screenshot included, into the resumed turn, once", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  const idle = () =>
    vi.waitFor(async () => {
      expect((await chats.get(chat.id)).messages.at(-1)?.status).not.toBe(
        "streaming",
      );
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
  await chats.send(chat.id, claude("@claude fixture long tool"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toBe(
      "Looking into it.",
    ),
  );
  const steer = {
    ...claude("@claude I meant better matching"),
    delivery: "steer" as const,
    images: [
      {
        name: "screen.png",
        mimeType: "image/png" as const,
        dataUrl: `data:image/png;base64,${tinyPng}`,
      },
    ],
  };
  await chats.send(chat.id, steer);
  await chats.cancel(chat.id);
  await idle();
  expect(
    (await chats.get(chat.id)).messages.find((m) => m.id === steer.id),
  ).toMatchObject({ steered: true, missed: true });
  await chats.resume(chat.id);
  await idle();
  await chats.send(chat.id, claude("@claude Carry on"));
  await idle();
  const prompts = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((c) => c.provider === "claude" && !c.args.includes("--print"))
    .map((c) => JSON.parse(c.prompt))
    .filter((m) => !m.priority)
    .map((m) => m.message.content as { type: string; text?: string }[]);
  expect(prompts.at(-2)![0]!.text).toMatch(
    /^My request: I meant better matching\n\nYour previous response ended before you read/,
  );
  expect(prompts.at(-2)!.map((part) => part.type)).toEqual(["text", "image"]);
  expect(prompts.at(-1)![0]!.text).toMatch(/^My request: Carry on/);
  expect(prompts.at(-1)![0]!.text).not.toContain("better matching");
  expect(prompts.at(-1)!.map((part) => part.type)).toEqual(["text"]);
  const saved = await chats.get(chat.id);
  expect(saved.messages.find((m) => m.id === steer.id)?.missed).toBeUndefined();
});

it("stopping to send an unread steer sends it right away, then the queue", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(chat.id, claude("@claude fixture long tool"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toBe(
      "Looking into it.",
    ),
  );
  await chats.send(chat.id, {
    ...claude("@claude I meant better matching"),
    delivery: "steer",
  });
  await chats.send(chat.id, claude("@claude Then add a test"));
  await chats.cancel(chat.id, { steers: true });
  await vi.waitFor(
    async () => {
      const saved = await chats.get(chat.id);
      expect(saved.queue ?? []).toHaveLength(0);
      expect(saved.messages.at(-1)?.status).toBe("complete");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    },
    { timeout: 10_000 },
  );
  const prompts = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((c) => c.provider === "claude" && !c.args.includes("--print"))
    .map((c) => JSON.parse(c.prompt))
    .filter((m) => !m.priority)
    .map((m) => m.message.content[0].text as string);
  expect(prompts.at(-2)).toMatch(/^My request: I meant better matching\n/);
  expect(prompts.at(-1)).toMatch(/^My request: Then add a test/);
  expect((await chats.get(chat.id)).queuePaused).toBeFalsy();
});

it("stopping by keys with no steer waiting is a plain stop", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude fixture long tool"),
    provider: "claude",
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toBe(
      "Looking into it.",
    ),
  );
  await chats.cancel(chat.id, { steers: true });
  await vi.waitFor(async () => {
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
      "cancelled",
    );
    expect(chats.hasActiveProject(projectId)).toBe(false);
  });
  expect((await chats.get(chat.id)).messages).toHaveLength(2);
});
