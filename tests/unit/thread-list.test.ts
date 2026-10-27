import { it, expect, vi, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { Store } from "../../electron/app/store";
import { Projects } from "../../electron/projects/projects";
import { ProjectChats } from "../../electron/project-chats";
import { RemoteBridge } from "../../electron/remote/bridge";
import type { RemoteHost } from "../../electron/remote/remote-host";
import { chatHandlers } from "../../electron/api/chats";
import { reviewHandlers } from "../../electron/api/reviews";
import { apiContext } from "../../electron/api/context";
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
  const server = "https://git.example.com";
  const login = {
    client: { account: { id: 1, server } },
    require: () => login.client,
  };
  // A Gitea PR, keyed by the account as the hosts key it.
  const hosts = { accountKey: () => login.client.account.id };
  const api = apiContext({
    store,
    projects,
    projectChats: chats,
    login,
    hosts,
  } as unknown as Parameters<typeof apiContext>[0]);
  const heard: string[] = [];
  chats.onSummaries((id) => heard.push(id));
  await reviewHandlers(api).saveProgress([
    ref,
    { read: { "src/a.ts": "abc" }, drafts: [], marks: [] },
  ]);
  // Nothing in the thread changed, so the sidebar hears it from the review.
  expect(heard).toEqual([projectId]);

  const desktop = chatHandlers(api).projectChats([projectId]);

  // As main.ts wires the bridge.
  const bridge = new RemoteBridge(
    {
      chats: api.listChats,
      projects: async () => [{ id: projectId, name: "Project" }],
      name: () => "Computer",
    } as unknown as RemoteHost,
    () => {},
  );
  const phone = (await bridge.handle("overview", [])) as {
    chats: { id: string }[];
  };

  expect((desktop as { id: string }[]).map((c) => c.id)).toEqual([thread.id]);
  expect(phone.chats.map((c) => c.id)).toEqual([thread.id]);
});
