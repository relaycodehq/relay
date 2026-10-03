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
  const github = new GitHub(async (_url, init) => {
    const headers = init?.headers as Record<string, string>;
    ifNoneMatch.push(headers["If-None-Match"]);
    if (headers["If-None-Match"]) return new Response(null, { status: 304 });
    return Response.json(
      { default_branch: "public" },
      { headers: { etag: '"v1"' } },
    );
  });

  // An anonymous read caches the answer under its etag.
  await github.defaultBranch(repo);
  expect(await github.defaultBranch(repo)).toBe("public");

  // After a login the conditional request must not reuse the anonymous etag.
  (github as unknown as { token?: Promise<string | null> }).token =
    Promise.resolve("abc");
  ifNoneMatch.length = 0;
  await github.defaultBranch(repo);
  expect(ifNoneMatch).toEqual([undefined]);
});
