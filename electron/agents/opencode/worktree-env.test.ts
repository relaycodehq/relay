import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  rememberWorktreeEnv,
  setOpenCodeEnvRoot,
  withWorktreeEnvPlugin,
} from "./worktree-env";

/** Runs the plugin Relay wrote the way OpenCode does for a shell command in `cwd`. */
async function shellEnv(env: Record<string, string>, cwd: string) {
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!);
  const url: string = config.plugin.at(-1);
  const plugin = await import(`${url}?${Math.random()}`);
  const hooks = await plugin.RelayWorktreeEnv();
  const output = { env: {} as Record<string, string> };
  await hooks["shell.env"]({ cwd }, output);
  return output.env;
}

describe("OpenCode worktree variables", () => {
  it("gives a command the variables of the worktree it runs in", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "relay-oc-")));
    setOpenCodeEnvRoot(join(base, "relay"));
    const wt = join(base, "wt");
    const sibling = join(base, "wt-2");
    const nested = join(wt, ".worktrees", "inner");
    for (const dir of [wt, sibling, nested])
      await mkdir(dir, { recursive: true });
    const env = await withWorktreeEnvPlugin({
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: ["mine"] }),
    });
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT!).plugin[0]).toBe("mine");

    await rememberWorktreeEnv(wt, { RELAY_PORT_OFFSET: "1" });
    await rememberWorktreeEnv(nested, { RELAY_PORT_OFFSET: "2" });
    expect(await shellEnv(env, join(wt, "src"))).toEqual({
      RELAY_PORT_OFFSET: "1",
    });
    expect(await shellEnv(env, join(nested, "src"))).toEqual({
      RELAY_PORT_OFFSET: "2",
    });
    expect(await shellEnv(env, sibling)).toEqual({});

    await rememberWorktreeEnv(wt);
    expect(await shellEnv(env, wt)).toEqual({});
  });

  it("leaves a config it can't extend alone", async () => {
    setOpenCodeEnvRoot(await mkdtemp(join(tmpdir(), "relay-oc-")));
    const env = { OPENCODE_CONFIG_CONTENT: "{ // jsonc" };
    expect(await withWorktreeEnvPlugin(env)).toBe(env);
  });
});
