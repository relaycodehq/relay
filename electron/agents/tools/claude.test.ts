import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { inspectClaude } from "./claude";

let root: string;
let repo: string;
let config: string;

const files = () => ({
  configDir: config,
  userFile: join(config, ".claude.json"),
  settingsFiles: [
    join(config, "settings.json"),
    join(repo, ".claude/settings.json"),
    join(repo, ".claude/settings.local.json"),
  ],
});

const json = (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-agent-tools-"));
  repo = join(root, "repo");
  config = join(root, "config");
  await mkdir(join(repo, ".claude/skills/review"), { recursive: true });
  await mkdir(config);
  await writeFile(
    join(repo, ".claude/skills/review/SKILL.md"),
    "---\ndescription: Review the branch\n---\nInstructions",
  );
});

afterEach(async () => rm(root, { recursive: true, force: true }));

it("resolves local over project over personal, retaining disabled servers and hiding secrets", async () => {
  await json(files().userFile, {
    mcpServers: {
      same: { url: "https://personal.example/SECRET" },
      personal: {
        command: "node",
        args: ["SECRET"],
        env: { API_KEY: "SECRET" },
      },
    },
    projects: {
      [repo]: {
        mcpServers: { same: { url: "https://local.example/SECRET" } },
        disabledMcpServers: ["personal"],
      },
    },
  });
  await json(join(repo, ".mcp.json"), {
    mcpServers: {
      same: { url: "https://project.example/SECRET" },
      rejected: { url: "https://rejected.example" },
    },
  });
  await json(files().settingsFiles[0], {
    disabledMcpjsonServers: ["rejected"],
  });
  const found = await inspectClaude(repo, files());
  expect(found.servers.items.find((s) => s.name === "same")).toMatchObject({
    summary: "https://local.example",
    source: "repo",
    path: files().userFile,
  });
  expect(found.servers.items.find((s) => s.name === "personal")?.state).toBe(
    "disabled",
  );
  expect(found.servers.items.find((s) => s.name === "rejected")?.state).toBe(
    "disabled",
  );
  expect(JSON.stringify(found)).not.toContain("SECRET");
});

it("keeps a server disabled in one settings file when another lists others", async () => {
  await json(join(repo, ".mcp.json"), {
    mcpServers: {
      first: { url: "https://first.example" },
      second: { url: "https://second.example" },
    },
  });
  await json(files().settingsFiles[0], { disabledMcpjsonServers: ["first"] });
  await json(files().settingsFiles[2], { disabledMcpjsonServers: ["second"] });
  const found = await inspectClaude(repo, files());
  expect(found.servers.items.map((s) => [s.name, s.state])).toEqual([
    ["first", "disabled"],
    ["second", "disabled"],
  ]);
});

it("reads external changes on refresh and includes disabled and plugin skills", async () => {
  const plugin = join(root, "plugin");
  await mkdir(join(plugin, "skills/create"), { recursive: true });
  await writeFile(
    join(plugin, "skills/create/SKILL.md"),
    "---\ndescription: Create an artifact\n---\nBody",
  );
  await mkdir(join(config, "plugins"));
  await json(join(config, "plugins/installed_plugins.json"), {
    version: 2,
    plugins: { "artifacts@official": [{ scope: "user", installPath: plugin }] },
  });
  await json(files().settingsFiles[0], {
    skillOverrides: { review: "off" },
    enabledPlugins: { "artifacts@official": false },
  });
  const before = await inspectClaude(repo, files());
  expect(before.skills.items.map((s) => [s.name, s.state])).toEqual([
    ["review", "disabled"],
    ["artifacts:create", "disabled"],
  ]);
  expect(before.skills.items[1]?.source).toBe("plugins");
  await json(files().settingsFiles[0], {
    enabledPlugins: { "artifacts@official": true },
  });
  const after = await inspectClaude(repo, files());
  expect(after.skills.items.map((s) => s.state)).toEqual([
    "enabled",
    "enabled",
  ]);
});

it("reports unreadable configuration as incomplete and preserves other sources", async () => {
  await writeFile(files().userFile, '{"broken":"SECRET"');
  await json(join(repo, ".mcp.json"), {
    mcpServers: { docs: { url: "https://docs.example" } },
  });
  const found = await inspectClaude(repo, files());
  expect(found.servers.error).toBeTruthy();
  expect(found.servers.items[0]?.name).toBe("docs");
  expect(found.skills.items[0]?.name).toBe("review");
  expect(JSON.stringify(found)).not.toContain("SECRET");
});

it("honors exclusive managed MCP configuration instead of showing overridden servers", async () => {
  const managedMcp = join(root, "managed-mcp.json");
  await json(managedMcp, {
    mcpServers: { organization: { url: "https://managed.example" } },
  });
  await json(files().userFile, {
    mcpServers: { personal: { command: "node" } },
  });
  const found = await inspectClaude(repo, { ...files(), managedMcp });
  expect(found.servers.items.map((s) => [s.name, s.source])).toEqual([
    ["organization", "managed"],
  ]);
});

it("keeps other plugins discoverable when one plugin's metadata is broken", async () => {
  const broken = join(root, "broken");
  const plugin = join(root, "working");
  await mkdir(join(broken, ".claude-plugin"), { recursive: true });
  await writeFile(join(broken, ".claude-plugin/plugin.json"), "{broken");
  await mkdir(join(plugin, "skills/inspect"), { recursive: true });
  await writeFile(
    join(plugin, "skills/inspect/SKILL.md"),
    "---\ndescription: Inspect\n---\nBody",
  );
  await json(join(plugin, ".mcp.json"), {
    mcpServers: {
      docs: {
        type: "http",
        url: "https://docs.example/SECRET",
        headers: { Authorization: "SECRET" },
      },
    },
  });
  await mkdir(join(config, "plugins"));
  await json(join(config, "plugins/installed_plugins.json"), {
    version: 2,
    plugins: {
      "broken@official": [{ scope: "user", installPath: broken }],
      "working@official": [{ scope: "user", installPath: plugin }],
    },
  });
  await json(files().settingsFiles[0], {
    enabledPlugins: { "working@official": true },
  });
  const found = await inspectClaude(repo, files());
  expect(found.skills.items.some((s) => s.name === "working:inspect")).toBe(
    true,
  );
  expect(
    found.servers.items.find((s) => s.name === "plugin:working:docs"),
  ).toMatchObject({
    source: "plugins",
    state: "unknown",
    summary: "https://docs.example",
  });
  expect(found.skills.note).toContain("could not be read");
  expect(JSON.stringify(found)).not.toContain("SECRET");
});
