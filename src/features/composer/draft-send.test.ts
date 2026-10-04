import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { defaultAISettings } from "../../../shared/settings";
import type { ChatSummary, Project } from "../../../shared/projects";
import type { CodeReference } from "../../../shared/code-references";
import type { DraftImage } from "../images/draft-images";
import { threadStorage } from "../../lib/thread-storage";
import { readDraft, writeDraft } from "./drafts";
import { sendDraft, unsent } from "./draft-send";

const images = new Map<string, DraftImage[]>();
const sends: { resolve: () => void; body: string }[] = [];
vi.mock("../images/draft-images", () => ({
  loadDraftImages: async (key: string) => images.get(key) ?? [],
  saveDraftImages: async (key: string, list: DraftImage[]) =>
    void images.set(key, list),
}));
vi.mock("../../lib/api", () => ({
  api: {
    aiSettings: async () => defaultAISettings,
    agentModels: async () => [],
    sendProjectChat: (_id: string, send: { body: string }) =>
      new Promise<void>((resolve) => sends.push({ resolve, body: send.body })),
  },
}));

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  images.clear();
  sends.length = 0;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const project: Project = {
  id: "p1",
  name: "Relay",
  path: "/tmp/relay",
  repository: null,
  added: 1,
};
const chat: ChatSummary = {
  id: "c1",
  projectId: "p1",
  title: "Flaky test",
  scope: { kind: "project" },
  created: 1,
  updated: 1,
};
const key = "chat-draft:c1";
const shot = (id: string, n: number): DraftImage => ({
  id,
  n,
  name: `${id}.png`,
  mimeType: "image/png",
  dataUrl: "data:image/png;base64,AA==",
});

const ref = (path: string): CodeReference => ({
  path,
  start: 1,
  end: 2,
  label: "Working file",
  code: "const a = 1;",
});

async function sendHeldBack() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sent = sendDraft(qc, { key, id: chat.id, project, chat, reply: false });
  await vi.waitFor(() => expect(sends).toHaveLength(1));
  return {
    body: sends[0].body,
    finish: async () => {
      sends[0].resolve();
      return sent;
    },
  };
}

it("keeps what was written and attached while the draft went out", async () => {
  writeDraft(key, "Fix the flaky test [Image #1]");
  images.set(key, [shot("a", 1)]);
  threadStorage(chat.id).codeRefs.save([ref("src/a.ts")]);
  const send = await sendHeldBack();
  expect(send.body).toContain("Fix the flaky test");

  writeDraft(
    key,
    "Fix the flaky test [Image #1]\n\nand the slow one [Image #2]",
  );
  images.set(key, [shot("a", 1), shot("b", 2)]);
  threadStorage(chat.id).codeRefs.save([ref("src/b.ts")]);
  expect(await send.finish()).toBe(chat);

  expect(readDraft(key)).toBe("and the slow one [Image #2]");
  expect(images.get(key)?.map((i) => i.id)).toEqual(["b"]);
  expect(
    threadStorage(chat.id)
      .codeRefs.load()
      .map((r) => r.path),
  ).toEqual(["src/b.ts"]);
});

it("empties a draft nobody touched while it went out", async () => {
  writeDraft(key, "Fix the flaky test [Image #1]");
  images.set(key, [shot("a", 1)]);
  const send = await sendHeldBack();
  await send.finish();
  expect(readDraft(key)).toBe("");
  expect(images.get(key)).toEqual([]);
});

it("leaves a draft rewritten while it went out as it is", () => {
  expect(unsent("Fix the slow test instead", "Fix the flaky test")).toBe(
    "Fix the slow test instead",
  );
});
