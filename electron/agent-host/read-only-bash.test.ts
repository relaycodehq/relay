import { expect, it } from "vitest";
import { readOnlyBashHook, readsOnly } from "./read-only-bash";

it("lets the commands a reviewer reads with through", () => {
  for (const command of [
    "git status --short",
    "git --no-pager diff main...HEAD -- src",
    "git -C ../other log --oneline -20",
    "git branch --show-current",
    "git stash list",
    "rg -n 'useEffect' src | head -40",
    "cd electron && git diff HEAD~1 2>/dev/null",
    "sed -n '120,180p' src/app.ts",
    "find src -name '*.test.ts'",
    "ls -la; wc -l src/styles.css",
  ])
    expect(readsOnly(command), command).toBe(true);
});

it("turns down anything that writes, runs or hides another command", () => {
  for (const command of [
    "touch marker.txt",
    "git checkout -- src",
    "git commit -am wip",
    "git branch -D old",
    "git stash",
    "git -c core.pager=sh log",
    "git diff --output=patch.diff",
    "git status && rm -rf src",
    "rg --pre ./run.sh foo",
    "find . -name '*.tmp' -delete",
    "sed -i 's/a/b/' file.ts",
    "sed -n '1p;w out' file.ts",
    "cat a > b",
    "echo $(rm -rf src)",
    "echo `id`",
    "npm test",
    "file -C -m magic",
    "ls | xargs rm",
    "sleep 100 &",
    "FOO=1 git status",
    "",
  ])
    expect(readsOnly(command), command).toBe(false);
});

it("leaves other tools to the usual checks", async () => {
  expect(await readOnlyBashHook({ tool_name: "Read", tool_input: {} })).toEqual(
    {},
  );
  expect(
    await readOnlyBashHook({
      tool_name: "Bash",
      tool_input: { command: "touch marker.txt" },
    }),
  ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
});
