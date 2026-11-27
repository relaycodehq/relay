import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  root,
  projects,
  chats,
  projectId,
  useProjectChats,
} from "../../tests/fixtures/project-chats-harness";

vi.mock("../platform/executables");

useProjectChats();

it("makes one thread for a phone that asks twice with the same id at once", async () => {
  const id = randomUUID();
  const [first, second] = await Promise.all([
    chats.create(projectId, { kind: "project" }, "checkout", { id }),
    chats.create(projectId, { kind: "project" }, "checkout", { id }),
  ]);
  expect(first.id).toBe(id);
  expect(second.id).toBe(id);
  expect((await chats.list(projectId)).map((c) => c.id)).toEqual([id]);
});

it("answers a retry after the thread is made with that same thread", async () => {
  const id = randomUUID();
  await chats.create(projectId, { kind: "project" }, "checkout", { id });
  const again = await chats.create(projectId, { kind: "project" }, "checkout", {
    id,
  });
  expect(again.id).toBe(id);
  expect(await chats.list(projectId)).toHaveLength(1);
});

it("refuses an id another project's thread already has", async () => {
  const id = randomUUID();
  await chats.create(projectId, { kind: "project" }, "checkout", { id });
  const other = join(root, "other");
  await mkdir(other);
  execFileSync("git", ["init", "--quiet", other]);
  const otherId = (await projects.add(other, null)).id;
  await expect(
    chats.create(otherId, { kind: "project" }, "checkout", { id }),
  ).rejects.toThrow("Another thread already goes by this id.");
});
