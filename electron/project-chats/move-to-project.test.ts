import {
  root,
  chats,
  projects,
  useProjectChats,
} from "../../tests/fixtures/project-chats-harness";
// An agent moves its Scratchpad thread into a project through Relay's tool,
// the way a real one does: the fake Codex calls move_to_project over the MCP
// server mid-answer, and its next message starts in the project's folder.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { defaultAISettings } from "../../shared/settings";
import { StartedThreads } from "../started-threads";
import { serveRelayTools, useRelayMcp, verifyRelayToken } from "../relay-mcp";
vi.mock("../platform/executables");

const secret = "c".repeat(64);
let closeTools: () => Promise<void>;
let decision: "accept" | "decline";

useProjectChats();
beforeEach(async () => {
  decision = "accept";
  vi.spyOn(chats, "askInTurn").mockImplementation(async () => ({
    kind: "approval",
    decision,
  }));
  const serving = serveRelayTools(0, {
    verify: (token) => verifyRelayToken(secret, token),
    call: new StartedThreads(chats, {
      projects: {
        list: () => projects.list(null),
        add: () => Promise.reject(new Error("Not here.")),
        repositoryRoot: async () => null,
        rules: () => Promise.reject(new Error("Not here.")),
      },
    }).handle,
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

const input = (body: string) => ({
  id: randomUUID(),
  body,
  provider: "codex" as const,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  choice: { ...defaultAISettings.questions, model: "fixture-model" },
});

async function answered(id: string, count: number) {
  await vi.waitFor(async () => {
    const chat = await chats.get(id);
    expect(chat.messages).toHaveLength(count);
    expect(chat.messages.at(-1)?.status).toBe("complete");
  });
  return chats.get(id);
}

async function scratchAndHangar() {
  const scratch = await projects.scratch(join(root, "scratch"), () => false);
  await mkdir(join(root, "hangar"));
  const hangar = await projects.add(join(root, "hangar"), null);
  const chat = await chats.create(scratch.id, { kind: "project" });
  return { scratch, hangar, chat };
}

const moveTo = (projectId: string) =>
  input(
    `@codex fixture relay move_to_project ${JSON.stringify({ project: projectId })}`,
  );

it("moves a Scratchpad thread into a project, its next session starting there", async () => {
  const { scratch, hangar, chat } = await scratchAndHangar();
  await chats.send(chat.id, moveTo(hangar.id));
  const moved = await answered(chat.id, 2);
  expect(moved.projectId).toBe(hangar.id);
  expect(chats.list(hangar.id).map((c) => c.id)).toEqual([chat.id]);
  expect(chats.list(scratch.id)).toEqual([]);
  expect(vi.mocked(chats.askInTurn).mock.calls[0][1]).toMatchObject({
    kind: "approval",
    title: `Move this thread to “${hangar.name}”?`,
  });
  const folder = await realpath(join(root, "hangar"));
  expect(moved.workspaceMoves).toEqual([
    expect.objectContaining({
      how: "project",
      to: folder,
      project: hangar.name,
      unasked: true,
      by: "codex",
    }),
  ]);

  await chats.send(chat.id, input("@codex fixture echo: still here"));
  await answered(chat.id, 4);
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  expect(calls.filter((c) => c.thread).at(-1).thread.cwd).toBe(folder);
});

it("leaves the thread where it was when the user declines", async () => {
  const { scratch, hangar, chat } = await scratchAndHangar();
  decision = "decline";
  await chats.send(chat.id, moveTo(hangar.id));
  const done = await answered(chat.id, 2);
  expect(done.messages[1].body).toContain("didn't move this thread");
  expect(done.projectId).toBe(scratch.id);
  expect(done.workspaceMoves).toBeUndefined();
});
