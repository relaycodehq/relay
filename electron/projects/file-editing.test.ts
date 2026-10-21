import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { constants } from "node:fs";
import {
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../app/store";
import { Projects } from "./projects";
import { readLocalFile, saveLocalFile } from "../pull-requests/local-files";
import { gitIn, initRepo } from "../../tests/fixtures/git-repo";

vi.mock("node:fs/promises", async (actual) => {
  const fs = await actual<typeof import("node:fs/promises")>();
  return { ...fs, open: vi.fn(fs.open) };
});
let root: string;
let projects: Projects;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-edit-file-")));
  projects = new Projects(new Store(root));
  await writeFile(join(root, "file.txt"), "opened\n");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(open).mockClear();
  await rm(root, { recursive: true, force: true });
});
const place = () => ({ root, plain: true });

it("checks the disk version twice when saving, without extra existence reads", async () => {
  const file = await projects.file(place(), "file.txt");
  vi.mocked(open).mockClear();
  await projects.save(place(), "file.txt", file.head, file.version, "saved\n");
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("saved\n");
  const reads = vi
    .mocked(open)
    .mock.calls.filter(
      ([path, flags]) =>
        path === join(root, "file.txt") &&
        flags === (constants.O_RDONLY | constants.O_NOFOLLOW),
    );
  expect(reads).toHaveLength(2);
});

it("also checks the disk version twice through the PR editor", async () => {
  const git = (...args: string[]) => gitIn(root, ...args);
  initRepo(root);
  const server = "https://git.example.test";
  const ref = { owner: "team", name: "repo", number: 1 };
  git("remote", "add", "origin", `${server}/team/repo.git`);
  git("add", "file.txt");
  git("commit", "-qm", "initial");
  const head = git("rev-parse", "HEAD");
  const file = await readLocalFile(root, server, ref, head, "file.txt");
  vi.mocked(open).mockClear();
  await saveLocalFile(
    root,
    server,
    ref,
    head,
    "file.txt",
    file.version,
    "saved\n",
  );
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("saved\n");
  expect(
    vi
      .mocked(open)
      .mock.calls.filter(
        ([path, flags]) =>
          path === join(root, "file.txt") &&
          flags === (constants.O_RDONLY | constants.O_NOFOLLOW),
      ),
  ).toHaveLength(2);
});

it.each(["change", "delete"])(
  "preserves a competing %s after writing its temporary file",
  async (operation) => {
    const file = await projects.file(place(), "file.txt");
    const realOpen =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(open).mockImplementationOnce(async (...args) =>
      realOpen.open(...args),
    );
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await realOpen.open(...args);
      expect(args[1]).toBe("wx");
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, "sync").mockImplementation(async () => {
        await sync();
        if (operation === "delete") await unlink(join(root, "file.txt"));
        else await writeFile(join(root, "file.txt"), "other editor\n");
      });
      return handle;
    });
    await expect(
      projects.save(place(), "file.txt", file.head, file.version, "my edits\n"),
    ).rejects.toThrow("This file changed on disk");
    if (operation === "delete")
      await expect(readFile(join(root, "file.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    else
      expect(await readFile(join(root, "file.txt"), "utf8")).toBe(
        "other editor\n",
      );
  },
);
