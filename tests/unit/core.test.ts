import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Gitea } from "../../electron/gitea";
import { Store } from "../../electron/store";
import {
  normalizeServer,
  parsePullUrl,
  shellQuote,
  filePathSchema,
} from "../../shared/validation";
import { fixtureServer, HEAD, BASE } from "../fixtures/gitea";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((f) => f()));
});
const ref = { owner: "Web", name: "web-store", number: 7 };
describe("URL and command boundaries", () => {
  it("preserves Gitea subpaths and handles file-tab links and deep links", () => {
    const root = "https://git.example.com/gitea";
    expect(normalizeServer(root + "/")).toBe(root);
    expect(
      parsePullUrl(root + "/Web/web-store/pulls/7/files", root),
    ).toEqual(ref);
    expect(
      parsePullUrl(
        "reviewrelay://open?url=" +
          encodeURIComponent(root + "/Web/web-store/pulls/7"),
        root,
      ),
    ).toEqual(ref);
  });
  it("rejects cross-origin and path-prefix confusion", () => {
    for (const url of [
      "https://evil.test/gitea/Web/web-store/pulls/7",
      "https://git.example.com/gitea-other/Web/web-store/pulls/7",
      "https://git.example.com/gitea/%2E%2E/web-store/pulls/7",
    ])
      expect(() =>
        parsePullUrl(url, "https://git.example.com/gitea"),
      ).toThrow();
    expect(() => normalizeServer("http://private.test")).toThrow();
    expect(() => normalizeServer("https://user:secret@example.com")).toThrow();
    expect(filePathSchema.safeParse("../secret").success).toBe(false);
  });
  it("quotes shell metacharacters, apostrophes, and newlines literally", () => {
    const value = "some ' text $(printf hacked) `whoami`\nnext";
    expect(
      execFileSync("/bin/sh", ["-c", `printf %s ${shellQuote(value)}`], {
        encoding: "utf8",
      }),
    ).toBe(value);
  });
});
describe("Gitea integration", () => {
  it("authenticates, pages metadata and fetches only the selected file", async () => {
    const fixture = await fixtureServer();
    cleanup.push(fixture.close);
    const client = await Gitea.connect(fixture.serverUrl, "test-token", fetch);
    const page = await client.page("/repos/Web/web-store/pulls/7/files", 1);
    expect(page.items).toHaveLength(50);
    expect(page.nextPage).toBe(2);
    expect(
      (await client.page("/repos/Web/web-store/pulls/7/files", 2)).items,
    ).toHaveLength(22);
    const file = (page.items as any[])[0];
    const pair = await client.contents(ref, file, HEAD, BASE);
    expect(pair.next?.contents).toContain("AbortController");
    expect(
      fixture.requests.filter((r) => r.path.includes("/raw/")),
    ).toHaveLength(2);
    expect(
      fixture.requests.every((r) => !JSON.stringify(r).includes("test-token")),
    ).toBe(true);
  });
  it("maps old/new line positions and rejects stale submissions", async () => {
    const fixture = await fixtureServer();
    cleanup.push(fixture.close);
    const client = await Gitea.connect(fixture.serverUrl, "test-token", fetch);
    const drafts = [
      {
        id: "d",
        path: "a.ts",
        line: 4,
        side: "deletions" as const,
        body: "fix this",
        revision: `${BASE}:${HEAD}`,
        createdAt: new Date().toISOString(),
      },
    ];
    await client.submit(ref, HEAD, "COMMENT", "Summary", drafts);
    const post = fixture.requests.find((r) => r.method === "POST")!;
    expect((post.body as any).comments[0]).toEqual({
      body: "fix this",
      path: "a.ts",
      old_position: 4,
      new_position: 0,
    });
    fixture.setHead("c".repeat(40));
    await expect(client.submit(ref, HEAD, "APPROVED", "", [])).rejects.toThrow(
      "new commit",
    );
    expect(fixture.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });
  it("reports authentication failure without exposing tokens", async () => {
    const fixture = await fixtureServer();
    cleanup.push(fixture.close);
    await expect(
      Gitea.connect(fixture.serverUrl, "secret-invalid", fetch),
    ).rejects.toThrow("invalid or expired");
  });
});
describe("Network failures", () => {
  it.each([
    ["net::ERR_CERT_AUTHORITY_INVALID", "certificate"],
    ["net::ERR_NAME_NOT_RESOLVED", "VPN"],
    ["net::ERR_CONNECTION_REFUSED", "refused"],
    ["net::ERR_PROXY_CONNECTION_FAILED", "proxy"],
  ])("explains %s without echoing credentials", async (failure, expected) => {
    const client = Gitea.connect(
      "https://git.example.com",
      "private-token",
      async () => {
        throw new Error(failure + " private-token");
      },
    );
    await expect(client).rejects.toThrow(expected);
    await expect(client).rejects.not.toThrow("private-token");
  });
});
describe("Durable local state", () => {
  it("serializes concurrent updates and survives restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-store-"));
    const store = new Store(dir);
    await store.load();
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        store.update((s) => {
          s.folders[String(i)] = `folder${i}`;
        }),
      ),
    );
    const reloaded = new Store(dir);
    await reloaded.load();
    expect(Object.keys(reloaded.get().folders)).toHaveLength(30);
    expect(
      JSON.parse(await readFile(join(dir, "state.json"), "utf8")).version,
    ).toBe(1);
  });
  it("preserves corrupted data instead of silently clearing it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-store-"));
    await writeFile(join(dir, "state.json"), "broken");
    await expect(new Store(dir).load()).rejects.toThrow("preserved");
    expect(await readFile(join(dir, "state.json"), "utf8")).toBe("broken");
  });
});
