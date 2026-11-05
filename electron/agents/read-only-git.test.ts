import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readOnlyGitEnv, readOnlyGitEnvIn } from "./read-only-git";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-read-only-git-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A checkout with a bare repository committed in it that runs a command on `git status`. */
function checkoutWithTrap(marker: string) {
  const checkout = join(root, "checkout");
  execFileSync("git", ["init", "--quiet", checkout]);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: checkout, stdio: "ignore" });
  const trap = ["-C", "fixtures/evil.git", "config"];
  git("init", "--quiet", "--bare", "fixtures/evil.git");
  git(...trap, "core.bare", "false");
  git(...trap, "core.worktree", "..");
  git(...trap, "core.fsmonitor", `touch '${marker}'; false`);
  git("add", "-A");
  git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "trap");
  return checkout;
}

it("keeps git status in a committed bare repository from running its config", async () => {
  const marker = join(root, "ran");
  const checkout = checkoutWithTrap(marker);
  const status = (env: NodeJS.ProcessEnv) =>
    spawnSync("git", ["-C", "fixtures/evil.git", "status"], {
      cwd: checkout,
      env,
    });

  status(process.env);
  expect(existsSync(marker)).toBe(true);
  await rm(marker);

  status({ ...process.env, ...readOnlyGitEnv(process.env) });
  expect(existsSync(marker)).toBe(false);
});

it("keeps git status from running the checkout's own fsmonitor command", async () => {
  const marker = join(root, "ran");
  const checkout = join(root, "plain");
  const watcher = `touch '${marker}'; false`;
  execFileSync("git", ["init", "--quiet", checkout]);
  execFileSync("git", ["config", "core.fsmonitor", watcher], { cwd: checkout });
  spawnSync("git", ["status"], {
    cwd: checkout,
    env: { ...process.env, ...readOnlyGitEnv(process.env) },
  });
  expect(existsSync(marker)).toBe(false);
});

it.skipIf(process.platform === "win32")(
  "keeps git log from running the checkout's own signature program",
  async () => {
    const marker = join(root, "ran");
    const checkout = join(root, "signed");
    const signer = join(root, "signer.sh");
    // Enough of gpg for git to store a signature on the commit.
    await writeFile(
      signer,
      `#!/bin/sh\ntouch '${marker}'\necho '[GNUPG:] SIG_CREATED ' >&2\nprintf -- '-----BEGIN PGP SIGNATURE-----\\nx\\n-----END PGP SIGNATURE-----\\n'\n`,
      { mode: 0o755 },
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: checkout, stdio: "ignore" });
    execFileSync("git", ["init", "--quiet", checkout]);
    git("config", "gpg.program", signer);
    git("config", "log.showSignature", "true");
    git(
      "-c",
      "user.email=a@b",
      "-c",
      "user.name=a",
      "commit",
      "--allow-empty",
      "-S",
      "-qm",
      "signed",
    );
    await rm(marker);
    for (const args of [["log"], ["log", "--format=%G?"]]) {
      spawnSync("git", args, {
        cwd: checkout,
        env: { ...process.env, ...readOnlyGitEnv(process.env) },
      });
      expect(existsSync(marker), args.join(" ")).toBe(false);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps git reads from running the checkout's own filter and diff commands",
  async () => {
    const checkout = join(root, "filtered");
    const ran = (what: string) => join(root, `ran-${what}`);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: checkout, stdio: "ignore" });
    execFileSync("git", ["init", "--quiet", checkout]);
    await writeFile(join(checkout, ".gitattributes"), "*.t diff=x filter=x\n");
    await writeFile(join(checkout, "a.t"), "before\n");
    git("add", "-A");
    git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "one");
    await writeFile(join(checkout, "a.t"), "after\n");
    git("config", "filter.x.clean", `touch '${ran("clean")}'; cat`);
    git("config", "filter.x.smudge", `touch '${ran("smudge")}'; cat`);
    git("config", "filter.x.required", "true");
    git("config", "diff.x.textconv", `touch '${ran("textconv")}'; cat`);
    git("config", "diff.x.command", `touch '${ran("command")}'; true`);
    git("config", "diff.external", `touch '${ran("external")}'; true`);
    const env = {
      ...process.env,
      ...(await readOnlyGitEnvIn(checkout, process.env)),
    };
    // With its external command emptied, a plain diff fails rather than run one.
    spawnSync("git", ["diff"], { cwd: checkout, env });
    const reads = [
      ["status", "--short"],
      ["log", "-p", "--no-ext-diff"],
      ["show", "--textconv", "HEAD:a.t"],
      ["cat-file", "--textconv", "HEAD:a.t"],
      ["cat-file", "--filters", "HEAD:a.t"],
    ];
    for (const args of reads) {
      const read = spawnSync("git", args, { cwd: checkout, env });
      expect(read.status, `${args.join(" ")}: ${read.stderr}`).toBe(0);
    }
    const shown = spawnSync("git", ["diff", "--no-ext-diff"], {
      cwd: checkout,
      env,
      encoding: "utf8",
    });
    expect(shown.stdout).toContain("+after");
    const markers = ["clean", "smudge", "textconv", "command", "external"];
    expect(markers.filter((what) => existsSync(ran(what)))).toEqual([]);
  },
);

it("names no variable Codex's default shell environment policy drops", () => {
  // Codex leaves out names matching *KEY*, *SECRET* and *TOKEN* unless told
  // not to, and git refuses every command when a counted key goes missing.
  const names = Object.keys(readOnlyGitEnv(process.env));
  expect(names.filter((name) => /KEY|SECRET|TOKEN/i.test(name))).toEqual([]);
});

it("passes its settings in the form git before 2.31 also reads", () => {
  // Older git splits GIT_CONFIG_PARAMETERS into shell-quoted 'key=value'
  // words and refuses every command on 'key'='value', which 2.31 added.
  // Debian 11 and Ubuntu 20.04 servers still ship such a git.
  const { GIT_CONFIG_PARAMETERS } = readOnlyGitEnv({});
  expect(GIT_CONFIG_PARAMETERS).toMatch(/^'[^']+=[^']+'( '[^']+=[^']+')*$/);
});

it("keeps settings the environment already passes to git", () => {
  const checkout = checkoutWithTrap(join(root, "ran"));
  const base = {
    ...process.env,
    GIT_CONFIG_PARAMETERS: "'user.name'='Some One'",
  };
  const read = (key: string) =>
    execFileSync("git", ["config", key], {
      cwd: checkout,
      env: { ...base, ...readOnlyGitEnv(base) },
      encoding: "utf8",
    }).trim();
  expect(read("user.name")).toBe("Some One");
  expect(read("safe.bareRepository")).toBe("explicit");
  expect(read("core.fsmonitor")).toBe("false");
});
