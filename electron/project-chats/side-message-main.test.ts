import {
  chats,
  projectId,
  useProjectChats,
} from "../../tests/fixtures/project-chats-harness";
// A side conversation tells its thread something through Relay's tool, the
// way a real one does: the fake agent in the /btw fork calls message_main over
// the MCP server, at the path only side conversations reach.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { AgentProvider } from "../../shared/agents";
import { defaultAISettings } from "../../shared/settings";
import { StartedThreads } from "../started-threads";
import { serveRelayTools, useRelayMcp, verifyRelayToken } from "../relay-mcp";
vi.mock("../platform/executables");

const secret = "d".repeat(64);
let closeTools: () => Promise<void>;

useProjectChats();

beforeEach(async () => {
  const serving = serveRelayTools(0, {
    verify: (token) => verifyRelayToken(secret, token),
    call: new StartedThreads(chats).handle,
  });
  await serving.ready;
  closeTools = serving.close;
  const { port } = serving.server.address() as { port: number };
  useRelayMcp({ port, secret });
});

afterEach(async () => {
  useRelayMcp(undefined);
  await closeTools?.();
});

const input = (provider: AgentProvider, body: string) => ({
  id: randomUUID(),
  body: `@${provider} ${body}`,
  provider,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  choice: { ...defaultAISettings.questions, model: "fixture-model" },
});

/** A thread whose answer is still running, and a /btw asked beside it. */
async function askAside(provider: AgentProvider, running: string, ask: string) {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input(provider, running));
  await vi.waitFor(async () =>
    expect(
      (await chats.get(chat.id)).sessions?.[provider]?.thread,
    ).toBeTruthy(),
  );
  const question = { ...input(provider, ask), side: true as const };
  await chats.send(chat.id, question);
  const answer = await vi.waitFor(async () => {
    const reply = (await chats.get(chat.id)).messages.find(
      (m) => m.parentId === question.id && m.role === "assistant",
    );
    expect(reply?.status).toBe("complete");
    return reply!;
  });
  return { chat, answer };
}

const told = (message: string) =>
  `fixture relay message_main ${JSON.stringify({ message })}`;

it.each([
  ["codex", "wait for cancellation"],
  ["claude", "fixture wait for steer"],
] as const)(
  "lets %s's side conversation tell the thread what it settled on",
  async (provider, running) => {
    const { chat, answer } = await askAside(
      provider,
      running,
      told("We settled on caching per account."),
    );
    expect(answer.body).toContain("the main thread reads it mid-answer");
    const thread = await chats.get(chat.id);
    const heard = thread.messages.find((m) => m.fromThread);
    expect(heard?.fromThread).toBe(chat.id);
    expect(heard?.author).toBe("Side conversation");
    expect(heard?.body).toBe(
      "From a side conversation of this thread:\n\nWe settled on caching per account.",
    );
  },
);

it("keeps a side conversation from acting as its thread", async () => {
  const { answer } = await askAside(
    "codex",
    "wait for cancellation",
    `fixture relay move_to_worktree ${JSON.stringify({ branch: "side" })}`,
  );
  expect(answer.body).toContain("There is no tool move_to_worktree");
});
