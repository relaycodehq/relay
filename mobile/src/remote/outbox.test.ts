import { beforeEach, expect, it, vi } from "vitest";
import type { ProjectChatSend } from "../../../shared/projects";

vi.mock("expo-file-system", () => {
  class Node {
    exists = false;
    parentDirectory = { create() {} };
    write() {}
    delete() {}
    list() {
      return [];
    }
    textSync() {
      return "";
    }
  }
  return { Directory: Node, File: Node, Paths: { document: "" } };
});
vi.mock("react", () => ({
  useSyncExternalStore: (_: unknown, get: () => unknown) => get(),
}));

const id = "11111111-1111-4111-8111-111111111111";
const send = { id, body: "Fix the bug" } as ProjectChatSend;
const tick = () => new Promise((r) => setTimeout(r));

let outbox: typeof import("./outbox");
/** What the desktop holds; `hold` keeps the next send on its way until released. */
let onComputer: Set<string>;
let hold: (() => void) | undefined;
const desktop = (async (_method: string, _chat: string, s: ProjectChatSend) => {
  if (hold) await new Promise<void>((r) => (hold = r));
  onComputer.add(s.id);
}) as never;
const call = (async () => ({ hasSend: onComputer.has(id) })) as never;

beforeEach(async () => {
  vi.resetModules();
  outbox = await import("./outbox");
  const { Unanswered } = await import("../../../shared/remote-client");
  onComputer = new Set();
  hold = undefined;
  // Went out as the link dropped: no answer, so "Maybe not sent".
  outbox.deliver((() => Promise.reject(new Unanswered("Connection lost."))) as never, "A", "c", send);
  await tick();
});

it("doesn't resend an unanswered send that Edit is asking about as the link comes back", async () => {
  const [unsent] = outbox.useOutbox("A", "c");
  expect(unsent).toMatchObject({ unsure: true });
  const asking = outbox.reached(call, unsent!);
  outbox.resendFailed(desktop, "A");
  expect(await asking).toBe(false);
  await tick();
  expect(onComputer.has(id)).toBe(false);
});

it("lets a resend already on its way land before telling Edit the computer lacks it", async () => {
  hold = () => {};
  outbox.resendFailed(desktop, "A");
  const [unsent] = outbox.useOutbox("A", "c");
  const asking = outbox.reached(call, unsent!);
  await tick();
  hold!();
  expect(await asking).toBe(true);
});
