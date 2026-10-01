import { it, expect, vi, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { Store } from "../../electron/store";
import { Projects } from "../../electron/projects";
import { ProjectChats } from "../../electron/project-chats";
import { RemoteBridge, type RemoteHost } from "../../electron/remote/bridge";
import { chatHandlers } from "../../electron/api/chats";
import { apiContext } from "../../electron/api/context";
import type { RemoteEvent } from "../../shared/remote";
vi.mock("electron", () => ({ shell: {} }));
let root: string, chats: ProjectChats;
afterEach(async () => {
  await chats?.dispose();
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
});
it("lists a PR thread whose review is under way on the phone as on the desktop", async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-repro-")));
  const repo = join(root, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "--quiet", repo]);
  const store = new Store(join(root, "state"));
  await store.load();
  const projects = new Projects(store);
  const projectId = (await projects.add(repo, null)).id;
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  const ref = { owner: "me", name: "app", number: 7 };
  // A PR thread nobody has written in, but whose review is under way.
  const thread = await chats.create(projectId, { kind: "pr", ref });
  const login = { client: { account: { id: 1 } }, require: () => login.client };
  const api = apiContext({
    store,
    projects,
    projectChats: chats,
    login,
  } as unknown as Parameters<typeof apiContext>[0]);
  await store.update((s) => {
    s.progress[api.prKey(ref)] = {
      read: { "src/a.ts": "abc" },
      drafts: [],
      marks: [],
    };
  });

  const desktop = chatHandlers(api).projectChats([projectId]);

  // As main.ts wires the bridge.
  const events: RemoteEvent[] = [];
  const bridge = new RemoteBridge(
    { chats: api.listChats } as unknown as RemoteHost,
    (e) => events.push(e),
  );
  (bridge as unknown as { projectIds: string[] }).projectIds = [projectId];
  bridge.refresh();
  const phone = events.find((e) => e.kind === "chats");

  expect((desktop as { id: string }[]).map((c) => c.id)).toEqual([thread.id]);
  expect(phone && "chats" in phone ? phone.chats.map((c) => c.id) : []).toEqual(
    [thread.id],
  );
});
