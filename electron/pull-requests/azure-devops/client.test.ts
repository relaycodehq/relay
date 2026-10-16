import { expect, it } from "vitest";
import { AzureDevOps } from "./client";
import type { AzChange, AzPull } from "./shapes";

const server = "https://dev.azure.com/sample-org";
const ref = { server, owner: "Shop", name: "api", number: 7 };
const repository = {
  id: "repo-id",
  name: "api",
  project: { id: "project-id", name: "Shop" },
};
const pr: AzPull = {
  pullRequestId: 7,
  status: "active",
  title: "Checkout",
  createdBy: { id: "anna-id", displayName: "Anna", uniqueName: "anna@x.dev" },
  creationDate: "2026-10-01T00:00:00Z",
  sourceRefName: "refs/heads/checkout",
  targetRefName: "refs/heads/main",
  repository,
};
const iteration = (id: number) => ({
  id,
  sourceRefCommit: { commitId: `head${id}` },
  targetRefCommit: { commitId: "base" },
  commonRefCommit: { commitId: "base" },
});
const file = (path: string): AzChange => ({
  changeType: "edit",
  item: { path },
});
const folder: AzChange = {
  changeType: "add",
  item: { path: "/src", isFolder: true },
};

/** A client whose host answers from `routes`, counting each request by path. */
function client(routes: Record<string, () => unknown>) {
  const asked: string[] = [];
  const fetch = async (url: string) => {
    const u = new URL(url);
    const path = u.pathname
      .replace("/sample-org", "")
      .replace("/Shop/_apis/git/repositories/api/pullrequests/7", "");
    const skip = u.searchParams.get("$skip");
    const key = path.includes("/changes") ? `${path}@${skip}` : path;
    asked.push(key);
    const answer = routes[key];
    if (!answer) return new Response("missing " + key, { status: 404 });
    return Response.json(answer());
  };
  const azure = new AzureDevOps(
    {
      id: server,
      server,
      user: { id: 1, login: "me@x.dev" },
      persistent: true,
    },
    "me-id",
    async () => ({ header: "Bearer t", rejected: () => true }),
    fetch,
    () => {},
  );
  return { azure, asked };
}

it("counts a PR's changed files like its file list, across pages, once per push", async () => {
  let latest = 2;
  const { azure, asked } = client({
    "": () => pr,
    "/iterations": () => ({
      value: Array.from({ length: latest }, (_, i) => iteration(i + 1)),
    }),
    "/iterations/2/changes@0": () => ({
      changeEntries: [file("/a.ts"), folder, file("/b.ts")],
      nextSkip: 3,
    }),
    "/iterations/2/changes@3": () => ({ changeEntries: [file("/c.ts")] }),
    "/iterations/3/changes@0": () => ({ changeEntries: [file("/a.ts")] }),
  });
  // The review and triage hold the file list to this count.
  expect((await azure.pull(ref)).changed_files).toBe(3);
  expect((await azure.pull(ref)).changed_files).toBe(3);
  expect(asked.filter((a) => a.includes("/changes"))).toEqual([
    "/iterations/2/changes@0",
    "/iterations/2/changes@3",
  ]);
  latest = 3;
  const pushed = await azure.pull(ref);
  expect(pushed.head.sha).toBe("head3");
  expect(pushed.changed_files).toBe(1);
  // Deep review fetches the commit itself; a fork's branch isn't upstream.
  expect(azure.headRef(pushed)).toBe("head3");
});

it("lists a repository's PRs without making up how much they change", async () => {
  const { azure } = client({
    "/Shop/_apis/git/repositories/api/pullrequests": () => ({ value: [pr] }),
  });
  const listed = await azure.pulls(
    { server, owner: "Shop", name: "api" },
    "open",
    1,
  );
  expect(listed.items[0]).toMatchObject({ number: 7, title: "Checkout" });
  expect(listed.items[0]).not.toHaveProperty("changed_files");
  expect(listed.items[0]).not.toHaveProperty("additions");
});

it("posts a comment again in a new review, but not twice in a retried one", async () => {
  const said = (id: number, content: string) => ({
    id,
    publishedDate: "2026-10-01T00:00:00Z",
    comments: [{ id: 1, content, author: { id: "me-id" } }],
  });
  const threads = [said(1, "LGTM")];
  const posted: string[] = [];
  let votes = 0;
  const fetch = async (url: string, options: RequestInit) => {
    const path = new URL(url).pathname.replace(
      "/sample-org/Shop/_apis/git/repositories/api/pullrequests/7",
      "",
    );
    if (path === "") return Response.json(pr);
    if (path === "/iterations") return Response.json({ value: [iteration(1)] });
    if (path === "/threads" && options.method === "POST") {
      const content = JSON.parse(String(options.body)).comments[0].content;
      posted.push(content);
      threads.push(said(threads.length + 1, content));
      return Response.json(threads.at(-1));
    }
    if (path === "/threads") return Response.json({ value: threads });
    if (path.startsWith("/reviewers/") && ++votes === 1)
      return new Response("down", { status: 503 });
    if (path.startsWith("/reviewers/")) return Response.json({});
    return new Response("missing " + path, { status: 404 });
  };
  const azure = new AzureDevOps(
    {
      id: server,
      server,
      user: { id: 1, login: "me@x.dev" },
      persistent: true,
    },
    "me-id",
    async () => ({ header: "Bearer t", rejected: () => true }),
    fetch,
    () => {},
  );
  // An older review already said it; this one still says it once.
  await expect(
    azure.submit(ref, "head1", "APPROVED", "LGTM", []),
  ).rejects.toThrow();
  expect(posted).toEqual(["LGTM"]);
  await azure.submit(ref, "head1", "APPROVED", "LGTM", []);
  expect(posted).toEqual(["LGTM"]);
  expect(votes).toBe(2);
});
