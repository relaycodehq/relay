import { describe, expect, it } from "vitest";
import { blockCommand, inlineCommand } from "./shell-command";

describe("inlineCommand", () => {
  it("takes a known program with arguments", () => {
    for (const code of [
      "npm run typecheck",
      "npx vitest run src/lib/shell-command.test.ts",
      "git push --force-with-lease",
      "gh pr view 42",
      "cd ~/projects/relay",
      "brew install --cask iterm2",
      "FOO=1 BAR= npm test",
      "./gradlew assembleRelease",
      "curl -fsSL https://example.com/install.sh | sh",
    ])
      expect(inlineCommand(code), code).toBe(code);
  });

  it("drops a copied prompt", () => {
    expect(inlineCommand("$ npm install")).toBe("npm install");
    expect(inlineCommand(" % git status ")).toBe("git status");
    expect(inlineCommand("PS C:\\repo> npm test")).toBe("npm test");
  });

  it("leaves names, paths and other code alone", () => {
    for (const code of [
      "git",
      "npm",
      "make",
      "node_modules/.bin/vite",
      "src/lib/shell-command.ts",
      "package.json",
      "useEffect(() => {})",
      "const git = require('git')",
      "FOO=1",
      "FOO=1 npm",
      "Git push",
      "npmx install",
      "--force",
      "#123",
    ])
      expect(inlineCommand(code), code).toBeNull();
  });

  it("refuses something too long to be one command", () => {
    expect(inlineCommand(`echo ${"x".repeat(500)}`)).toBeNull();
  });
});

describe("blockCommand", () => {
  it("gives a shell block's commands as they are", () => {
    expect(blockCommand("npm install\nnpm run build", "bash")).toBe(
      "npm install\nnpm run build",
    );
    expect(blockCommand("Get-ChildItem -Recurse", "powershell")).toBe(
      "Get-ChildItem -Recurse",
    );
    expect(blockCommand("anything at all", "SH")).toBe("anything at all");
  });

  it("ignores other languages", () => {
    expect(blockCommand("npm install", "js")).toBeNull();
    expect(blockCommand("npm install", "text")).toBeNull();
    expect(blockCommand("npm install", "diff")).toBeNull();
  });

  it("takes an unlabelled block only as a single command line", () => {
    expect(blockCommand("npm run dev\n", undefined)).toBe("npm run dev");
    expect(blockCommand("$ git status", undefined)).toBe("git status");
    expect(blockCommand("npm install\nnpm run dev", undefined)).toBeNull();
    expect(blockCommand("const x = 1;", undefined)).toBeNull();
    expect(blockCommand("README.md", undefined)).toBeNull();
  });

  it("keeps only the prompted lines of a session with output", () => {
    const session = [
      "$ npm test",
      "",
      "> relay@1.0.0 test",
      "> vitest run",
      "",
      " ✓ 12 passed",
      "$ git status --short",
      " M src/app.ts",
    ].join("\n");
    expect(blockCommand(session, "console")).toBe(
      "npm test\ngit status --short",
    );
    expect(blockCommand(session, "bash")).toBe("npm test\ngit status --short");
  });

  it("follows a prompted line's backslash continuation", () => {
    expect(
      blockCommand("$ docker run \\\n    -p 80:80 nginx\nlistening", "sh"),
    ).toBe("docker run \\\n    -p 80:80 nginx");
  });

  it("offers nothing for a session block without prompts, which is output", () => {
    expect(blockCommand("added 12 packages in 2s", "console")).toBeNull();
  });

  it("drops comments zsh would try to run, but not # inside words or quotes", () => {
    expect(
      blockCommand(
        [
          "# install dependencies",
          "npm ci   # clean install",
          "",
          "  # then",
          'git commit -m "fix #12"',
          "echo 'a # b' # trailing",
          "open https://example.com/#top",
          "echo $# ${#arr}",
        ].join("\n"),
        "bash",
      ),
    ).toBe(
      [
        "npm ci",
        'git commit -m "fix #12"',
        "echo 'a # b'",
        "open https://example.com/#top",
        "echo $# ${#arr}",
      ].join("\n"),
    );
  });

  it("leaves a heredoc's body alone", () => {
    const code = "cat <<EOF > notes.md\n# Title\n\nbody\nEOF";
    expect(blockCommand(code, "bash")).toBe(code);
  });

  it("offers nothing for a script, an empty block or only comments", () => {
    expect(blockCommand("#!/bin/bash\nset -e\nnpm ci", "bash")).toBeNull();
    expect(blockCommand("   \n", "bash")).toBeNull();
    expect(blockCommand("# nothing to run", "zsh")).toBeNull();
  });
});
