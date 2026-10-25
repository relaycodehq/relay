import { expect, it, vi } from "vitest";
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
function client(routes: Record<string, (url: URL) => unknown>) {
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
    return Response.json(answer(u));
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

it("fills a page of closed PRs past newer active ones", async () => {
  const at = (n: number) =>
    new Date(Date.UTC(2026, 0, 1) + n * 3600_000).toISOString();
  const pull = (n: number, status: AzPull["status"]) => ({
    ...pr,
    pullRequestId: n,
    status,
    creationDate: at(n),
  });
  // Azure answers one status at a time, newest first.
  const all = [
    ...Array.from({ length: 60 }, (_, i) => pull(90 - i, "active")),
    pull(20, "completed"),
    pull(19, "abandoned"),
    pull(18, "completed"),
  ];
  const { azure } = client({
    "/Shop/_apis/git/repositories/api/pullrequests": (u) => {
      const status = u.searchParams.get("searchCriteria.status");
      const skip = Number(u.searchParams.get("$skip"));
      const top = Number(u.searchParams.get("$top"));
      return {
        value: all
          .filter((p) => status === "all" || p.status === status)
          .slice(skip, skip + top),
      };
    },
  });
  const repo = { server, owner: "Shop", name: "api" };
  const first = await azure.pulls(repo, "closed", 1);
  expect(first.items.map((p) => p.number)).toEqual([20, 19, 18]);
  expect(first.nextPage).toBeNull();
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

/** A client that keeps every request it sends, answered by `answer`. */
function recording(answer: (path: string, method: string) => unknown) {
  const sent: {
    path: string;
    query: URLSearchParams;
    method: string;
    body?: Record<string, any>;
  }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname.replace(
      "/sample-org/Shop/_apis/git/repositories/api",
      "",
    );
    const method = init.method ?? "GET";
    sent.push({
      path,
      query: u.searchParams,
      method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answered = await answer(path, method);
    return answered instanceof Response ? answered : Response.json(answered);
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
  return { azure, sent };
}

it("counts lines through the file diffs preview, which refuses a plain api-version", async () => {
  const { azure, sent } = recording((path) => {
    if (path === "/pullrequests/7/iterations") return { value: [iteration(1)] };
    if (path === "/pullrequests/7/iterations/1/changes")
      return { changeEntries: [file("/a.ts")] };
    if (path === "/filediffs")
      return {
        value: [
          {
            path: "/a.ts",
            lineDiffBlocks: [
              {
                changeType: "add",
                originalLinesCount: 0,
                modifiedLinesCount: 2,
              },
            ],
          },
        ],
      };
    return new Response("missing", { status: 404 });
  });
  const { items } = await azure.files(ref, 1);
  expect(items[0]).toMatchObject({ filename: "a.ts", additions: 2 });
  const diffs = sent.find((s) => s.path === "/filediffs")!;
  expect(diffs.query.get("api-version")).toBe("7.1-preview.1");
  expect(diffs.body).toMatchObject({
    baseVersionCommit: "base",
    targetVersionCommit: "head1",
  });
});

it("anchors a comment on removed lines to the merge base after a second push", async () => {
  const { azure, sent } = recording((path, method) => {
    if (path === "/pullrequests/7") return pr;
    if (path === "/pullrequests/7/iterations")
      return { value: [iteration(1), iteration(2)] };
    if (path === "/pullrequests/7/threads")
      return method === "POST" ? { id: 1 } : { value: [] };
    if (path === "/pullrequests/7/iterations/2/changes")
      return { changeEntries: [{ ...file("/a.ts"), changeTrackingId: 5 }] };
    return new Response("missing", { status: 404 });
  });
  await azure.submit(ref, "head2", "COMMENT", "", [
    {
      id: "d1",
      path: "a.ts",
      line: 12,
      side: "deletions",
      body: "Why remove this?",
      revision: "base:head2",
      createdAt: "2026-10-01T00:00:00Z",
    },
  ]);
  const posted = sent.find(
    (s) => s.path === "/pullrequests/7/threads" && s.method === "POST",
  )!;
  expect(posted.body).toMatchObject({
    threadContext: {
      filePath: "/a.ts",
      leftFileStart: { line: 12, offset: 1 },
      leftFileEnd: { line: 12, offset: 1 },
    },
    pullRequestThreadContext: {
      iterationContext: {
        firstComparingIteration: 2,
        secondComparingIteration: 2,
      },
      changeTrackingId: 5,
    },
  });
});

it("narrows My PRs filters by the typed words", async () => {
  const other = {
    ...pr,
    pullRequestId: 8,
    title: "Search page",
    sourceRefName: "refs/heads/search",
  };
  const { azure, sent } = recording((path) =>
    path.endsWith("/_apis/git/pullrequests")
      ? { value: [pr, other] }
      : new Response("missing", { status: 404 }),
  );
  const created = await azure.search("created", "checkout", "open", 1);
  expect(created.items.map((i) => i.number)).toEqual([7]);
  expect(sent[0].query.get("searchCriteria.creatorId")).toBe("me-id");
});

it("lets one view stop waiting on the PR's threads without failing another", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { azure, sent } = recording(async (path) => {
    if (path === "/pullrequests/7") return pr;
    if (path === "/pullrequests/7/iterations") return { value: [iteration(1)] };
    if (path === "/pullrequests/7/threads") {
      await held;
      return { value: [] };
    }
    return new Response("missing", { status: 404 });
  });
  const triage = new AbortController();
  const reviews = azure.reviews(ref, 1, triage.signal);
  const discussion = azure.discussion(ref, 1);
  await vi.waitFor(() =>
    expect(sent.some((s) => s.path === "/pullrequests/7/threads")).toBe(true),
  );
  triage.abort();
  await expect(reviews).rejects.toThrow(/cancelled/);
  release();
  await expect(discussion).resolves.toMatchObject({ items: [] });
  expect(sent.filter((s) => s.path === "/pullrequests/7/threads")).toHaveLength(
    1,
  );
});

it("shows only a submodule's missing contents as binary, not any 404", async () => {
  const { azure } = recording((path) => {
    if (path === "/pullrequests/7") return pr;
    if (path === "/pullrequests/7/iterations") return { value: [iteration(1)] };
    if (path === "/pullrequests/7/iterations/1/changes")
      return { changeEntries: [file("/lib/vendor")] };
    return new Response("missing", { status: 404 });
  });
  const p = await azure.pull(ref);
  const changed = {
    filename: "lib/vendor",
    status: "modified",
    additions: 0,
    deletions: 0,
    changes: 0,
  };
  await expect(azure.contentsAt(p, changed)).rejects.toThrow(/Not found/);
  await expect(
    azure.contentsAt(p, { ...changed, submodule: true }),
  ).resolves.toMatchObject({ old: { contents: "" }, next: { contents: "" } });
});

it("accepts a raw text success without treating it as a sign-in page", async () => {
  const rejected = vi.fn(() => true);
  const refused = vi.fn();
  const azure = new AzureDevOps(
    { id: server, server, user: { id: 1, login: "me" }, persistent: true },
    "me-id",
    async () => ({ header: "Bearer sample", rejected }),
    async (_url, init) => {
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer sample",
      );
      expect(new Headers(init.headers).get("accept")).toBe(
        "application/octet-stream",
      );
      return new Response("raw source", {
        headers: { "content-type": "text/plain" },
      });
    },
    refused,
  );
  expect((await azure.request(`${server}/file`, { raw: true })).data).toBe(
    "raw source",
  );
  expect(rejected).not.toHaveBeenCalled();
  expect(refused).not.toHaveBeenCalled();
});

it("follows a completion Azure finishes in the background to how it ended", async () => {
  const run = async (answers: Partial<AzPull>[]) => {
    const { azure } = client({ "": () => ({ ...pr, ...answers.shift() }) });
    azure.completionChecks = [0, 0];
    return azure.merge(ref, "head2", "squash");
  };
  await expect(
    run([{ mergeStatus: "queued" }, { mergeStatus: "queued" }, { status: "completed" }]),
  ).resolves.toBeUndefined();
  await expect(
    run([{ mergeStatus: "queued" }, { mergeFailureMessage: "TF401192: blocked" }]),
  ).rejects.toThrow("Azure DevOps couldn't merge it: TF401192: blocked");
  await expect(run([{ mergeStatus: "queued" }])).rejects.toThrow(
    "hasn't completed it yet",
  );
});
