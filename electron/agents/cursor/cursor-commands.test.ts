import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
let root: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "cursor-home-")));
  root = await realpath(await mkdtemp(join(tmpdir(), "cursor-root-")));
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
  it("lists commands, the project's ahead of the user's", async () => {
    await write(
      join(home, ".cursor/commands/review.md"),
      "---\ndescription: Personal review\nargument-hint: <file>\n---\nReview $ARGUMENTS",
    );
    await write(join(root, ".cursor/commands/review.md"), "Project review");
    await write(
      join(home, ".claude/commands/plan.md"),
      "---\ndescription: Plan\n---\nPlan it",
    );
    const { cursorFileCommands } = await load();
    expect(
      (await cursorFileCommands(root)).map((c) => [
        c.name,
        c.source,
        c.description,
      ]),
    ).toEqual([
      ["plan", "personal", "Plan"],
      ["review", "project", "Project review"],
    ]);
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

describe("Cursor's prompt", () => {
  const skill = (name: string, flags = "") =>
    write(
      join(root, ".cursor/skills", name, "SKILL.md"),
      `---\n${flags}description: x\n---\n${name.toUpperCase()} STEPS`,
    );

  it("swaps a `$skill` for its text wherever it is in the message", async () => {
    await skill("review");
    await skill("ship");
    const { cursorPrompt } = await load();
    // At the start, in the middle, and as the second of two.
    expect(await cursorPrompt("$review src/a.ts", root)).toContain(
      "REVIEW STEPS\n\nsrc/a.ts",
    );
    const mid = await cursorPrompt("please use $review on src/a.ts", root);
    expect(mid).toMatch(/^please use\n\nFollow the "review" skill/);
    expect(mid).toContain("REVIEW STEPS\n\non src/a.ts");
    const two = await cursorPrompt("$ship it, then $review", root);
    expect(two).toMatch(/^\/ship it, then\n\nFollow the "review" skill/);
  });

  it("expands the picked skill instead of a command with the same name", async () => {
    await skill("review");
    await write(join(root, ".cursor/commands/review.md"), "COMMAND STEPS");
    const { cursorPrompt, expandCursorCommand } = await load();
    expect(await cursorPrompt("$review src/a.ts", root)).toContain(
      "REVIEW STEPS\n\nsrc/a.ts",
    );
    expect(await expandCursorCommand("/review src/a.ts", root)).toBe(
      "COMMAND STEPS\n\nsrc/a.ts",
    );
  });

  it("expands multiline skill arguments without including Relay's notes", async () => {
    await skill("review");
    const { cursorPrompt } = await load();
    const request = "$review\nsrc/a.ts\nFocus on auth";
    const result = await cursorPrompt(
      `My request: ${request}\nRelay's note`,
      root,
      request,
    );
    expect(result).toMatch(/^My request:\nRelay's note\n\nFollow the "review"/);
    expect(result.endsWith("REVIEW STEPS\n\nsrc/a.ts\nFocus on auth")).toBe(
      true,
    );
  });

  it("leaves what Relay adds out of the skill's arguments, and `$HOME`, switched-off and agent-only skills as text", async () => {
    await skill("review");
    await skill("internal", "user-invocable: false\n");
    const { cursorPrompt } = await load();
    const framed = await cursorPrompt(
      "My request: $review src\nRelay's note",
      root,
      "$review src",
    );
    expect(framed).toMatch(/^My request:\nRelay's note\n\nFollow the "review"/);
    expect(framed.endsWith("REVIEW STEPS\n\nsrc")).toBe(true);
    for (const text of ["cd $HOME", "use $internal here"])
      expect(await cursorPrompt(text, root)).toBe(text);
  });
});
