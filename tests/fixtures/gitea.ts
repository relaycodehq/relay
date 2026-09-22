import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
export const HEAD = "a".repeat(40),
  BASE = "b".repeat(40);
export const oldCode = `import { useEffect, useState } from 'react';
import type { PullRequest } from './types';

interface ReviewOptions {
  repository: string;
  pullNumber: number;
}

export function useReview({ repository, pullNumber }: ReviewOptions) {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/pulls/' + pullNumber + '/files')
      .then(response => response.json())
      .then(data => setFiles(data));
    setLoading(false);
  }, [pullNumber]);

  const markViewed = (path: string) => {
    console.log('Viewed', path);
  };

  return { files, loading, markViewed };
}
`;
export const newCode = `import { useEffect, useState } from 'react';
import type { PullRequest } from './types';

interface ReviewOptions {
  repository: string;
  pullNumber: number;
}

export function useReview({ repository, pullNumber }: ReviewOptions) {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    fetch('/api/pulls/' + pullNumber + '/files', {
      signal: controller.signal,
    })
      .then(response => response.json())
      .then(data => setFiles(data))
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [repository, pullNumber]);

  const markViewed = (path: string) => {
    setFiles(current => current.filter(file => file !== path));
  };

  return { files, loading, markViewed };
}
`;
export const triageBefore = `import { Component, ChangeDetectorRef } from '@angular/core';
@Component({selector: 'app-card', template: ''})
export class Card {
  constructor(private cd: ChangeDetectorRef) {}
  refresh() { this.cd.markForCheck(); }
}`;
export const triageAfter = triageBefore
  .replace(
    "Component, ChangeDetectorRef",
    "Component, ChangeDetectorRef, inject",
  )
  .replace(
    "constructor(private cd: ChangeDetectorRef) {}",
    "private cd = inject(ChangeDetectorRef);",
  );
export async function fixtureServer(
  options: {
    createPull?: boolean;
    grouping?: boolean;
    contextGaps?: boolean;
    code?: { before: string; after: string };
    users?: Record<string, { id: number; login: string; full_name: string }>;
  } = {},
) {
  let createdPull: any = null;
  const requests: {
    method: string;
    path: string;
    query: Record<string, string>;
    body: unknown;
  }[] = [];
  let head = HEAD,
    baseSha = BASE;
  let pullState = "open",
    merged = false;
  let comments = [
    {
      id: 101,
      body: "Could we check response.ok before decoding? A 403 should surface an actionable error.",
      path: "src/hooks/useReview.ts",
      position: 20,
      original_position: 0,
      commit_id: HEAD,
      user: { id: 2, login: "alex" },
      created_at: new Date().toISOString(),
      html_url: "https://example.test/comment",
      pull_request_review_id: 11,
    },
  ];
  let reviewList = [
    {
      id: 11,
      body: "A couple of thoughts on error handling.",
      state: "COMMENT",
      user: { id: 2, login: "alex" },
      commit_id: HEAD,
      comments_count: 1,
    },
  ];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    let raw = "";
    for await (const data of req) raw += data;
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({
      method: req.method!,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
    });
    const json = (data: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const fixtureUser =
      options.users?.[req.headers.authorization?.replace(/^token /, "") ?? ""];
    if (req.headers.authorization !== "token test-token" && !fixtureUser)
      return json({ message: "unauthorized" }, 401);
    const path = url.pathname.replace("/gitea/api/v1", "");
    const owner = { id: 1, login: "Web" };
    const repo = {
      owner,
      name: "web-store",
      full_name: "Web/web-store",
      clone_url: "https://example.test/Web/web-store.git",
    };
    const pull = {
      id: 7,
      number: 7,
      title: "Make pull request reviews faster and more reliable",
      body: "## A calmer review experience\n\nLoad files on demand, keep review progress, and handle interrupted requests.\n\n- [x] Lazy file loading\n- [x] Cancel stale requests\n- [ ] Verify error handling",
      state: pullState,
      draft: false,
      merged,
      html_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/gitea/Web/web-store/pulls/7`,
      head: { ref: "feat/review-experience", sha: head, repo },
      base: { ref: "main", sha: baseSha, repo },
      merge_base: baseSha,
      user: { id: 3, login: "sam" },
      additions: 156,
      deletions: 43,
      changed_files: options.grouping ? 4 : 72,
      updated_at: new Date().toISOString(),
    };
    const fileNames = options.grouping
      ? ["src/one.ts", "src/two.ts", "src/mixed.ts", "src/other.ts"]
      : [
          "src/hooks/useReview.ts",
          "src/components/ReviewPane.tsx",
          "src/lib/cache.ts",
          "src/styles/review.css",
          "package.json",
          "src/large.ts",
          "assets/logo.png",
          "src/renamed.ts",
          ...Array.from(
            { length: 64 },
            (_, i) => `src/components/file-${i}.tsx`,
          ),
        ];
    const files = fileNames.map((filename, i) => ({
      filename,
      status: i === 7 ? "renamed" : i === 5 ? "added" : "modified",
      ...(i === 7 ? { previous_filename: "src/old.ts" } : {}),
      additions: 12,
      deletions: 4,
      changes: 16,
    }));
    if (path === "/repos/Web/web-store")
      return json({
        id: 7,
        full_name: "Web/web-store",
        permissions: { pull: true },
        default_branch: "main",
        clone_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/gitea/Web/web-store.git`,
        ssh_url: "",
      });
    if (path === "/user")
      return json(
        fixtureUser ?? {
          id: 42,
          login: "reviewer",
          full_name: "Your workspace",
        },
      );
    if (path === "/repos/issues/search") {
      const items = [
        {
          ...pull,
          repository: {
            owner: "Web",
            name: "web-store",
            full_name: "Web/web-store",
          },
          comments: 3,
          labels: [],
        },
        ...Array.from({ length: 5 }, (_, i) => ({
          ...pull,
          id: 20 + i,
          number: 20 + i,
          title: [
            "Improve session expiry handling",
            "Add keyboard navigation to projects",
            "Update deployment configuration",
            "Fix empty states in dashboard",
            "Clean up API response types",
          ][i],
          repository: {
            owner: "Web",
            name: "web-store",
            full_name: "Web/web-store",
          },
          comments: i,
          labels: [],
        })),
      ].filter((p) =>
        p.title
          .toLowerCase()
          .includes((url.searchParams.get("q") ?? "").toLowerCase()),
      );
      res.setHeader("x-total-count", items.length);
      return json(items);
    }
    if (path === "/repos/Web/web-store/branches")
      return json([{ name: "main" }, { name: "feature" }]);
    if (path.startsWith("/repos/Web/web-store/branches/"))
      return json({ commit: { id: path.endsWith("/main") ? baseSha : head } });
    if (
      options.createPull &&
      path === "/repos/Web/web-store/pulls" &&
      req.method === "POST"
    ) {
      createdPull = {
        ...pull,
        number: 8,
        title: body.title,
        body: body.body,
        draft: body.title.startsWith("WIP:"),
        head: { ...pull.head, ref: body.head },
        base: { ...pull.base, ref: body.base },
      };
      return json(createdPull, 201);
    }
    if (options.createPull && path === "/repos/Web/web-store/pulls")
      return json(createdPull ? [createdPull] : []);
    if (path === "/repos/Web/web-store/pulls") {
      const state = url.searchParams.get("state");
      const items =
        !state || state === "all" || state === pullState ? [pull] : [];
      res.setHeader("x-total-count", items.length);
      return json(items);
    }
    if (/^\/repos\/Web\/web-store\/pulls\/\d+$/.test(path))
      return json({
        ...(createdPull ?? pull),
        number: Number(path.split("/").at(-1)),
      });
    if (path.endsWith("/files")) {
      const page = Number(url.searchParams.get("page") ?? 1);
      res.setHeader("x-total-count", files.length);
      return json(files.slice((page - 1) * 50, page * 50));
    }
    if (path.includes("/raw/")) {
      const filename = decodeURIComponent(path.split("/raw/")[1]);
      const base = url.searchParams.get("ref") === baseSha;
      let code = options.code
        ? base
          ? options.code.before
          : options.code.after
        : base
          ? oldCode
          : newCode;
      if (options.contextGaps)
        code =
          Array.from(
            { length: 190 },
            (_, i) =>
              `export const row${i + 1} = ${!base && [9, 89, 159].includes(i) ? "true" : "false"};`,
          ).join("\n") + "\n";
      if (options.grouping) {
        code = base ? triageBefore : triageAfter;
        if (!base && filename === "src/mixed.ts")
          code = triageAfter.replace("markForCheck", "detach");
        if (filename === "src/other.ts")
          code = `export const retries = ${base ? 3 : 5};`;
      }
      if (filename === "src/large.ts")
        code =
          Array.from(
            { length: 15000 },
            (_, i) => `export const value${i} = ${base ? i : i + 1};`,
          ).join("\n") + "\n";
      if (filename === "assets/logo.png") code = "\x00PNG";
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(code);
    }
    if (path.endsWith("/reviews") && req.method === "GET") {
      res.setHeader("x-total-count", reviewList.length);
      return json(reviewList);
    }
    if (path.endsWith("/reviews") && req.method === "POST") {
      const review = {
        id: 99,
        body: body.body,
        state: body.event,
        user: { id: 42, login: "reviewer" },
        commit_id: body.commit_id,
        comments_count: body.comments.length,
      };
      reviewList.push(review);
      for (const c of body.comments)
        comments.push({
          ...comments[0],
          id: 200 + comments.length,
          body: c.body,
          path: c.path,
          position: c.new_position,
          original_position: c.old_position,
          pull_request_review_id: 99,
          user: { id: 42, login: "reviewer" },
        });
      return json(review, 201);
    }
    if (/\/reviews\/\d+\/comments$/.test(path))
      return json(
        comments.filter(
          (c) => c.pull_request_review_id === Number(path.split("/").at(-2)),
        ),
      );
    if (path.endsWith("/replies")) {
      comments.push({
        ...comments[0],
        id: 102,
        body: body.body,
        user: { id: 42, login: "reviewer" },
      });
      return json(comments[1], 201);
    }
    if (path.includes("/issues/") && path.endsWith("/comments"))
      return json([]);
    return json({ message: "unimplemented fixture " + path }, 404);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    server,
    serverUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/gitea`,
    requests,
    setHead: (v: string) => (head = v),
    setBase: (v: string) => (baseSha = v),
    setPullState: (state: "open" | "closed", isMerged = false) => {
      pullState = state;
      merged = isMerged;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
