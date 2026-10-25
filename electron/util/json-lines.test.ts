import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JsonLines } from "./json-lines";
const failures = vi.hoisted(() => ({ cutNextAppend: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    appendFile: async (...args: Parameters<typeof actual.appendFile>) => {
      if (failures.cutNextAppend) {
        failures.cutNextAppend = false;
        await actual.appendFile(args[0], String(args[1]).slice(0, 5), args[2]);
        throw new Error("disk full after a partial append");
      }
      return actual.appendFile(...args);
    },
  };
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-json-lines-"));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

it.each(['{"id":2', '{"id":2}'])(
  "preserves a valid or torn final record and serializes concurrent appends: %s",
  async (last) => {
    const path = join(dir, "log");
    await writeFile(path, `{"id":1}\n${last}`);
    const log = new JsonLines<{ id: number }>(path);
    await Promise.all([log.append({ id: 3 }), log.append({ id: 4 })]);
    expect(await new JsonLines(path).read()).toEqual([
      { id: 1 },
      ...(last.endsWith("}") ? [{ id: 2 }] : []),
      { id: 3 },
      { id: 4 },
    ]);
  },
);

it("reloads the boundary after failure so a retry remains durable", async () => {
  const path = join(dir, "log");
  await writeFile(path, '{"id":1}');
  const log = new JsonLines<{ id: number }>(path);
  await log.read();
  await rm(path);
  await mkdir(path);
  await expect(log.append({ id: 2 })).rejects.toThrow();
  await rm(path, { recursive: true });
  await writeFile(path, '{"id":1}\n{"id":');
  await log.append({ id: 2 });
  expect(await new JsonLines(path).read()).toEqual([{ id: 1 }, { id: 2 }]);
});

it("serializes retention before appending and preserves file on failed rewrite", async () => {
  const path = join(dir, "log");
  const log = new JsonLines<{ id: number }>(path);
  await log.append({ id: 1 });
  await log.append({ id: 2 });
  await Promise.all([log.retain((e) => e.id > 1), log.append({ id: 3 })]);
  expect(await new JsonLines(path).read()).toEqual([{ id: 2 }, { id: 3 }]);
  const saved = await readFile(path, "utf8");
  await rm(path);
  await mkdir(path);
  await expect(log.retain((e) => e.id > 2)).rejects.toThrow();
  expect(await log.read()).toEqual([{ id: 2 }, { id: 3 }]);
  await rm(path, { recursive: true });
  await writeFile(path, saved);
  await log.retain((e) => e.id > 2);
  expect(await new JsonLines(path).read()).toEqual([{ id: 3 }]);
});

it("repairs a prefix written by a failed append before retrying", async () => {
  const path = join(dir, "partial");
  const log = new JsonLines<{ id: number }>(path);
  await log.append({ id: 1 });
  failures.cutNextAppend = true;
  await expect(log.append({ id: 2 })).rejects.toThrow("disk full");
  await log.append({ id: 2 });
  expect(await new JsonLines(path).read()).toEqual([{ id: 1 }, { id: 2 }]);
});
