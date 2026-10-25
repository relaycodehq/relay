import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitTool, MAX_GIT_OUTPUT } from "./git-tool";

let repo: string;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" });

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "relay-git-tool-"));
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "a.ts"), "one\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
});

afterEach(() => rm(repo, { recursive: true, force: true }));

const said = async (args: unknown) => {
  const result = (await gitTool(repo, new AbortController().signal).execute(
    { args } as never,
    {},
  )) as { content: { text: string }[]; isError?: boolean };
  return {
    text: result.content.map((c) => c.text).join(""),
    isError: !!result.isError,
  };
};

describe("Cursor's read-only git", () => {
  it("reads the changes", async () => {
    await writeFile(join(repo, "a.ts"), "one\ntwo\n");
    const { text, isError } = await said(["diff", "HEAD"]);
    expect(isError).toBe(false);
    expect(text).toContain("+two");
  });

  it("turns down anything that writes, without running it", async () => {
    const refs = git("show-ref");
    for (const args of [
      ["branch", "gone"],
      ["commit", "--allow-empty", "-m", "x"],
      ["diff", "--output=" + join(repo, "out.txt")],
      ["grep", "-O", "touch " + join(repo, "pwned"), "one"],
      ["-c", "core.pager=touch pwned", "log"],
      ["stash"],
    ]) {
      const { text, isError } = await said(args);
      expect(isError, args.join(" ")).toBe(true);
      expect(text).toMatch(/isn't allowed/);
    }
    expect(git("show-ref")).toBe(refs);
    expect(existsSync(join(repo, "out.txt"))).toBe(false);
    expect(git("stash", "list")).toBe("");
  });

  it("leaves the index alone, where a plain git status would refresh it", async () => {
    await utimes(
      join(repo, "a.ts"),
      new Date(),
      new Date(Date.now() + 3600_000),
    );
    const index = await readFile(join(repo, ".git", "index"));
    expect(await said(["status", "--short"])).toEqual({
      text: "(no output)",
      isError: false,
    });
    expect(await readFile(join(repo, ".git", "index"))).toEqual(index);
  });

  it("cuts output past the limit and says how to ask for less", async () => {
    const line = "y".repeat(99) + "\n";
    await writeFile(join(repo, "big.ts"), line.repeat(MAX_GIT_OUTPUT / 50));
    git("add", ".");
    const { text, isError } = await said(["diff", "--cached"]);
    expect(isError).toBe(false);
    expect(text.length).toBeLessThan(MAX_GIT_OUTPUT + 500);
    expect(text).toMatch(/Cut at .*--stat/);
  });

  it("reports a search with no matches as empty, and a bad request as an error", async () => {
    expect(await said(["grep", "nothing-matches-this"])).toEqual({
      text: "(no output)",
      isError: false,
    });
    expect((await said(["show", "no-such-ref"])).isError).toBe(true);
    expect((await said("diff")).isError).toBe(true);
  });
});
