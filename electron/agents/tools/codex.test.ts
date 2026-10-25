import { beforeEach, expect, it, vi } from "vitest";
import { codexServers, inspectCodex } from "./codex";
import { readCodexSkills, withAppServer } from "../provider-commands";
import { codexSkill, skillCommands } from "../skill-presentation";

vi.mock("../provider-commands", async (original) => ({
  ...(await original<typeof import("../provider-commands")>()),
  withAppServer: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it("retains disabled skills in the inventory while excluding them from composer commands", () => {
  const skills = readCodexSkills(
    {
      data: [
        {
          cwd: "/repo",
          skills: [
            { name: "on", path: "/repo/on/SKILL.md", enabled: true },
            { name: "off", path: "/repo/off/SKILL.md", enabled: false },
          ],
        },
      ],
    },
    "/repo",
  )!;
  expect(skills.map((s) => s.name)).toEqual(["on", "off"]);
  expect(skillCommands(skills.map(codexSkill)).map((s) => s.name)).toEqual([
    "on",
  ]);
  expect(readCodexSkills({ data: [] }, "/repo")).toBeUndefined();
});

it("takes Codex's only entry when it spells the asked-for checkout differently", () => {
  const skills = readCodexSkills(
    {
      data: [
        {
          cwd: "/private/var/repo",
          skills: [{ name: "on", path: "/repo/on/SKILL.md", enabled: true }],
        },
      ],
    },
    "/var/repo",
  );
  expect(skills?.map((s) => s.name)).toEqual(["on"]);
});

it("uses native sources and sends only sanitized configuration across the bridge", () => {
  const found = codexServers({
    config: {
      mcp_servers: {
        docs: {
          url: "https://user:SECRET@docs.example/SECRET?token=SECRET",
          http_headers: { Authorization: "SECRET" },
        },
        local: {
          command: "/bin/node",
          args: ["--token", "SECRET"],
          env: { API_KEY: "SECRET" },
          enabled: false,
        },
      },
    },
    origins: {
      "mcp_servers.docs.url": {
        name: { type: "project", dotCodexFolder: "/repo/.codex" },
      },
      "mcp_servers.local.command": {
        name: { type: "user", file: "/home/.codex/config.toml" },
      },
    },
  });
  expect(found.items[0]).toMatchObject({
    source: "repo",
    path: "/repo/.codex/config.toml",
    summary: "https://docs.example",
  });
  expect(found.items[1]).toMatchObject({
    source: "personal",
    state: "disabled",
    summary: "node",
  });
  expect(JSON.stringify(found)).not.toContain("SECRET");
});

it("refreshes both native catalogs for the selected checkout without starting a thread", async () => {
  const request = vi.fn(async (method: string) =>
    method === "skills/list"
      ? { data: [{ cwd: "/repo", skills: [] }] }
      : { config: {} },
  );
  vi.mocked(withAppServer).mockImplementation(async (_cwd, _task, work) =>
    work({ request } as never),
  );
  await inspectCodex("/repo");
  await inspectCodex("/repo");
  expect(withAppServer).toHaveBeenCalledTimes(2);
  expect(request.mock.calls).toEqual([
    ["skills/list", { cwds: ["/repo"], forceReload: true }],
    ["config/read", { cwd: "/repo", includeLayers: false }],
    ["skills/list", { cwds: ["/repo"], forceReload: true }],
    ["config/read", { cwd: "/repo", includeLayers: false }],
  ]);
});

it("keeps a failed section explicit without losing successful discovery or exposing errors", async () => {
  vi.mocked(withAppServer).mockImplementation(async (_cwd, _task, work) =>
    work({
      request: async (method: string) => {
        if (method === "skills/list")
          throw new Error("SECRET upstream debug information");
        return {
          config: { mcp_servers: { docs: { url: "https://example.com" } } },
        };
      },
    } as never),
  );
  const result = await inspectCodex("/repo");
  expect(result.skills.error).toBeTruthy();
  expect(result.servers.items).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("SECRET");
});
