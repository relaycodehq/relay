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
    "rg -n -C3 --glob '*.ts' -t ts useEffect src",
    "rg -iA2 --max-count=5 TODO",
    "sort -t, -k2,2 -rn data.csv",
    "find . -type f -mtime -1 -size +10k -print",
    "tree -L 2 -I node_modules",
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
    // Flags that run a program the reviewed repository may ship.
    "rg --hostname-bin=./scripts/evil.sh --hyperlink-format='file://{host}{path}' TODO .",
    "rg --hostname-bin ./evil.sh --hyperlink-format file://{host}{path} hello .",
    "rg --pre-glob '*.pdf' --pre ./evil.sh x",
    "rg -z hello .",
    "rg --search-zip hello .",
    "rg -nz hello .",
    "sort -S 1000 --compress-program=./scripts/evil.sh package-lock.json",
    "sort --compress-program ./comp.sh big.txt",
    "sort --comp=./comp.sh big.txt",
    "tree -R -H . src",
    "find . -fls /tmp/x",
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
