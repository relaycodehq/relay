import { beforeEach, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentOptions } from "../../agents/types";
import { Store } from "../../app/store";
import { PluginSecrets } from "../secrets";
import { defaultClockifySettings } from "../../../shared/clockify";
import type { ChatMessage, ProjectChat } from "../../../shared/projects";

const prompts: string[] = [];
let reply = "";
vi.mock("../../agents", () => ({
  agentRuntime: () => ({
    run: async (options: AgentOptions) => {
      prompts.push(options.prompt);
      return reply;
    },
  }),
}));
const { ClockifyPlugin } =
  await import("./service");

const MIN = 60_000;
const DAY = Date.parse("2026-09-30T08:00:00Z");
const TOKEN = "c2VjcmV0LWNsb2NraWZ5LWtleQ";

const message = (
  role: "user" | "assistant",
  created: number,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id: `${role}-${created}`,
  role,
  body: role === "user" ? "Fix the license key import" : "Done.",
  status: "complete",
  created,
  provider: "codex",
  version: 1,
  ...extra,
});
const chat = (
  id: string,
  projectId: string,
  messages: ChatMessage[],
): ProjectChat => ({
  id,
  projectId,
  title: `Thread ${id}`,
  scope: { kind: "project" } as ProjectChat["scope"],
  created: DAY,
  updated: Math.max(...messages.map((m) => m.ended ?? m.created)),
  messages,
});

interface Posted {
  url: string;
  body: { start: string; end: string; projectId: string; description: string };
}

async function setup(chats: ProjectChat[]) {
  const store = new Store(await mkdtemp(join(tmpdir(), "relay-clockify-")));
  await store.load();
  let now = DAY;
  const posted: Posted[] = [];
  const fail = { post: 0 };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    if (headers["X-Api-Key"] !== TOKEN)
      return new Response("{}", { status: 401 });
    if (url.endsWith("/user"))
      return Response.json({ id: "u1", name: "Lubo", activeWorkspace: "w1" });
    if (url.includes("/user/u1/time-entries"))
      return Response.json(
        posted.map((p, i) => ({
          id: `e${i + 1}`,
          projectId: p.body.projectId,
          timeInterval: { start: p.body.start },
        })),
      );
    if (url.endsWith("/time-entries") && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      posted.push({ url, body });
      // The entry lands, but the answer never makes it back.
      if (fail.post-- > 0) throw new Error("socket hang up");
      return Response.json({ id: `e${posted.length}` });
    }
    return new Response("{}", { status: 404 });
  });
  const plugin = new ClockifyPlugin({
    store,
    secrets: new PluginSecrets(
      store,
      async (v) => `sealed:${v}`,
      async (v) => v.slice("sealed:".length),
    ),
    fetch,
    chats: {
      summaries: () => chats,
      get: async (id) => chats.find((c) => c.id === id)!,
    },
    projectName: (id) => ({ pa: "Licensing", pb: "Website" })[id] ?? id,
    aiSettings: () => store.aiSettings(),
    now: () => now,
  });
  await store.update((s) => {
    s.plugins = { clockify: true };
  });
  await plugin.save(
    { ...defaultClockifySettings, projects: { pa: "cA", pb: "cB" } },
    { token: TOKEN },
  );
  return {
    store,
    plugin,
    posted,
    fail,
    fetch,
    at: (minutes: number) => (now = DAY + minutes * MIN),
  };
}

beforeEach(() => {
  prompts.length = 0;
  reply = "";
});

it("checks the key, picks the active workspace and never keeps the key in plain text", async () => {
  const { store, plugin } = await setup([]);
  expect(plugin.status()).toMatchObject({
    hasToken: true,
    persistent: true,
    settings: { workspaceId: "w1" },
  });
  expect(JSON.stringify(store.get())).not.toContain(`"${TOKEN}"`);
  expect(JSON.stringify(plugin.status())).not.toContain(TOKEN);
});

it("keeps the key for the session when the OS can't seal it", async () => {
  const store = new Store(await mkdtemp(join(tmpdir(), "relay-secrets-")));
  await store.load();
  const secrets = new PluginSecrets(
    store,
    async () => null,
    async (v) => v,
  );
  await secrets.set("clockify", "token", TOKEN);
  expect(await secrets.get("clockify", "token")).toBe(TOKEN);
  expect(secrets.persistent("clockify")).toBe(false);
  expect(store.get().pluginSecrets?.clockify?.token).toBeUndefined();
  await secrets.set("clockify", "token", null);
  expect(secrets.has("clockify", "token")).toBe(false);
});

it("turns a day of threads into described entries and sends them once", async () => {
  const chats = [
    chat("a1", "pa", [
      message("user", DAY + 5 * MIN),
      message("assistant", DAY + 5 * MIN, {
        ended: DAY + 50 * MIN,
        changes: [{ path: "src/license.ts", additions: 3, deletions: 1 }],
      }),
    ]),
    chat("b1", "pb", [
      message("user", DAY + 70 * MIN, { body: "Tighten the pricing page" }),
      message("assistant", DAY + 70 * MIN, { ended: DAY + 100 * MIN }),
    ]),
  ];
  const { plugin, posted, at } = await setup(chats);
  await plugin.timer("start");
  at(40);
  await plugin.touch("pa", "a1");
  at(120);
  const stopped = await plugin.timer("stop");
  const blocks = stopped.review!.blocks;
  expect(blocks.map((b) => [b.relayProjectId, b.clockifyProjectId])).toEqual([
    ["pa", "cA"],
    ["pb", "cB"],
  ]);
  expect(blocks.at(-1)!.end - blocks[0].start).toBe(120 * MIN);
  expect(stopped.review!.threads).toEqual({
    a1: "Thread a1",
    b1: "Thread b1",
  });

  reply = JSON.stringify({
    entries: blocks.map((b) => ({
      id: b.id,
      description:
        b.relayProjectId === "pa" ? "License key import" : "Pricing page",
    })),
  });
  const described = await plugin.describe();
  expect(prompts.at(-1)).toContain("src/license.ts");
  expect(prompts.at(-1)).toContain("Tighten the pricing page");
  expect(described.review!.blocks.map((b) => b.description)).toEqual([
    "License key import",
    "Pricing page",
  ]);

  await plugin.submit();
  await plugin.submit();
  expect(posted.map((p) => [p.body.projectId, p.body.description])).toEqual([
    ["cA", "License key import"],
    ["cB", "Pricing page"],
  ]);
  expect(posted[0].body.start).toBe("2026-09-30T08:00:00Z");
});

it("doesn't send an entry twice when Clockify saved it but the answer was lost", async () => {
  const chats = [
    chat("a1", "pa", [
      message("user", DAY),
      message("assistant", DAY, { ended: DAY + 60 * MIN }),
    ]),
  ];
  const { plugin, posted, fail, at } = await setup(chats);
  await plugin.timer("start");
  at(60);
  await plugin.timer("stop");
  fail.post = 1;
  await expect(plugin.submit()).rejects.toThrow("Couldn't reach Clockify");
  expect(plugin.status().review!.submitError).toBeTruthy();
  await plugin.submit();
  expect(posted).toHaveLength(1);
  expect(plugin.status().review!.blocks[0].submittedId).toBe("e1");
});

it("keeps a description typed while Luna was still writing", async () => {
  const chats = [
    chat("a1", "pa", [
      message("user", DAY),
      message("assistant", DAY, { ended: DAY + 30 * MIN }),
    ]),
  ];
  const { plugin, at } = await setup(chats);
  await plugin.timer("start");
  at(30);
  const [block] = (await plugin.timer("stop")).review!.blocks;
  reply = JSON.stringify({
    entries: [{ id: block.id, description: "Luna's" }],
  });
  const describing = plugin.describe();
  await plugin.saveReview([{ id: block.id, description: "Mine" }]);
  await describing;
  expect(plugin.status().review!.blocks[0].description).toBe("Mine");
});

it("stops a timer left running overnight where the work stopped", async () => {
  const chats = [
    chat("a1", "pa", [
      message("user", DAY),
      message("assistant", DAY, { ended: DAY + 60 * MIN }),
    ]),
  ];
  const { plugin, at } = await setup(chats);
  await plugin.timer("start");
  at(24 * 60);
  const { review } = await plugin.timer("stop");
  expect((review!.end - review!.start) / MIN).toBe(60 + 20);
});

it("never puts the key into an error", async () => {
  const { plugin, fetch } = await setup([]);
  fetch.mockImplementationOnce(async () =>
    Response.json({ message: `bad key ${TOKEN}` }, { status: 400 }),
  );
  const error = await plugin.workspaces().catch((e: Error) => e);
  expect(String(error)).toContain("Clockify answered 400");
  expect(String(error)).not.toContain(TOKEN);
});

it("drops an entry dragged down to nothing and joins what then touches", async () => {
  const { tidy } = await import("../../../shared/clockify");
  const block = (id: string, start: number, end: number, project: string) => ({
    id,
    start: start * MIN,
    end: end * MIN,
    relayProjectId: project,
    clockifyProjectId: project,
    description: id === "a" ? "" : `${id} work`,
    chatIds: [id],
  });
  expect(
    tidy([
      block("a", 0, 30, "cA"),
      block("b", 30, 30, "cB"),
      block("c", 30, 50, "cA"),
      { ...block("d", 50, 60, "cA"), submittedId: "e1" },
    ]),
  ).toEqual([
    expect.objectContaining({
      id: "a",
      end: 50 * MIN,
      description: "c work",
      chatIds: ["a", "c"],
    }),
    expect.objectContaining({ id: "d", submittedId: "e1" }),
  ]);
});

it("pauses the day when turned off, so off time never counts", async () => {
  const { store, plugin, at } = await setup([]);
  await plugin.timer("start");
  at(30);
  await store.update((s) => {
    s.plugins = { clockify: false };
  });
  await plugin.turnedOff();
  expect(plugin.status().day!.pauses).toEqual([{ start: DAY + 30 * MIN }]);
  await plugin.touch("pa");
  expect(store.get().clockify!.day!.touches).toEqual([]);
  await expect(plugin.timer("resume")).rejects.toThrow("Turn on");
  await store.update((s) => {
    s.plugins = { clockify: true };
  });
  at(90);
  await plugin.timer("resume");
  at(100);
  const { review } = await plugin.timer("stop");
  const worked = review!.blocks.reduce((s, b) => s + b.end - b.start, 0);
  expect(worked / MIN).toBe(40);
});
