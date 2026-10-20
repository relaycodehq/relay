import { GithubCredentials } from "../github/credentials";
import { beforeEach, expect, it, vi } from "vitest";

const login = vi.hoisted(() => ({ token: null as string | null, asked: 0 }));

vi.mock("../platform/executables", () => ({
  findExecutable: async () => "gh",
}));
vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    _args: string[],
    _options: unknown,
    done: (error: Error | null, result?: { stdout: string }) => void,
  ) => {
    login.asked++;
    if (login.token) done(null, { stdout: `${login.token}\n` });
    else done(new Error("not logged in"));
  },
}));

const { GitHub } = await import("./github");

const repo = { owner: "o", name: "r" };

beforeEach(() => {
  login.token = null;
  login.asked = 0;
});

it("asks gh for a token again after a failed lookup, so signing in fixes a private repo without a restart", async () => {
  const seen: (string | null)[] = [];
  const github = new GitHub(async (_url, init) => {
    const auth =
      (init?.headers as Record<string, string> | undefined)?.Authorization ??
      null;
    seen.push(auth);
    return auth
      ? Response.json({ default_branch: "main" })
      : new Response("{}", { status: 404 });
  });

  await expect(github.defaultBranch(repo)).rejects.toThrow(/gh auth login/);

  login.token = "abc";
  await expect(github.defaultBranch(repo)).resolves.toBe("main");
  expect(seen).toEqual([null, "Bearer abc"]);
});

it("doesn't spawn gh again while tokenless requests keep working", async () => {
  const github = new GitHub(async () =>
    Response.json({ default_branch: "main" }),
  );
  await github.defaultBranch(repo);
  await github.defaultBranch(repo);
  expect(login.asked).toBe(1);
});

it("never serves an answer cached under one token to a different token", async () => {
  const ifNoneMatch: (string | undefined)[] = [];
  const credentials = new GithubCredentials();
  const github = new GitHub(async (_url, init) => {
    const headers = init?.headers as Record<string, string>;
    ifNoneMatch.push(headers["If-None-Match"]);
    if (headers["If-None-Match"]) return new Response(null, { status: 304 });
    return Response.json(
      { default_branch: "public" },
      { headers: { etag: '"v1"' } },
    );
  }, credentials);

  // An anonymous read caches the answer under its etag.
  await github.defaultBranch(repo);
  expect(await github.defaultBranch(repo)).toBe("public");

  // After a login the conditional request must not reuse the anonymous etag.
  login.token = "abc";
  credentials.forget();
  ifNoneMatch.length = 0;
  await github.defaultBranch(repo);
  expect(ifNoneMatch).toEqual([undefined]);
});

it("picks up a changed gh login after a 401 without reusing the old cached answer", async () => {
  login.token = "old";
  let refused = false;
  const seen: { auth: string | undefined; etag: string | undefined }[] = [];
  const github = new GitHub(async (_url, init) => {
    const headers = init.headers as Record<string, string>;
    seen.push({ auth: headers.Authorization, etag: headers["If-None-Match"] });
    if (refused) return new Response("{}", { status: 401 });
    return Response.json(
      { default_branch: "main" },
      { headers: { etag: '"v1"' } },
    );
  });
  await github.defaultBranch(repo);
  refused = true;
  await expect(github.defaultBranch(repo)).rejects.toThrow(/gh auth login/);
  login.token = "fresh";
  refused = false;
  await github.defaultBranch(repo);
  expect(seen.at(-1)).toEqual({ auth: "Bearer fresh", etag: undefined });
  expect(login.asked).toBe(2);
});

it("doesn't let a late 401 discard the gh token that CI already renewed", async () => {
  login.token = "old";
  let failed = false;
  let held: Promise<Response> | undefined;
  let finish!: (response: Response) => void;
  const seen: string[] = [];
  const github = new GitHub(async (_url, init) => {
    seen.push((init.headers as Record<string, string>).Authorization);
    if (held) {
      const response = held;
      held = undefined;
      return response;
    }
    if (failed) return new Response("{}", { status: 401 });
    return Response.json({ default_branch: "main" });
  });
  await github.defaultBranch(repo);
  held = new Promise((resolve) => {
    finish = resolve;
  });
  const late = expect(github.defaultBranch(repo)).rejects.toThrow(
    /gh auth login/,
  );
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  failed = true;
  await expect(github.defaultBranch(repo)).rejects.toThrow(/gh auth login/);
  login.token = "fresh";
  failed = false;
  await github.defaultBranch(repo);
  finish(new Response("{}", { status: 401 }));
  await late;
  await github.defaultBranch(repo);
  expect(seen.at(-1)).toBe("Bearer fresh");
  expect(login.asked).toBe(2);
});

it("doesn't cache a late successful answer from the login that was replaced", async () => {
  login.token = "old";
  let failed = false;
  let held: Promise<Response> | undefined;
  let finish!: (response: Response) => void;
  const seen: string[] = [];
  const github = new GitHub(async (_url, init) => {
    const headers = init.headers as Record<string, string>;
    seen.push(headers.Authorization);
    if (held) {
      const response = held;
      held = undefined;
      return response;
    }
    if (failed) return new Response("{}", { status: 401 });
    if (headers["If-None-Match"]) return new Response(null, { status: 304 });
    return Response.json(
      { default_branch: login.token },
      { headers: { etag: '"current"' } },
    );
  });
  await github.defaultBranch(repo);
  held = new Promise((resolve) => {
    finish = resolve;
  });
  const late = github.defaultBranch(repo);
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  failed = true;
  await expect(github.defaultBranch(repo)).rejects.toThrow(/gh auth login/);
  login.token = "fresh";
  failed = false;
  expect(await github.defaultBranch(repo)).toBe("fresh");
  finish(
    Response.json({ default_branch: "old" }, { headers: { etag: '"old"' } }),
  );
  await late;
  expect(await github.defaultBranch(repo)).toBe("fresh");
});
