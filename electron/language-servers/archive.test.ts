import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync, Zip, ZipDeflate } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unzipTo, zipEntryPath } from "./archive";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-lsp-archive-"));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

describe("unzipTo", () => {
  it("unpacks a zip written with data descriptors, as a streaming zipper does", async () => {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((err, chunk) => {
      if (err) throw err;
      chunks.push(chunk);
    });
    for (const [name, text] of [
      ["top/a.txt", "a".repeat(100_000)],
      ["top/sub/b.txt", "bee"],
    ]) {
      const entry = new ZipDeflate(name);
      zip.add(entry);
      entry.push(strToU8(text), true);
    }
    zip.end();
    const archive = join(dir, "x.zip");
    await writeFile(archive, Buffer.concat(chunks));
    await unzipTo(archive, dir, 1);
    expect((await readFile(join(dir, "a.txt"), "utf8")).length).toBe(100_000);
    expect(await readFile(join(dir, "sub", "b.txt"), "utf8")).toBe("bee");
  });

  it("refuses an entry that climbs out of the folder", async () => {
    const archive = join(dir, "evil.zip");
    await writeFile(archive, zipSync({ "../evil.txt": strToU8("x") }));
    await mkdir(join(dir, "out"));
    await expect(unzipTo(archive, join(dir, "out"))).rejects.toThrow(/unsafe/);
    await expect(stat(join(dir, "evil.txt"))).rejects.toThrow();
  });
});

describe("zipEntryPath", () => {
  it("rejects unsafe entry names and strips leading folders", () => {
    expect(zipEntryPath("a/b/c.txt", 1)).toBe("b/c.txt");
    expect(zipEntryPath("a/", 1)).toBeUndefined();
    expect(zipEntryPath("./a.txt", 0)).toBe("a.txt");
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a\\b"])
      expect(() => zipEntryPath(bad, 0)).toThrow(/unsafe/);
  });
});
