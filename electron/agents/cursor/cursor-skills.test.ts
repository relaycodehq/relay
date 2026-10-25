import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { discoverCursorSkills } from "./skills";

let home: string;
let workspace: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "cursor-skills-home-")));
  workspace = await realpath(
    await mkdtemp(join(tmpdir(), "cursor-skills-ws-")),
  );
});

afterEach(() =>
  Promise.all(
    [home, workspace].map((d) => rm(d, { recursive: true, force: true })),
  ),
);

async function skill(root: string, name: string, text: string) {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, "SKILL.md"), text);
}

it("finds skills at any depth, the project's ahead of the user's", async () => {
  await skill(
    join(home, ".cursor/skills"),
    "review",
    "---\ndescription: user review\n---\n",
  );
  await skill(
    join(workspace, ".agents/skills/nested"),
    "review",
    "---\nname: Review changes\ndescription: project review\n---\n",
  );
  await skill(
    join(workspace, ".cursor/skills"),
    "internal",
    "---\nuser-invocable: false\n---\n",
  );
  await skill(
    join(workspace, ".cursor/skills"),
    "oversized",
    "x".repeat(1_000_001),
  );
  await skill(
    join(workspace, ".claude/skills"),
    "broken",
    "---\nname: [unclosed\n---\n",
  );
  await skill(
    join(workspace, ".claude/skills"),
    "ide-only",
    "---\nmetadata:\n  surfaces: [ide]\n---\n",
  );
  await skill(
    join(home, ".codex/skills"),
    "both",
    "---\nmetadata:\n  surfaces: ide, cli\ndisable-model-invocation: on\n---\n",
  );
  expect(await discoverCursorSkills(workspace, { HOME: home })).toEqual([
    {
      name: "both",
      path: join(home, ".codex/skills/both/SKILL.md"),
      scope: "user",
      enabled: true,
      userInvocationOnly: true,
    },
    {
      name: "internal",
      path: join(workspace, ".cursor/skills/internal/SKILL.md"),
      scope: "project",
      enabled: true,
      userInvocable: false,
    },
    {
      name: "oversized",
      path: join(workspace, ".cursor/skills/oversized/SKILL.md"),
      scope: "project",
      enabled: true,
    },
    {
      name: "review",
      displayName: "Review changes",
      description: "project review",
      path: join(workspace, ".agents/skills/nested/review/SKILL.md"),
      scope: "project",
      enabled: true,
    },
  ]);
});

it("reads a linked skill package's own SKILL.md without walking into it", async () => {
  const library = join(home, "library");
  await skill(library, "shared", "---\ndescription: linked\n---\n");
  await skill(
    join(library, "shared"),
    "inner",
    "---\ndescription: inside\n---\n",
  );
  await mkdir(join(workspace, ".cursor/skills"), { recursive: true });
  await symlink(
    join(library, "shared"),
    join(workspace, ".cursor/skills/shared"),
  );
  const found = await discoverCursorSkills(workspace, {
    HOME: join(home, "nobody"),
  });
  expect(found.map((s) => s.name)).toEqual(["shared"]);
});

it("reads multiline YAML and inline surface restrictions, ignoring non-string surfaces", async () => {
  await skill(
    join(workspace, ".cursor/skills"),
    "review",
    '---\ndescription: "Review code\n  carefully"\nmetadata: { surfaces: [null, 1, cli] }\n---\n',
  );
  await skill(
    join(workspace, ".cursor/skills"),
    "ide-only",
    "---\nmetadata: { surfaces: [ide] }\n---\n",
  );
  const found = await discoverCursorSkills(workspace, { HOME: home });
  expect(found.map((s) => [s.name, s.description])).toEqual([
    ["review", "Review code carefully"],
  ]);
});
