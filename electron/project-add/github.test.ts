import { expect, it, vi } from "vitest";
import { createGithubRepo } from "./github";
import { runExecutable } from "../platform/executables";
vi.mock("../platform/executables", () => ({
  findExecutable: vi.fn(),
  runExecutable: vi.fn(async () => ({ code: 0 })),
}));
it("passes a repository name as a positional argument and forwards cancellation", async () => {
  const signal = new AbortController().signal;
  await createGithubRepo("gh", "/sample/web", "--public", "private", signal);
  expect(runExecutable).toHaveBeenCalledWith(
    "gh",
    [
      "repo",
      "create",
      "--private",
      "--source",
      "/sample/web",
      "--remote",
      "origin",
      "--push",
      "--",
      "--public",
    ],
    120000,
    signal,
  );
});
