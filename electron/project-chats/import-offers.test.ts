import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../app/store";
import { Projects } from "../projects/projects";
import { ProjectChats } from "./index";
import type { ChatStorage } from "./storage";
import { writeStoredCodexSession } from "../../tests/fixtures/codex-store";
import { ghostId, type ImportOffer } from "../../shared/import-offer";

let dir: string, home: string, chats: ProjectChats, projects: Projects;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "relay-import-offer-")));
  home = join(dir, "codex");
  vi.stubEnv("CODEX_HOME", home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(dir, "claude"));
  const store = new Store(join(dir, "state"));
  await store.load();
  projects = new Projects(store);
  chats = new ProjectChats(store, projects, join(dir, "chats"), () => {});
});
afterEach(async () => {
  await chats?.dispose();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true, maxRetries: 20 });
});

const turns = [{ prompt: "Look at the build", answer: "It works." }];

async function source(name: string, sessions: number) {
  const path = join(dir, name);
  await mkdir(path);
  for (let i = 0; i < sessions; i++)
    await writeStoredCodexSession(home, path, `${name}-${i}`, turns, {
      name: `${name} ${i}`,
    });
  return path;
}

/** The thread's answer carrying an offer, as offer_import leaves it. */
async function offered(
  build: (keys: Record<string, string>) => ImportOffer["projects"],
) {
  const keys = Object.fromEntries(
    (await chats.imports.list("codex")).map((p) => [p.name, p.key]),
  );
  await mkdir(join(dir, "scratch"));
  const scratch = await projects.add(join(dir, "scratch"), null, {});
  const thread = await chats.create(scratch.id, { kind: "project" });
  await chats.importOffers.open(thread.id, "codex");
  const storage = (chats as unknown as { storage: ChatStorage }).storage;
  const chat = await storage.load(thread.id);
  // With each source's chats, as offer_import fills them in.
  const offer: ImportOffer = {
    id: "offer",
    app: "codex",
    projects: await Promise.all(
      build(keys).map(async (p) => ({
        ...p,
        chats: await chats.imports.chats("codex", p.key),
      })),
    ),
  };
  chat.messages.push({
    id: "answer",
    role: "assistant",
    body: "Here's what Codex has.",
    created: Date.now(),
    provider: "claude",
    status: "complete",
    version: 1,
    importOffer: offer,
  });
  await storage.save(chat);
  return { thread, keys, storage };
}

it("imports what was ticked and puts new projects where the user dragged them", async () => {
  await source("website", 2);
  await source("game", 1);
  const backendPath = await source("backend", 2);
  const backend = await projects.add(backendPath, null, { exact: true });
  await projects.move(backend.id, "Work", null);
  const { thread, keys, storage } = await offered((k) => [
    {
      key: k.website!,
      name: "website",
      path: join(dir, "website"),
      group: "Work",
      chats: [],
      picked: [],
    },
    {
      key: k.game!,
      name: "game",
      path: join(dir, "game"),
      group: "Personal",
      chats: [],
      picked: [],
    },
    {
      key: k.backend!,
      name: "backend",
      path: backendPath,
      projectId: backend.id,
      group: "Work",
      chats: [],
      picked: [],
    },
  ]);
  const offerChats = async (name: string) =>
    (await chats.imports.chats("codex", keys[name]!)).map((c) => c.id);
  // Website above Backend, one of Backend's chats, the game left out.
  const result = await chats.importOffers.run(thread.id, "answer", {
    picks: {
      [keys.website!]: await offerChats("website"),
      [keys.backend!]: (await offerChats("backend")).slice(0, 1),
    },
    placements: [{ key: keys.website!, group: "Work", before: backend.id }],
  });
  expect(result.failures).toEqual([]);
  const work = (await projects.list(null)).filter((p) => p.folder === "Work");
  expect(work.map((p) => p.path)).toEqual([join(dir, "website"), backendPath]);
  expect(
    (await projects.list(null)).some((p) => p.path === join(dir, "game")),
  ).toBe(false);
  const done = (await storage.load(thread.id)).messages.at(-1)!.importOffer!
    .done!;
  expect(
    Object.values(done.imported)
      .map((ids) => ids.length)
      .sort(),
  ).toEqual([1, 2]);
  await expect(
    chats.importOffers.run(thread.id, "answer", { picks: {}, placements: [] }),
  ).rejects.toThrow("already imported");
});

it("places a new project above another new one the user put below it", async () => {
  await source("alpha", 1);
  await source("beta", 1);
  const { thread, keys } = await offered((k) => [
    {
      key: k.alpha!,
      name: "alpha",
      path: join(dir, "alpha"),
      group: "Work",
      chats: [],
      picked: [],
    },
    {
      key: k.beta!,
      name: "beta",
      path: join(dir, "beta"),
      group: "Work",
      chats: [],
      picked: [],
    },
  ]);
  await chats.importOffers.run(thread.id, "answer", {
    picks: { [keys.alpha!]: [], [keys.beta!]: [] },
    placements: [
      { key: keys.beta!, group: "Work", before: ghostId(keys.alpha!) },
      { key: keys.alpha!, group: "Work", before: null },
    ],
  });
  expect(
    (await projects.list(null))
      .filter((p) => p.folder === "Work")
      .map((p) => p.path),
  ).toEqual([join(dir, "beta"), join(dir, "alpha")]);
});
