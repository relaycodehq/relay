import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { discoverClaudeSkills, skillOverrideFiles } from "./skills";

let root: string;
let config: string;
let repo: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-claude-skills-"));
  config = join(root, "claude-home");
  repo = join(root, "repo");
  await mkdir(join(repo, ".git"), { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function skill(dir: string, name: string, frontmatter?: string) {
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(
    join(dir, name, "SKILL.md"),
    frontmatter === undefined
      ? "# Just a heading\n"
      : `---\n${frontmatter}\n---\n\nBody.\n`,
  );
}
const userSkills = () => join(config, "skills");
const projectSkills = () => join(repo, ".claude", "skills");

it("finds user and project skills, the user's copy of a name first", async () => {
  await skill(userSkills(), "shared", "description: user copy");
  await skill(projectSkills(), "shared", "description: project copy");
  await skill(projectSkills(), "local", "description: only here");
  // Codex's folder; Claude Code doesn't read it.
  await skill(join(repo, ".agents", "skills"), "codex-only", "description: no");
  expect(await discoverClaudeSkills(config, repo)).toEqual([
    {
      name: "local",
      path: join(projectSkills(), "local", "SKILL.md"),
      enabled: true,
      scope: "project",
      description: "only here",
    },
    {
      name: "shared",
      path: join(userSkills(), "shared", "SKILL.md"),
      enabled: true,
      scope: "user",
      description: "user copy",
    },
  ]);
});

it("reads the invocation flags in YAML 1.1's spellings, and names a skill by its folder", async () => {
  await skill(
    userSkills(),
    "kane-cli",
    [
      "name: frontmatter-alias",
      'description: Read C:\\skills\\guide#tag: continue with "quoted". # trailing: comment',
      "allowed-tools: [Read, Write]",
      "disable-model-invocation: yes",
      "user-invocable: no",
    ].join("\n"),
  );
  await skill(userSkills(), "manual", "disable-model-invocation: true");
  expect(await discoverClaudeSkills(config, undefined)).toEqual([
    {
      name: "kane-cli",
      path: join(userSkills(), "kane-cli", "SKILL.md"),
      enabled: true,
      scope: "user",
      description: 'Read C:\\skills\\guide#tag: continue with "quoted".',
      userInvocationOnly: true,
      userInvocable: false,
    },
    {
      name: "manual",
      path: join(userSkills(), "manual", "SKILL.md"),
      enabled: true,
      scope: "user",
      userInvocationOnly: true,
    },
  ]);
});

it("keeps a skill without frontmatter and drops one whose frontmatter won't parse", async () => {
  await skill(userSkills(), "no-frontmatter");
  for (const [name, field] of [
    ["broken-yaml", "name: [unclosed"],
    ["broken-tools", "allowed-tools: [Read, Write"],
    ["broken-quoted", 'name: "unclosed: text'],
  ])
    await skill(userSkills(), name, `description: Run: it.\n${field}`);
  await writeFile(join(userSkills(), "README.md"), "not a skill");
  const found = await discoverClaudeSkills(config, undefined);
  expect(found.map((s) => s.name)).toEqual(["no-frontmatter"]);
  expect(found[0].description).toBeUndefined();
});

it("keeps a skill with a multiline quoted YAML description", async () => {
  await skill(
    userSkills(),
    "multiline",
    'description: "Review the code\n  for concrete bugs"\ndisable-model-invocation: true',
  );
  expect(await discoverClaudeSkills(config, repo)).toEqual([
    {
      name: "multiline",
      path: join(userSkills(), "multiline", "SKILL.md"),
      enabled: true,
      scope: "user",
      description: "Review the code for concrete bugs",
      userInvocationOnly: true,
    },
  ]);
});

it("applies skillOverrides by folder name, the strongest file's, and drops a file's map with a bad value", async () => {
  await skill(projectSkills(), "off-by-user");
  await skill(projectSkills(), "manual-by-project");
  await skill(projectSkills(), "on-again");
  await skill(projectSkills(), "bad-map");
  await mkdir(config, { recursive: true });
  await writeFile(
    join(config, "settings.json"),
    `{
      // Comments and trailing commas are fine.
      "skillOverrides": { "off-by-user": "off", "on-again": "off", },
    }`,
  );
  await writeFile(
    join(repo, ".claude", "settings.json"),
    JSON.stringify({
      skillOverrides: { "manual-by-project": "user-invocable-only" },
    }),
  );
  await writeFile(
    join(repo, ".claude", "settings.local.json"),
    JSON.stringify({ skillOverrides: { "on-again": "on" } }),
  );
  await mkdir(join(repo, "app", ".claude"), { recursive: true });
  const found = Object.fromEntries(
    (await discoverClaudeSkills(config, repo)).map((s) => [s.name, s]),
  );
  expect(found["off-by-user"].enabled).toBe(false);
  expect(found["on-again"].enabled).toBe(true);
  expect(found["manual-by-project"].userInvocationOnly).toBe(true);
  await writeFile(
    join(repo, ".claude", "settings.local.json"),
    JSON.stringify({ skillOverrides: { "on-again": "on", "bad-map": true } }),
  );
  const again = await discoverClaudeSkills(config, repo);
  expect(again.find((s) => s.name === "on-again")?.enabled).toBe(false);
});

it("reads the repository root's local settings from a deeper folder, and its plain ones not", () => {
  const app = join(repo, "app");
  expect(skillOverrideFiles(config, app, "linux")).toEqual([
    join(config, "settings.json"),
    join(app, ".claude", "settings.json"),
    join(app, ".claude", "settings.local.json"),
    join(repo, ".claude", "settings.local.json"),
    "/etc/claude-code/managed-settings.json",
  ]);
});

it("reads a relative config folder from the workspace, as the CLI does", async () => {
  await skill(
    join(repo, "relative-config", "skills"),
    "relative-skill",
    "name: x",
  );
  const found = await discoverClaudeSkills("relative-config", repo);
  expect(found.map((s) => [s.name, s.scope])).toEqual([
    ["relative-skill", "user"],
  ]);
});
