import { expect, it, vi } from "vitest";
import { CloneRequests, type CloneHost } from "./remote-setup";
import type { Project } from "../../shared/projects";

it("keeps the handoff default destination and honours an explicit setup destination", async () => {
  const host: CloneHost = {
    defaultFolder: vi.fn(async () => "/home/sam/default"),
    clone: vi.fn(
      async (_url, into) =>
        ({ id: "p", name: "Web", path: `${into}/web` }) as Project,
    ),
    repositories: async () => ["acme/web"],
  };
  const requests = new CloneRequests(host);
  await requests.ask("https://github.com/acme/web.git", "laptop");
  expect(host.clone).toHaveBeenLastCalledWith(
    "https://github.com/acme/web.git",
    "/home/sam/default",
    expect.any(Function),
  );
  await requests.ask(
    "https://github.com/acme/web.git",
    "laptop",
    "/srv/projects",
  );
  expect(host.clone).toHaveBeenLastCalledWith(
    "https://github.com/acme/web.git",
    "/srv/projects",
    expect.any(Function),
  );
  expect(host.defaultFolder).toHaveBeenCalledTimes(1);
});

it("polls one clone for the same destination without merging different destinations", async () => {
  const releases: (() => void)[] = [];
  const clone = vi.fn(async (_url: string, into: string) => {
    await new Promise<void>((resolve) => releases.push(resolve));
    return { id: into, name: "Web", path: `${into}/web` } as Project;
  });
  const requests = new CloneRequests({
    defaultFolder: async () => "~",
    clone,
    repositories: async () => [],
  });
  const a = requests.ask("acme/web", "laptop", "/one");
  const again = requests.ask("acme/web", "laptop", "/one");
  const b = requests.ask("acme/web", "laptop", "/two");
  await Promise.resolve();
  expect(clone).toHaveBeenCalledTimes(2);
  releases.forEach((resolve) => resolve());
  const results = await Promise.all([a, again, b]);
  expect(results.map((r) => r.done && r.project.folder)).toEqual([
    "/one/web",
    "/one/web",
    "/two/web",
  ]);
});

it("accepts immediate progress from a clone with an explicit destination", async () => {
  const host: CloneHost = {
    defaultFolder: async () => "~",
    clone: async (_url, into, progress) => {
      progress({ title: "Cloning", step: "Starting", progress: null });
      return { id: "p", name: "Web", path: `${into}/web` } as Project;
    },
    repositories: async () => [],
  };
  expect(
    await new CloneRequests(host).ask("acme/web", "Laptop", "/work"),
  ).toMatchObject({ done: true, project: { folder: "/work/web" } });
});
