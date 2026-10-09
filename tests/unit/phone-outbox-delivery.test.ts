import { beforeEach, expect, it, vi } from "vitest";
import type { RemoteClient } from "../../shared/remote-client";
import type { ProjectChatSend } from "../../shared/projects";

// Load the native module at runtime so its Expo declarations stay out of the desktop test project.
const outboxPath = "../../mobile/src/remote/outbox";

const disk = vi.hoisted(() => new Map<string, string>());
const react = vi.hoisted(() => ({
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
    snapshot(),
}));
const filesystem = vi.hoisted(() => {
  class Directory {
    uri: string;
    constructor(parent: string | Directory, name: string) {
      this.uri = `${typeof parent === "string" ? parent : parent.uri}/${name}`;
    }
    get exists() {
      return disk.size > 0;
    }
    create() {}
    list() {
      return [...disk.keys()]
        .filter((key) => key.startsWith(`${this.uri}/`))
        .map((key) => new File(this, key.slice(this.uri.length + 1)));
    }
  }
  class File {
    uri: string;
    constructor(
      public parentDirectory: Directory,
      name: string,
    ) {
      this.uri = `${parentDirectory.uri}/${name}`;
    }
    get exists() {
      return disk.has(this.uri);
    }
    write(value: string) {
      disk.set(this.uri, value);
    }
    delete() {
      disk.delete(this.uri);
    }
    textSync() {
      return disk.get(this.uri)!;
    }
  }
  return { Directory, File, Paths: { document: "documents" } };
});
// Also mock the local packages when Expo is installed; CI runs these without mobile deps.
vi.mock("react", () => react);
vi.mock("../../mobile/node_modules/react", () => react);
vi.mock("expo-file-system", () => filesystem);
vi.mock("../../mobile/node_modules/expo-file-system", () => filesystem);

const send = (extra: Partial<ProjectChatSend> = {}): ProjectChatSend => ({
  id: "00000000-0000-4000-8000-000000000001",
  body: "@codex hi",
  provider: "codex",
  choice: { model: "fixture", fast: false, reasoningEffort: "high" },
  runtimeMode: "full-access",
  interactionMode: "default",
  ...extra,
});
const desktop = (job: (...args: unknown[]) => Promise<unknown>) =>
  vi.fn(job) as unknown as RemoteClient["desktop"];
const gate = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  disk.clear();
  vi.resetModules();
});

it.each([
  {},
  { delivery: "queue" },
  { delivery: "steer" },
  { sendAt: Date.now() + 60000 },
] as Partial<ProjectChatSend>[])(
  "keeps a send's id and delivery settings on disk and across retry: %j",
  async (extra) => {
    const outbox = await import(outboxPath);
    const { Unanswered } = await import("../../shared/remote-client");
    const first = gate();
    const call = desktop(async () => first.promise);
    const message = send(extra);
    outbox.deliver(call, "mac", "thread", message);
    expect(JSON.parse([...disk.values()][0]).send).toEqual(message);
    first.reject(new Unanswered("Link lost"));
    await first.promise.catch(() => {});
    await Promise.resolve();
    expect(outbox.useOutbox("mac", "thread")[0]).toMatchObject({
      unsure: true,
      error: "Link lost",
    });
    const retry = gate();
    const again = desktop(async () => retry.promise);
    outbox.resendFailed(again, "mini");
    expect(again).not.toHaveBeenCalled();
    outbox.resendFailed(again, "mac");
    expect(again).toHaveBeenCalledWith("sendProjectChat", "thread", message);
    retry.resolve();
    await retry.promise;
    await Promise.resolve();
    await vi.waitFor(() => expect(disk.size).toBe(0));
    outbox.arrived("mac", "thread", new Set([message.id]), 100);
    expect(outbox.useOutbox("mac", "thread")).toEqual([]);
  },
);

it("keeps an interrupted send across relaunch and never offers it on another computer", async () => {
  const first = await import(outboxPath);
  first.deliver(
    desktop(async () => new Promise(() => {})),
    "mac",
    "thread",
    send(),
  );
  vi.resetModules();
  const reopened = await import(outboxPath);
  expect(reopened.useOutbox("mac", "thread")[0]).toMatchObject({
    send: send(),
    unsure: true,
  });
  expect(reopened.useOutbox("mini", "thread")).toEqual([]);
  reopened.arrived(
    "mini",
    "thread",
    new Set(["00000000-0000-4000-8000-000000000001"]),
    100,
  );
  expect(disk.size).toBe(1);
  expect(reopened.useOutbox("mac", "thread")).toHaveLength(1);
});

it("classifies a real rejection as not sent and checks Edit through the desktop receipt", async () => {
  const outbox = await import(outboxPath);
  outbox.deliver(
    desktop(async () => {
      throw new Error("Queue full");
    }),
    "mac",
    "thread",
    send(),
  );
  await Promise.resolve();
  const item = outbox.useOutbox("mac", "thread")[0];
  expect(item.unsure).toBe(false);
  expect(outbox.outgoingMessage(item).error).toBe("Not sent: Queue full");
  const call = vi.fn(async () => ({
    messages: [],
    hasSend: true,
  })) as unknown as RemoteClient["call"];
  expect(await outbox.reached(call, item)).toBe(true);
  expect(outbox.useOutbox("mac", "thread")).toEqual([]);
  expect(call).toHaveBeenCalledWith(
    "chat",
    "thread",
    undefined,
    100,
    "00000000-0000-4000-8000-000000000001",
  );
  const older = vi.fn(async () => ({
    messages: [],
  })) as unknown as RemoteClient["call"];
  await expect(outbox.reached(older, item)).rejects.toThrow("Update Relay");
});

it("keeps an unanswered first attempt uncertain even when its retry is refused", async () => {
  const outbox = await import(outboxPath);
  const { Unanswered } = await import("../../shared/remote-client");
  outbox.deliver(
    desktop(async () => {
      throw new Unanswered("No answer");
    }),
    "mac",
    "thread",
    send(),
  );
  await Promise.resolve();
  outbox.retry(
    desktop(async () => {
      throw new Error("Not connected");
    }),
    send().id,
  );
  await Promise.resolve();
  const item = outbox.useOutbox("mac", "thread")[0];
  expect(outbox.outgoingMessage(item).error).toBe(
    "Maybe not sent: Not connected",
  );
  const call = vi.fn(async () => ({
    messages: [],
    hasSend: true,
    sendPending: true,
  })) as unknown as RemoteClient["call"];
  expect(await outbox.reached(call, item)).toBe(true);
  expect(outbox.useOutbox("mac", "thread")).toHaveLength(1);
});
