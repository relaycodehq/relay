import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./shell-path", () => ({ pathReady: async () => {} }));

import { findExecutable, setLinkedAgents, setLinkedTools } from "./executables";

const posix = process.platform !== "win32";
let root: string;
const saved = { ...process.env };

async function program(dir: string, name: string, body: string) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
  return file;
}
const working = (name: string) => `echo "${name} 1.2.3"`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-exec-"));
  process.env.HOME = root;
  process.env.MISE_DATA_DIR = join(root, "mise");
  process.env.PATH = join(root, "bin");
  setLinkedAgents({});
  setLinkedTools({});
});

afterEach(async () => {
  process.env = { ...saved };
  setLinkedAgents({});
  setLinkedTools({});
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!posix)("finding an agent CLI", () => {
  it("skips a program on PATH that can't say its version", async () => {
    await program(join(root, "bin"), "claude", "exit 1");
    const real = await program(
      join(root, ".volta/bin"),
      "claude",
      working("claude"),
    );
    expect(await findExecutable("claude")).toBe(real);
  });

  it("finds a mise install that no shell put on PATH", async () => {
    const real = await program(
      join(root, "mise/installs/aqua-anomalyco-opencode/latest"),
      "opencode",
      working("opencode"),
    );
    expect(await findExecutable("opencode")).toBe(real);
  });

  it("prefers a mise install to its shim", async () => {
    await program(join(root, "mise/shims"), "codex", "exit 1");
    const real = await program(
      join(root, "mise/installs/codex/latest/bin"),
      "codex",
      working("codex"),
    );
    expect(await findExecutable("codex")).toBe(real);
  });

  it("falls back to the first program found when none answers", async () => {
    const first = await program(join(root, "bin"), "claude", "exit 1");
    await program(join(root, ".volta/bin"), "claude", "exit 1");
    expect(await findExecutable("claude")).toBe(first);
  });

  it("uses a linked program before searching", async () => {
    await program(join(root, "bin"), "codex", working("codex"));
    const mine = await program(join(root, "elsewhere"), "codex", "exit 1");
    setLinkedAgents({ codex: mine });
    expect(await findExecutable("codex")).toBe(mine);
  });

  it("says so when a linked program is gone", async () => {
    setLinkedAgents({ codex: join(root, "gone/codex") });
    await expect(findExecutable("codex")).rejects.toThrow(/linked in Settings/);
  });

  it("reports an agent that is nowhere", async () => {
    await expect(findExecutable("opencode")).rejects.toThrow(/not found/);
  });

  it("uses a linked gh before the one on PATH, and says when it is gone", async () => {
    await program(join(root, "bin"), "gh", working("gh"));
    const mine = await program(join(root, "elsewhere"), "gh", working("gh"));
    setLinkedTools({ gh: mine });
    expect(await findExecutable("gh")).toBe(mine);
    setLinkedTools({ gh: join(root, "gone/gh") });
    await expect(findExecutable("gh")).rejects.toThrow(/linked in Settings/);
  });
});
