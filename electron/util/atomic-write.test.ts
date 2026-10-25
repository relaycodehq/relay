import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { writeFileAtomic } from "./atomic-write";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-atomic-write-"));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

it("leaves no temporary file behind when the rename fails", async () => {
  // A folder in the file's place makes the rename fail after the data is written.
  const path = join(dir, "state.json");
  await mkdir(path);
  await expect(writeFileAtomic(path, "new")).rejects.toThrow();
  expect(await readdir(dir)).toEqual(["state.json"]);
});

it.skipIf(process.platform === "win32")(
  "keeps the replaced file's mode when asked, owner-only otherwise",
  async () => {
    const kept = join(dir, "auth.json");
    await writeFile(kept, "{}", { mode: 0o640 });
    await writeFileAtomic(kept, '{"a":1}', { keepMode: true });
    expect((await stat(kept)).mode & 0o777).toBe(0o640);
    expect(await readFile(kept, "utf8")).toBe('{"a":1}');

    const fresh = join(dir, "nested", "drafts.json");
    await writeFileAtomic(fresh, "[]", { mkdir: 0o700 });
    expect((await stat(fresh)).mode & 0o777).toBe(0o600);
  },
);
