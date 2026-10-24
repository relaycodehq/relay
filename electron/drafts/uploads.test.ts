import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { uploadName, writeUploadChunk } from "./uploads";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-uploads-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const file = Buffer.from("0123456789");
const put = (id: string, offset: number, end: number, name = "clip.mp4") =>
  writeUploadChunk(
    id,
    name,
    file.length,
    offset,
    file.subarray(offset, end),
    root,
  );

it("names the file only once all of it has arrived", async () => {
  const id = randomUUID();
  expect(await put(id, 0, 4)).toEqual({ received: 4 });
  expect(await readdir(join(root, id))).toEqual(["clip.mp4.part"]);
  const done = await put(id, 4, 10);
  expect(done.received).toBe(10);
  expect(basename(done.path!)).toBe("clip.mp4");
  expect(await readFile(done.path!, "utf8")).toBe("0123456789");
  expect(await readdir(dirname(done.path!))).toEqual(["clip.mp4"]);
});

it("carries on from what it has after a lost answer or a dropped chunk", async () => {
  const id = randomUUID();
  await put(id, 0, 4);
  // The answer to 0..4 was lost and the phone sends it again with more.
  expect(await put(id, 2, 6)).toEqual({ received: 6 });
  // A chunk after one that never arrived changes nothing.
  expect(await put(id, 8, 10)).toEqual({ received: 6 });
  const done = await put(id, 6, 10);
  expect(await readFile(done.path!, "utf8")).toBe("0123456789");
});

it("writes a retry that overlaps its original once", async () => {
  const id = randomUUID();
  await Promise.all([put(id, 0, 6), put(id, 0, 6), put(id, 6, 10)]);
  const done = await put(id, 0, 10);
  expect(await readFile(done.path!, "utf8")).toBe("0123456789");
});

it("answers a finished file again without writing it twice", async () => {
  const id = randomUUID();
  const done = await put(id, 0, 10);
  expect(await put(id, 0, 4)).toEqual(done);
  await expect(
    writeUploadChunk(id, "clip.mp4", 20, 0, file, root),
  ).rejects.toThrow("A different file has this id.");
});

it("keeps names to a plain file name every desktop accepts", () => {
  expect(uploadName("../../etc/passwd")).toBe("passwd");
  expect(uploadName("C:\\Users\\me\\a:b?.mov")).toBe("a_b_.mov");
  expect(uploadName("...")).toBe("attachment");
  expect(uploadName(".hidden")).toBe("hidden");
  const long = uploadName("x".repeat(300) + ".mp4");
  expect(long).toHaveLength(120);
  expect(long.endsWith(".mp4")).toBe(true);
});
