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
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import { delimiter, join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

const {
  isolateProviderHome,
  isolateProviderKeychain,
}: {
  isolateProviderHome(data: string, roots: string[]): () => void;
  isolateProviderKeychain(
    native: boolean,
    target: { execFile: ReturnType<typeof vi.fn> },
  ): () => void;
} = createRequire(import.meta.url)("../fixtures/provider-isolation.cjs");

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
    CLAUDE_CODE_OAUTH_TOKEN: "host-oauth",
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
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
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

it("redirects fixed personal config paths and rejects linked executables outside the sample", async () => {
  const data = join(root, "data");
  await mkdir(data);
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({ agentPaths: { codex: join(root, "outside", "codex") } }),
  );
  expect(() => isolateProviderHome(data, [data])).toThrow(
    "must live in fixture folders",
  );
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({ agentPaths: { codex: join(data, "bin", "codex") } }),
  );
  const original = homedir();
  restore = isolateProviderHome(data, [data]);
  expect(homedir()).toBe(join(data, "home"));
  restore();
  restore = undefined;
  expect(homedir()).toBe(original);
});

it("blocks provider Keychain reads/writes while preserving ordinary security commands", async () => {
  const normal = vi.fn(async (_file: string, _args: string[]) => ({
    stdout: "ordinary",
    stderr: "",
  }));
  const execFile = Object.assign(vi.fn(), { [promisify.custom]: normal });
  const target = { execFile };
  restore = isolateProviderKeychain(false, target);
  const exec = promisify(target.execFile);
  for (const service of ["Codex Auth", "Claude Code-credentials-abcd1234"])
    for (const operation of [
      "find-generic-password",
      "add-generic-password",
      "delete-generic-password",
    ])
      await expect(
        exec("/usr/bin/security", [operation, "-s", service, "-w", "sample"]),
      ).rejects.toMatchObject({ code: 44 });
  const error = await new Promise<Error>((resolve) =>
    target.execFile(
      "/usr/bin/security",
      ["find-generic-password", "-s", "Codex Auth", "-w"],
      (error: Error) => resolve(error),
    ),
  );
  expect(error.message).toContain("No provider Keychain credentials");
  expect(execFile).not.toHaveBeenCalled();
  expect(normal).not.toHaveBeenCalled();
  await expect(exec("/usr/bin/security", ["find-identity"])).resolves.toEqual({
    stdout: "ordinary",
    stderr: "",
  });
  await exec("/usr/bin/security", [
    "find-generic-password",
    "-s",
    "Unrelated sample",
  ]);
  expect(normal).toHaveBeenCalledTimes(2);
});

it("keeps native storage opt-in using the original security implementation", () => {
  const original = vi.fn();
  const target = { execFile: original };
  restore = isolateProviderKeychain(true, target);
  expect(target.execFile).toBe(original);
});
