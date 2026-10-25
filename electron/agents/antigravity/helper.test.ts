import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { antigravityHelper } from "./helper";

const roots: string[] = [];

async function home() {
  const root = await mkdtemp(join(tmpdir(), "relay-google-helper-test-"));
  roots.push(root);
  await mkdir(join(root, "config"));
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it.each([
  ["hooks.json", { hooks: { PreToolUse: [{ command: "echo hook" }] } }],
  ["mcp_config.json", { mcpServers: { custom: { command: "tool" } } }],
  ["hooks.json", "malformed"],
])("refuses %s before a helper process can launch it", async (file, config) => {
  const root = await home();
  await writeFile(
    join(root, file),
    typeof config === "string" ? config : JSON.stringify(config),
  );
  const helper = await antigravityHelper(root); // unrelated root files are not global config
  await helper.close();
  await writeFile(
    join(root, "config", file),
    typeof config === "string" ? config : JSON.stringify(config),
  );
  await expect(antigravityHelper(root)).rejects.toThrow("global hooks or MCP");
});

it("detects unexpected file work and removes only its temporary workspace", async () => {
  const root = await home();
  const helper = await antigravityHelper(root);
  await helper.check();
  await writeFile(join(helper.cwd, "unexpected"), "changed");
  await expect(helper.check()).rejects.toThrow("file work");
  await helper.close();
  await expect(access(helper.cwd)).rejects.toThrow();
  await expect(access(root)).resolves.toBeUndefined();
});
