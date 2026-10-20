import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, it } from "vitest";
import { providerEnv } from "../fixtures/provider-env";
import {
  findExecutable,
  setLinkedAgents,
} from "../../electron/platform/executables";

const isolateProviderExecutables: (
  roots: string[],
  commands: string[],
  platform?: NodeJS.Platform,
) => () => void = createRequire(import.meta.url)(
  "../fixtures/provider-isolation.cjs",
);
let root: string;
let restore: (() => void) | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-provider-fixtures-"));
});
afterEach(async () => {
  setLinkedAgents({});
  restore?.();
  restore = undefined;
  await rm(root, { recursive: true, force: true });
});

it("isolates inherited provider homes and credentials while preserving explicit samples", () => {
  const inherited = {
    PATH: join(root, "host-bin"),
    CODEX_HOME: join(root, "personal-codex"),
    CLAUDE_CONFIG_DIR: join(root, "personal-claude"),
    ANTHROPIC_API_KEY: "host-credential",
  };
  const data = join(root, "data");
  const bin = join(root, "fixture-bin");
  const explicit = join(root, "sample-claude");
  const env = providerEnv(
    {
      ...inherited,
      RELAY_TEST_DATA: data,
      PATH: bin + delimiter + inherited.PATH,
      CLAUDE_CONFIG_DIR: explicit,
    },
    inherited,
  );
  expect(env.CODEX_HOME).toBe(join(data, "provider-homes", "codex"));
  expect(env.CLAUDE_CONFIG_DIR).toBe(explicit);
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(JSON.parse(env.RELAY_TEST_PROVIDER_ROOTS)).toEqual([data, bin]);
  expect(JSON.parse(env.RELAY_TEST_PROVIDER_COMMANDS)).toContain("amp-acp");
});

it("never probes an external provider, even when a fixture with that name is missing", async () => {
  const allowed = join(root, "fixture");
  const external = join(root, "fixture-other");
  await Promise.all([mkdir(allowed), mkdir(external)]);
  const command = join(external, "codex");
  const probe = join(root, "probed");
  await writeFile(
    command,
    `require('node:fs').writeFileSync(${JSON.stringify(probe)}, 'probed')`,
    { mode: 0o700 },
  );
  restore = isolateProviderExecutables([allowed], ["codex"]);
  const discover = async (file: string) => {
    await access(file, constants.X_OK);
    execFileSync(process.execPath, [file, "--version"]);
  };
  await expect(discover(join(allowed, "codex"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(discover(command)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(probe)).rejects.toMatchObject({ code: "ENOENT" });
  // Ordinary repository/config reads are not executable discovery.
  expect(await readFile(command, "utf8")).toContain("writeFileSync");
  await expect(access(command)).resolves.toBeUndefined();
});

it("keeps fixture executables and ordinary tools available", async () => {
  const allowed = join(root, "fixture");
  const external = join(root, "outside");
  await Promise.all([mkdir(allowed), mkdir(external)]);
  const command = join(allowed, "codex.js");
  const git = join(external, "git");
  await Promise.all([
    writeFile(command, "fixture", { mode: 0o700 }),
    writeFile(git, "ordinary tool"),
  ]);
  restore = isolateProviderExecutables([allowed], ["codex"]);
  await expect(access(command, constants.X_OK)).resolves.toBeUndefined();
  await expect(access(git)).resolves.toBeUndefined();
});

it("hides Windows provider shim discovery without hiding config access", async () => {
  const command = join(root, "codex.cmd");
  await writeFile(command, "fixture shim");
  restore = isolateProviderExecutables([], ["codex"], "win32");
  await expect(access(command, constants.F_OK)).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(access(command)).resolves.toBeUndefined();
});

it("preserves an explicitly linked sample executable without searching the host", async () => {
  const command = join(root, "codex.js");
  await writeFile(command, "sample executable");
  restore = isolateProviderExecutables([], ["codex"]);
  setLinkedAgents({ codex: command });
  expect(await findExecutable("codex")).toBe(command);
});
