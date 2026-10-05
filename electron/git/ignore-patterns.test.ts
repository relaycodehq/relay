import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { matches, parsePatterns, reaches } from "./ignore-patterns";

const match = (patterns: string, path: string, isDir = false) =>
  matches(parsePatterns(patterns), path, isDir);

it("matches a name without a slash at any depth", () => {
  expect(match(".env", ".env")).toBe(true);
  expect(match(".env", "apps/web/.env")).toBe(true);
  expect(match(".env", ".env.local")).toBe(false);
});

it("anchors a pattern holding a slash to the root", () => {
  expect(match("config/secrets.json", "config/secrets.json")).toBe(true);
  expect(match("config/secrets.json", "apps/config/secrets.json")).toBe(false);
  expect(match("/local.json", "local.json")).toBe(true);
  expect(match("/local.json", "a/local.json")).toBe(false);
});

it("handles stars, double stars and classes", () => {
  expect(match(".env*", ".env.local")).toBe(true);
  expect(match("*.key", "certs/dev.key")).toBe(true);
  expect(match("apps/*/env.json", "apps/web/env.json")).toBe(true);
  expect(match("apps/*/env.json", "apps/web/x/env.json")).toBe(false);
  expect(match("apps/**/env.json", "apps/web/x/env.json")).toBe(true);
  expect(match("apps/**/env.json", "apps/env.json")).toBe(true);
  expect(match("**/.claude/skills/*.md", "a/.claude/skills/x.md")).toBe(true);
  expect(match("cache/**", "cache/a/b")).toBe(true);
  expect(match("cache/**", "cache")).toBe(false);
  expect(match("file[0-9].txt", "file3.txt")).toBe(true);
  expect(match("file[!0-9].txt", "file3.txt")).toBe(false);
  expect(match("\\#notes", "#notes")).toBe(true);
});

it("matches a folder's contents, and folder-only patterns only folders", () => {
  expect(match("vendor/", "vendor", true)).toBe(true);
  expect(match("vendor/", "vendor", false)).toBe(false);
  expect(match("vendor/", "vendor/a/b.php")).toBe(true);
});

it("lets the last matching pattern win, comments and blanks aside", () => {
  const patterns = "# secrets\n\n.env*\n!.env.example\n";
  expect(match(patterns, ".env")).toBe(true);
  expect(match(patterns, ".env.example")).toBe(false);
});

it("reaches into an ignored folder only when a pattern names its way in", () => {
  const rules = parsePatterns(
    ".env\nvendor/**/config.json\n**/.claude/skills/*.md\nlocal/settings/*.json",
  );
  expect(reaches(rules, "node_modules")).toBe(false);
  expect(reaches(rules, "vendor")).toBe(true);
  expect(reaches(rules, ".claude")).toBe(true);
  expect(reaches(rules, "a/.claude")).toBe(true);
  expect(reaches(rules, "local")).toBe(true);
  expect(reaches(rules, "local/settings")).toBe(true);
  expect(reaches(rules, "local/other")).toBe(false);
  expect(reaches(parsePatterns("**/config.json"), "vendor")).toBe(false);
  expect(reaches(parsePatterns("!vendor/x"), "vendor")).toBe(false);
});

// Patterns where a hand-written matcher drifts from Git easily; each is
// checked against `git check-ignore` itself.
const againstGit: [patterns: string, path: string, isDir?: boolean][] = [
  ["vendor/*\n!vendor/keep.php", "vendor/keep.php"],
  ["vendor/\n!vendor/keep.php", "vendor/keep.php"],
  ["[[:alpha:]].txt", "a.txt"],
  ["[[:digit:]]x", "5x"],
  ["[[:digit:]]x", "ax"],
  ["file[\\]]", "file]"],
  ["[]a]b", "]b"],
  ["[!a]b", "cb"],
  ["[!a]b", "ab"],
  ["[a-c]x", "bx"],
  ["[a", "[a"],
  ["foo\t", "foo\t"],
  ["foo\\ ", "foo "],
  ["foo ", "foo"],
  ["\ufeff.env", ".env"],
  ["a**b", "axyb"],
  ["**foo", "x/afoo"],
  ["a/**", "a/b/c"],
  ["**", "x/y"],
  ["*.md\n!README.md", "docs/README.md"],
  ["docs/**/*.md", "docs/a.md"],
  ["/build", "sub/build"],
  ["build/", "sub/build", true],
  ["link/", "link"],
  ["\\!bang", "!bang"],
  ["*/b", "a/b"],
  ["*/b", "x/a/b"],
];

it.each([false, true])("agrees with git, ignorecase %s", (ignoreCase) => {
  const cases: typeof againstGit = [
    ...againstGit,
    [".ENV", ".env"],
    ["Secrets.json", "secrets.json"],
  ];
  for (const [patterns, path, isDir] of cases) {
    const repo = mkdtempSync(join(tmpdir(), "relay-gi-"));
    try {
      execFileSync("git", ["init", "-q", repo]);
      writeFileSync(join(repo, ".gitignore"), `${patterns}\n`);
      const full = join(repo, path);
      mkdirSync(isDir ? full : dirname(full), { recursive: true });
      if (!isDir) writeFileSync(full, "");
      let ignored = true;
      try {
        execFileSync(
          "git",
          [
            "-C",
            repo,
            "-c",
            `core.ignorecase=${ignoreCase}`,
            "check-ignore",
            "-q",
            "--no-index",
            path,
          ],
          { stdio: "pipe" },
        );
      } catch {
        ignored = false;
      }
      expect(
        matches(parsePatterns(patterns, { ignoreCase }), path, !!isDir),
        `${JSON.stringify(patterns)} on ${JSON.stringify(path)}`,
      ).toBe(ignored);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});
