import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  flush,
  harnessReact,
  mount,
  rerender,
} from "../../../tests/unit/hook-harness";
import type { CodeReference } from "../../../shared/code-references";
import type { LineQuestion } from "../../../shared/questions";
import type { WorkItem } from "../../../shared/devops";
import { buildSend } from "../../../shared/compose-send";
import { threadStorage } from "../../lib/thread-storage";
import { useComposerAttachments } from "./useComposerAttachments";
import { useThreadSend } from "./useThreadSend";
import { writeGate } from "./write-gate";

vi.mock("react", () => harnessReact);
const api = vi.hoisted(() => ({ sendProjectChat: vi.fn() }));
vi.mock("../../lib/api", () => ({ api }));

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  api.sendProjectChat.mockResolvedValue(undefined);
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

const id = "thread";
const message = buildSend(
  {
    to: "codex",
    choice: { model: "", reasoningEffort: "", fast: false },
    runtimeMode: "full-access",
    interactionMode: "default",
  },
  "Review first.ts",
);
const ref = (path: string): CodeReference => ({
  path,
  start: 1,
  end: 1,
  label: "Working file",
  code: `${path}();`,
});
const selection: LineQuestion = {
  head: "a".repeat(40),
  base: "b".repeat(40),
  path: "first.ts",
  start: 1,
  end: 1,
  side: "additions",
  question: "Why?",
};
const workItem: WorkItem = {
  id: 1,
  title: "First issue",
  type: "Bug",
  state: "Active",
  areaPath: "Relay",
  project: "Relay",
  tags: [],
  changed: "2026-10-13",
  priority: 1,
  currentSprint: false,
  assignedTo: "",
  description: "",
  url: "https://example.com/1",
};

function thread() {
  const onOpen = vi.fn();
  const gate = writeGate({ onBusy() {}, onError() {} });
  return mount(() => {
    const attachments = useComposerAttachments(id);
    const sending = useThreadSend({
      handle: {
        chat: { id },
        id,
        reserve: gate.reserve,
        refetch: async () => {},
        listChanged: async () => {},
        setError() {},
      } as never,
      newThread: async () => {},
      attachments,
      viewing: null,
      confirmSwitch: async () => true,
      onSent() {},
      onOpen,
    });
    return { attachments, sending, onOpen };
  });
}

it("clears only attachments sent, retaining code and other context added during the request", async () => {
  let finish!: () => void;
  let entered!: () => void;
  const posting = new Promise<void>((resolve) => (entered = resolve));
  api.sendProjectChat.mockImplementation(async () => {
    entered();
    await new Promise<void>((resolve) => (finish = resolve));
  });
  const current = thread();
  current().attachments.addCodeRefs([ref("first.ts")]);
  current().attachments.setSelection(selection);
  current().attachments.setWorkItem(workItem);
  rerender();
  const sending = current().sending.send(message);
  await posting;
  current().attachments.addCodeRefs([ref("next.ts")]);
  const nextSelection = { ...selection, path: "next.ts" };
  const nextWorkItem = { ...workItem, id: 2, title: "Next issue" };
  current().attachments.setSelection(nextSelection);
  current().attachments.setWorkItem(nextWorkItem);
  rerender();
  expect(api.sendProjectChat.mock.calls[0][1].body).not.toContain("next.ts");
  finish();
  expect(await sending).toBe(true);
  await flush();
  rerender();
  expect(threadStorage(id).codeRefs.load()).toEqual([ref("next.ts")]);
  expect(threadStorage(id).selection.load()).toEqual(nextSelection);
  expect(threadStorage(id).workItem.load()).toEqual(nextWorkItem);
});

it("keeps a newer excerpt at the same location when a previous excerpt completes sending", async () => {
  let finish!: () => void;
  let entered!: () => void;
  const posting = new Promise<void>((resolve) => (entered = resolve));
  api.sendProjectChat.mockImplementation(async () => {
    entered();
    await new Promise<void>((resolve) => (finish = resolve));
  });
  const current = thread();
  current().attachments.addCodeRefs([ref("first.ts")]);
  rerender();
  const sending = current().sending.send(message);
  await posting;
  const edited = { ...ref("first.ts"), code: "changed();" };
  current().attachments.setCodeRefs([edited]);
  rerender();
  finish();
  expect(await sending).toBe(true);
  rerender();
  expect(threadStorage(id).codeRefs.load()).toEqual([edited]);
});

it("keeps attachments when a send fails and clears unchanged ones after success", async () => {
  const current = thread();
  current().attachments.addCodeRefs([ref("first.ts")]);
  current().attachments.setSelection(selection);
  current().attachments.setWorkItem(workItem);
  rerender();
  api.sendProjectChat.mockRejectedValueOnce(new Error("offline"));
  expect(await current().sending.send(message)).toBe(false);
  rerender();
  expect(current().attachments.codeRefs).toEqual([ref("first.ts")]);
  expect(current().attachments.selection).toEqual(selection);
  expect(current().attachments.workItem).toEqual(workItem);
  expect(await current().sending.send(message)).toBe(true);
  rerender();
  expect(current().attachments.codeRefs).toEqual([]);
  expect(current().attachments.selection).toBeUndefined();
  expect(current().attachments.workItem).toBeUndefined();
});
