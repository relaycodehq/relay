import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  link,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filePreviewCharacters } from "../../shared/project-files";
import { textLimit } from "../git/working-files";
import { git, gitBytes } from "../git/git";
import { Store } from "../app/store";
import { Projects } from "./projects";

vi.mock("../git/git", async (actual) => ({
  ...(await actual()),
  git: vi.fn(() => {
    throw new Error("A file preview must not run Git.");
  }),
  gitBytes: vi.fn(() => {
    throw new Error("A file preview must not read Git blobs.");
  }),
}));

let root: string;
let projects: Projects;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-file-preview-")));
  projects = new Projects(new Store(root));
  vi.clearAllMocks();
});
afterEach(() => rm(root, { recursive: true, force: true }));
const preview = () => projects.filePreview({ root, plain: false }, "file.txt");

it.each(["", "one", "one\n", "one\r\ntwo"])(
  "keeps the editor's line count semantics for %j without Git metadata",
  async (contents) => {
    await writeFile(join(root, "file.txt"), contents);
    expect(await preview()).toEqual({
      contents,
      lines: contents.split("\n").length,
      truncated: false,
    });
    expect(git).not.toHaveBeenCalled();
    expect(gitBytes).not.toHaveBeenCalled();
  },
);

it("returns only the first 60 lines while counting the whole file", async () => {
  const lines = Array.from({ length: 3000 }, (_, i) => `line ${i}`);
  await writeFile(join(root, "file.txt"), lines.join("\n") + "\n");
  expect(await preview()).toEqual({
    contents: lines.slice(0, 60).join("\n"),
    lines: 3001,
    truncated: true,
  });
});

it("bounds a single enormous line without splitting an emoji", async () => {
  const prefix = "a".repeat(filePreviewCharacters - 1);
  await writeFile(join(root, "file.txt"), prefix + "😅" + "later");
  expect(await preview()).toEqual({
    contents: prefix,
    lines: 1,
    truncated: true,
  });
});

it("decodes UTF-8 characters spanning read chunks", async () => {
  const contents = "a".repeat(16 * 1024 - 1) + "😅\nlast";
  await writeFile(join(root, "file.txt"), contents);
  expect(await preview()).toEqual({ contents, lines: 2, truncated: false });
});

it.each([
  [Buffer.from("okay\n".repeat(61) + "\0"), "Binary files"],
  [
    Buffer.concat([Buffer.from("okay\n".repeat(61)), Buffer.from([0xff])]),
    "not valid UTF-8",
  ],
  [Buffer.from([0xe2, 0x82]), "not valid UTF-8"],
  [
    Buffer.from(
      "version https://git-lfs.github.com/spec/v1\noid sha256:fixture\n",
    ),
    "Git LFS",
  ],
  [Buffer.alloc(textLimit + 1, 65), "larger than 2 MiB"],
])(
  "validates unsupported content beyond the excerpt",
  async (bytes, message) => {
    await writeFile(join(root, "file.txt"), bytes);
    await expect(preview()).rejects.toThrow(message);
  },
);

it("rejects missing files, traversal, links and directories", async () => {
  await expect(preview()).rejects.toThrow("no longer exists");
  await expect(
    projects.filePreview({ root, plain: true }, "../outside"),
  ).rejects.toThrow();
  await writeFile(join(root, "real.txt"), "text");
  await symlink(join(root, "real.txt"), join(root, "file.txt"));
  await expect(preview()).rejects.toThrow("Symbolic links");
  await rm(join(root, "file.txt"));
  await link(join(root, "real.txt"), join(root, "file.txt"));
  await expect(preview()).rejects.toThrow("Hard-linked files");
  await expect(
    projects.filePreview({ root, plain: true }, "."),
  ).rejects.toThrow();
});
