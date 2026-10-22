import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { discoverAntigravitySkills } from "./skills";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-antigravity-skills-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const write = async (path: string, text: string) => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
};

it("reads its roots in order, a SKILL.md in the root or one folder down", async () => {
  const gemini = join(root, "gemini");
  const cwd = join(root, "ws");
  await write(
    join(gemini, "config/skills/shared/SKILL.md"),
    "---\nname: shared\ndescription: user\n---\n",
  );
  await write(
    join(cwd, ".gemini/skills/shared/SKILL.md"),
    "---\nname: shared\ndescription: project\n---\n",
  );
  await write(
    join(cwd, ".agents/skills/plain/SKILL.md"),
    "---\ndescription: unnamed\n---\n",
  );
  // A root that is itself a skill.
  await write(
    join(cwd, ".agent/skills/SKILL.md"),
    "---\nname: root-skill\n---\n",
  );
  await write(
    join(cwd, ".agents/skills/deep/inner/SKILL.md"),
    "---\nname: too-deep\n---\n",
  );
  await write(join(cwd, ".agents/skills/bad/SKILL.md"), "no frontmatter here");
  expect(
    (await discoverAntigravitySkills(cwd, gemini)).map((s) => [
      s.name,
      s.scope,
      s.description,
    ]),
  ).toEqual([
    ["root-skill", "project", undefined],
    ["shared", "user", "user"],
    // Its loader names a skill without a `name` after the file.
    ["SKILL", "project", "unnamed"],
  ]);
});
