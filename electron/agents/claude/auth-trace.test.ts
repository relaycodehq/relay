import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../accounts", () => ({ accountHomes: () => [] }));
const { authLines, describeSaved, readSavedSignIn } =
  await import("./auth-trace");

const ACCESS = "sk-ant-oat01-" + "a".repeat(90);
const REFRESH = "sk-ant-ort01-" + "b".repeat(90);

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});
async function home(contents: string) {
  dir = await mkdtemp(join(tmpdir(), "relay-auth-trace-"));
  await writeFile(join(dir, ".credentials.json"), contents);
  return dir;
}

describe("the sign-in file in the log", () => {
  it("shows a rotation as a changed hash, never the tokens", async () => {
    const now = Date.parse("2026-10-19T20:00:00Z");
    const saved = (refreshToken: string) =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: ACCESS,
          refreshToken,
          expiresAt: now + 90 * 60_000,
        },
      });
    const before = describeSaved(
      await readSavedSignIn(await home(saved(REFRESH))),
      now,
    );
    await rm(dir!, { recursive: true });
    const after = describeSaved(
      await readSavedSignIn(await home(saved(REFRESH + "x"))),
      now,
    );
    expect(before).toMatch(
      /^access token, refresh [0-9a-f]{8}, expires .* \(in 90min\)$/,
    );
    expect(after).not.toBe(before);
    for (const line of [before, after]) {
      expect(line).not.toContain("sk-ant");
      expect(line).not.toContain("aaaa");
      expect(line).not.toContain("bbbb");
    }
  });

  it("tells an emptied file from a half-written one", async () => {
    expect(
      describeSaved(
        await readSavedSignIn(
          await home(JSON.stringify({ claudeAiOauth: { accessToken: "" } })),
        ),
      ),
    ).toBe("NO access token, NO refresh token");
    await rm(dir!, { recursive: true });
    expect(describeSaved(await readSavedSignIn(await home('{"claudeAi')))).toBe(
      "unreadable (10 bytes)",
    );
    expect(describeSaved(await readSavedSignIn(join(tmpdir(), "nope")))).toBe(
      "no sign-in file",
    );
  });
});

describe("what a probe said", () => {
  it("keeps the OAuth lines and blanks out tokens", () => {
    const log = [
      "2026-10-19T20:07:24.185Z [DEBUG] Broken symlink or missing file encountered for settings.json",
      "2026-10-19T20:07:24.300Z [DEBUG] Refresh lock held by another process, waiting (attempt 1)",
      `2026-10-19T20:07:25.000Z [ERROR] OAuth refresh failed (expected): invalid_grant for ${REFRESH}`,
      "2026-10-19T20:07:25.100Z [DEBUG] MCP server x: OAuth token expired",
    ].join("\n");
    const lines = authLines(log);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Refresh lock held by another process");
    expect(lines[1]).toContain(
      "OAuth refresh failed (expected): invalid_grant",
    );
    expect(lines.join("\n")).not.toContain("bbbb");
  });
});
