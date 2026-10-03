import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, net: {}, safeStorage: {} }));
import { resolveCliPath } from "./index";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-cli-path-"));
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin", "gh"), "");
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("a typed CLI path", () => {
  it("takes a folder as the CLI inside it", async () => {
    expect(await resolveCliPath("gh", join(root, "bin"))).toBe(
      join(root, "bin", "gh"),
    );
    await expect(resolveCliPath("tea", join(root, "bin"))).rejects.toThrow(
      /no tea in it/,
    );
  });

  it("reads ~ as the home folder", async () => {
    vi.stubEnv("HOME", root);
    try {
      expect(await resolveCliPath("gh", "~/bin/gh")).toBe(
        join(root, "bin", "gh"),
      );
      expect(await resolveCliPath("gh", "~/bin")).toBe(join(root, "bin", "gh"));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses relative paths and ones that point nowhere", async () => {
    await expect(resolveCliPath("gh", "bin/gh")).rejects.toThrow(/full path/);
    await expect(
      resolveCliPath("gh", join(root, "missing", "gh")),
    ).rejects.toThrow(/nothing at/);
  });
});
