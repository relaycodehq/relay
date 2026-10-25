import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  appendFile,
  mkdtemp,
  open,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../util/hash";
import { readWorkingFile, textLimit, tooLarge } from "./working-files";

vi.mock("node:fs/promises", async (actual) => {
  const fs = await actual<typeof import("node:fs/promises")>();
  return { ...fs, open: vi.fn(fs.open) };
});

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-working-file-")));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(open).mockClear();
  await rm(root, { recursive: true, force: true });
});

it.each(["", "ten bytes!", "héllo\n"])(
  "sizes reads to the small file %j",
  async (contents) => {
    await writeFile(join(root, "file.txt"), contents);
    const allocate = vi.spyOn(Buffer, "alloc");
    expect(await readWorkingFile(root, "file.txt")).toMatchObject({
      contents,
      hash: digest(contents),
    });
    expect(allocate.mock.calls.map(([size]) => size)).toEqual([
      Buffer.byteLength(contents) + 1,
    ]);
  },
);

it.each([64 * 1024, textLimit, textLimit + 1])(
  "reads growth after fstat up to the text limit (%i bytes)",
  async (length) => {
    await writeFile(join(root, "file.txt"), "");
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      const stat = handle.stat.bind(handle);
      vi.spyOn(handle, "stat").mockImplementationOnce(async () => {
        const result = await stat();
        // Append to the same inode only after obtaining its original size.
        await appendFile(join(root, "file.txt"), "a".repeat(length));
        return result;
      });
      return handle;
    });
    if (length > textLimit)
      await expect(readWorkingFile(root, "file.txt")).rejects.toThrow(tooLarge);
    else {
      const contents = "a".repeat(length);
      expect(await readWorkingFile(root, "file.txt")).toMatchObject({
        contents,
        hash: digest(contents),
      });
    }
  },
);
