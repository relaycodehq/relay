import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MissingProjects } from "../../mobile/src/remote/missing-projects";
import type { RemoteOverview } from "../../shared/remote";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const overview = (...ids: string[]) => ({
  projects: [],
  chats: ids.map((projectId) => ({ projectId, id: projectId, title: "New", scope: "project" as const, created: 1, updated: 1 })),
}) satisfies Pick<RemoteOverview, "projects" | "chats">;

it("batches newly named projects without postponing for ordinary streaming pushes or looping on a removed project", async () => {
  const refresh = vi.fn(async () => {});
  const missing = new MissingProjects(refresh);
  missing.observe(overview("scratch-1"));
  await vi.advanceTimersByTimeAsync(800);
  missing.observe(overview("scratch-1", "scratch-2"));
  await vi.advanceTimersByTimeAsync(800);
  missing.observe(overview("scratch-1", "scratch-2"));
  expect(refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200);
  expect(refresh).toHaveBeenCalledTimes(1);
  missing.observe(overview("scratch-1", "scratch-2"));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("cancels a switched-away connection and checks the same ids on the next one", async () => {
  const old = vi.fn(async () => {});
  const missing = new MissingProjects(old);
  missing.observe(overview("scratch"));
  missing.stop();
  const refresh = vi.fn(async () => {});
  new MissingProjects(refresh).observe(overview("scratch"));
  await vi.advanceTimersByTimeAsync(1_000);
  expect(old).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("can check again after a failed refresh, but does not start a retry loop", async () => {
  const refresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const missing = new MissingProjects(refresh);
  missing.observe(overview("scratch"));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  missing.observe(overview("scratch"));
  await vi.advanceTimersByTimeAsync(1_000);
  expect(refresh).toHaveBeenCalledTimes(2);
});
