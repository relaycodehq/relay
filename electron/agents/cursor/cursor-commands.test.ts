import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
let root: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cursor-home-"));
  root = await mkdtemp(join(tmpdir(), "cursor-root-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all([home, root].map((d) => rm(d, { recursive: true })));
});

const write = async (path: string, text: string) => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
};
const load = () => import("./commands");

describe("Cursor commands on disk", () => {
  it("lists commands and skills, the project's ahead of the user's", async () => {
    await write(
      join(home, ".cursor/commands/review.md"),
      "---\ndescription: Personal review\nargument-hint: <file>\n---\nReview $ARGUMENTS",
    );
    await write(join(root, ".cursor/commands/review.md"), "Project review");
    await write(
      join(home, ".cursor/skills-cursor/goal/SKILL.md"),
      "---\nname: goal\ndescription: Pursue a goal\n---\n# Goal",
    );
    const { cursorFileCommands } = await load();
    const commands = await cursorFileCommands(root);
    expect(commands.map((c) => [c.name, c.source])).toEqual([
      ["goal", "system"],
      ["review", "project"],
    ]);
    expect(commands[0].description).toBe("Pursue a goal");
  });

  it("fills a command's placeholders, or appends what was typed", async () => {
    await write(
      join(root, ".cursor/commands/review.md"),
      "---\ndescription: x\n---\nReview $1 against $2, all: $ARGUMENTS",
    );
    await write(join(root, ".cursor/commands/plain.md"), "Do the thing");
    const { expandCursorCommand } = await load();
    expect(await expandCursorCommand("/review a.ts b.ts", root)).toBe(
      "Review a.ts against b.ts, all: a.ts b.ts",
    );
    expect(await expandCursorCommand("/plain and be quick", root)).toBe(
      "Do the thing\n\nand be quick",
    );
  });

  it("points a skill at its folder and leaves other text alone", async () => {
    await write(
      join(root, ".cursor/skills/ship/SKILL.md"),
      "---\nname: ship\ndescription: Ship it\n---\nSteps",
    );
    const { expandCursorCommand } = await load();
    expect(await expandCursorCommand("/ship now", root)).toContain(
      `${join(root, ".cursor/skills/ship")}.\n\nSteps\n\nnow`,
    );
    expect(await expandCursorCommand("/unknown x", root)).toBe("/unknown x");
    expect(await expandCursorCommand("look at /ship", root)).toBe(
      "look at /ship",
    );
  });
});
