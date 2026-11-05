import { expect, it } from "vitest";
import { Gitea } from "../pull-requests/gitea";
import { readGitea } from "./gitea";

const account = {
  id: "https://git.example.com#7",
  server: "https://git.example.com",
  user: { id: 7, login: "vilem" },
  persistent: true,
};

/** 40 job statuses, newest first as Gitea orders them; the oldest one failed. */
const statuses = Array.from({ length: 40 }, (_, i) => ({
  context: `Checks / job${40 - i} (push)`,
  state: i === 39 ? "failure" : "success",
  target_url: `u/${40 - i}`,
  updated_at: "2026-11-05T10:00:00Z",
}));

/** Gitea's combined status: `limit` capped at 50, 30 when not asked. */
function fetch(url: string) {
  const { pathname, searchParams } = new URL(url);
  if (pathname.endsWith("/branches/main"))
    return Response.json({ commit: { id: "c".repeat(40), message: "m" } });
  const limit = Math.min(Number(searchParams.get("limit")) || 30, 50);
  const page = Math.max(Number(searchParams.get("page")) || 1, 1);
  return Response.json(
    { statuses: statuses.slice((page - 1) * limit, page * limit) },
    { headers: { "X-Total-Count": String(statuses.length) } },
  );
}

it("reads every page of a commit's statuses, so an early failure still counts", async () => {
  const gitea = new Gitea(account, "token", async (url) => fetch(url));
  const reading = await readGitea(
    gitea,
    { owner: "team", name: "app" },
    "main",
  );
  expect(reading?.runs).toEqual([
    expect.objectContaining({
      workflow: "Checks",
      state: "failure",
      failedJob: "job1",
    }),
  ]);
});
