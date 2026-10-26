import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileAuthors } from "./file-authors";

describe("fileAuthors", () => {
  it("names each line's author at the revision", async () => {
    const repo = await mkdtemp(join(tmpdir(), "relay-authors-"));
    const git = (name: string, ...args: string[]) =>
      execFileSync("git", ["-C", repo, "-c", `user.name=${name}`, "-c", "user.email=a@e.invalid", ...args])
        .toString()
        .trim();
    git("Ada", "init", "-q");
    await writeFile(join(repo, "a.ts"), "one\ntwo\nthree\n");
    git("Ada", "add", ".");
    git("Ada", "commit", "-qm", "Ada writes");
    await writeFile(join(repo, "a.ts"), "one\nTWO\nthree\nfour\n");
    git("Bo", "commit", "-qam", "Bo edits");
    const head = git("Bo", "rev-parse", "HEAD");
    // Lines Bo didn't touch stay Ada's, even with Bo's commit being newer.
    const found = await fileAuthors(repo, { revision: head, path: "a.ts" });
    expect(found.lines.map((index) => found.authors[index])).toEqual(["Ada", "Bo", "Ada", "Bo"]);
  });
});
