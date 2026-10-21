import { afterEach, expect, it, vi } from "vitest";
import {
  createAntigravityUsageReader,
  mapAntigravityUsage,
  type QuotaCredential,
} from "./usage";

const credential = (id: string): QuotaCredential => ({
  fingerprint: id,
  token: {
    client_id: "client",
    client_secret: "secret",
    refresh_token: id,
    project_id: "project",
  },
});
const bucket = (
  bucketId: string,
  window: string,
  remainingFraction: number,
  resetTime = "2026-10-22T12:00:00Z",
) => ({
  bucketId,
  window,
  remainingFraction,
  resetTime,
});
const summary = {
  groups: [
    {
      buckets: [
        bucket("gemini-5h", "5h", 0.7),
        bucket("gemini-weekly", "weekly", 0.4),
      ],
    },
    {
      buckets: [bucket("3p-5h", "5h", 0.9), bucket("3p-weekly", "weekly", 0.6)],
    },
  ],
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const token = (name: string) => json({ access_token: name, expires_in: 3600 });
const urlOf = (url: Parameters<typeof fetch>[0]) => String(url);
afterEach(() => vi.restoreAllMocks());

it("keeps the independent Gemini and Claude/GPT windows, and ignores disabled, malformed and unknown cadences", () => {
  const windows = mapAntigravityUsage(summary);
  expect(windows.map((w) => [w.id, w.kind, Math.round(w.usedPercent)])).toEqual(
    [
      ["gemini-5h", "session", 30],
      ["gemini-weekly", "weekly", 60],
      ["3p-5h", "session", 10],
      ["3p-weekly", "weekly", 40],
    ],
  );
  expect(windows[2]?.label).toBe("Claude & GPT · 5h");
  expect(
    mapAntigravityUsage({
      buckets: [
        { ...bucket("disabled", "5h", 0), disabled: true },
        bucket("unknown", "unknown", 0.3),
        { bucketId: "missing", window: "5h" },
        bucket("bad-date", "weekly", 2, "nonsense"),
      ],
    }),
  ).toEqual([
    expect.objectContaining({ id: "bad-date", usedPercent: 0, resetsAt: null }),
  ]);
});

it("reuses access tokens, rereads the credential source and recovers after a cached token is refused", async () => {
  let saved = credential("first");
  const read = vi.fn(async () => saved);
  const sent: string[] = [];
  let refuse = false;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (urlOf(url).endsWith("/token")) {
      const refresh = new URLSearchParams(String(init!.body)).get(
        "refresh_token",
      );
      return token(refresh === "first" ? "access-first" : "access-second");
    }
    const bearer = (init!.headers as Record<string, string>).Authorization;
    sent.push(bearer);
    if (refuse && bearer === "Bearer access-first") {
      saved = credential("second");
      return json({}, 401);
    }
    return json(summary);
  });
  const service = createAntigravityUsageReader(read, fetcher);
  expect((await service()).windows).toHaveLength(4);
  expect((await service()).windows).toHaveLength(4);
  expect(
    fetcher.mock.calls.filter(([url]) => urlOf(url).endsWith("/token")),
  ).toHaveLength(1);
  refuse = true;
  expect((await service()).windows).toHaveLength(4);
  expect(read).toHaveBeenCalledTimes(4); // each operation, plus the bounded auth retry
  expect(sent.slice(-2)).toEqual([
    "Bearer access-second",
    "Bearer access-second",
  ]);
  expect(
    fetcher.mock.calls.filter(([url]) => urlOf(url).endsWith("/token")),
  ).toHaveLength(2);
});

it.each([403, 429, 500])(
  "does not sign out or refresh cached credentials after HTTP %i",
  async (status) => {
    const read = vi.fn(async () => credential("same"));
    let fail = false;
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      urlOf(url).endsWith("/token")
        ? token("kept")
        : fail
          ? json({}, status)
          : json(summary),
    );
    const service = createAntigravityUsageReader(read, fetcher);
    await service();
    fail = true;
    const failed = await service();
    expect(failed.windows).toEqual([]);
    expect(failed.message).not.toMatch(/sign in/i);
    fail = false;
    await service();
    expect(
      fetcher.mock.calls.filter(([url]) => urlOf(url).endsWith("/token")),
    ).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(3);
  },
);

it("does not let a late refusal discard a newer account's cached token", async () => {
  let saved = credential("old");
  let late = false;
  const pending: ((response: Response) => void)[] = [];
  const read = vi.fn(async () => saved);
  const sent: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (urlOf(url).endsWith("/token"))
      return token(
        new URLSearchParams(String(init!.body)).get("refresh_token")!,
      );
    const bearer = (init!.headers as Record<string, string>).Authorization;
    sent.push(bearer);
    if (late && bearer === "Bearer old")
      return new Promise<Response>((resolve) => pending.push(resolve));
    return json(summary);
  });
  const service = createAntigravityUsageReader(read, fetcher);
  await service();
  late = true;
  const old = service();
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  saved = credential("new");
  expect((await service()).windows).toHaveLength(4);
  for (const finish of pending) finish(json({}, 401));
  expect((await old).windows).toHaveLength(4);
  await service();
  expect(sent.slice(-6)).toEqual(Array(6).fill("Bearer new"));
  expect(
    fetcher.mock.calls.filter(([url]) => urlOf(url).endsWith("/token")),
  ).toHaveLength(2);
});

it("bounds auth retries and picks up a removed or replaced login on the next operation", async () => {
  let saved: QuotaCredential | undefined = credential("old");
  let refuse = true;
  const read = vi.fn(async () => saved);
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    urlOf(url).endsWith("/token")
      ? token("access")
      : refuse
        ? json({}, 401)
        : json(summary),
  );
  const service = createAntigravityUsageReader(read, fetcher);
  expect((await service()).message).toMatch(/sign in.*again/i);
  expect(
    fetcher.mock.calls.filter(([url]) => !urlOf(url).endsWith("/token")),
  ).toHaveLength(4);
  expect(read).toHaveBeenCalledTimes(2);
  saved = undefined;
  expect((await service()).windows).toEqual([]);
  saved = credential("replacement");
  refuse = false;
  expect((await service()).windows).toHaveLength(4);
});

it("keeps the cached access token after a network failure and resumes without another refresh", async () => {
  let offline = false;
  const read = vi.fn(async () => credential("same"));
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (urlOf(url).endsWith("/token")) return token("access");
    if (offline) throw new TypeError("offline");
    return json(summary);
  });
  const service = createAntigravityUsageReader(read, fetcher);
  await service();
  offline = true;
  expect((await service()).message).not.toMatch(/sign in/i);
  offline = false;
  expect((await service()).windows).toHaveLength(4);
  expect(read).toHaveBeenCalledTimes(3);
  expect(
    fetcher.mock.calls.filter(([url]) => urlOf(url).endsWith("/token")),
  ).toHaveLength(1);
});
