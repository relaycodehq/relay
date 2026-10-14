import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setProfilesRoot } from "../../accounts";
import { listClaudeCommands, pickableClaudeSkills } from "./catalog";

vi.mock("./sdk", () => ({
  chromeArgs: {},
  readSettings: async () => undefined,
  // The CLI lists a project skill as a command too, besides its own commands.
  withProbe: async (_: unknown, work: (stream: object) => unknown) =>
    work({
      supportedCommands: async () => [
        { name: "cost", description: "Show the cost", argumentHint: "" },
        {
          name: "relay-manual",
          description: "manual (project)",
          argumentHint: "",
        },
      ],
    }),
}));

let root: string;
let repo: string;
const env = process.env.CLAUDE_CONFIG_DIR;
async function skill(dir: string, name: string, frontmatter = `name: ${name}`) {
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(
    join(dir, name, "SKILL.md"),
    `---\n${frontmatter}\n---\nBody`,
  );
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-claude-catalog-"));
  repo = join(root, "repo");
  await mkdir(join(repo, ".git"), { recursive: true });
  setProfilesRoot(join(root, "profiles"));
  process.env.CLAUDE_CONFIG_DIR = join(root, "usual");
});
afterEach(async () => {
  if (env === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = env;
  await rm(root, { recursive: true, force: true });
});

it("lists a skill once, as the skill, and keeps the commands that aren't skills", async () => {
  await skill(
    join(repo, ".claude/skills"),
    "relay-manual",
    "disable-model-invocation: true",
  );
  await skill(
    join(repo, ".claude/skills"),
    "relay-agent",
    "user-invocable: false",
  );
  expect(await listClaudeCommands(repo)).toEqual([
    { name: "cost", source: "claude", description: "Show the cost" },
    {
      name: "relay-manual",
      skill: true,
      source: "project",
      description: "project skill",
    },
  ]);
});

it("reads a thread's skills from its own account, not the one in use", async () => {
  await skill(join(root, "usual/skills"), "from-usual");
  await skill(join(root, "profiles/claude/work/skills"), "from-work");
  expect([...(await pickableClaudeSkills(repo))]).toEqual(["from-usual"]);
  expect([...(await pickableClaudeSkills(repo, "work"))]).toEqual([
    "from-work",
  ]);
});
