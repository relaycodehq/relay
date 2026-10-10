import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readsOnly } from "../../agent-host/read-only-bash";
import { readOnlyEnv, readOnlyShellPattern, readOnlySettings } from "./amp-review";

const reads = [
  "git status --short",
  "git --no-pager diff main...HEAD -- src",
  "git -C ../other log --oneline -20",
  "git branch --show-current",
  "git branch",
  "git stash list",
  "rg -n 'useEffect' src | head -40",
  "cd electron && git diff HEAD~1 2>/dev/null",
  "git log -p 2>&1 | head -100",
  "sed -n '120,180p' src/app.ts",
  "sed -n 1,20p a.ts b.ts",
  "find src -name '*.test.ts'",
  "ls -la; wc -l src/styles.css",
  "cat a.js\ngit show HEAD:a.js",
];
const writes = [
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
  "find . -exec rm {} ;",
  "sed -i 's/a/b/' file.ts",
  "sed -n '1p;w out' file.ts",
  "cat a > b",
  "cat a >> b",
  "cat a >/dev/nullx",
  "cat < /etc/passwd",
  "echo $(rm -rf src)",
  "echo `id`",
  "npm test",
  "ls | xargs rm",
  "sleep 100 &",
  "ls & rm a",
  "FOO=1 git status",
  "lsof",
  "catalog",
  "sort -o out a",
  "ls;",
  "",
];

it("lets through what readsOnly does", () => {
  for (const command of reads) {
    expect(readsOnly(command), command).toBe(true);
    expect(readOnlyShellPattern.test(command), command).toBe(true);
  }
});

it("turns down whatever readsOnly does", () => {
  for (const command of writes)
    expect(readOnlyShellPattern.test(command), command).toBe(false);
});

it("puts Relay's rules in place of the user's, keeping their other settings", () => {
  const settings = readOnlySettings({
    "amp.permissions": [{ tool: "*", action: "allow" }],
    "amp.commands.allowlist": ["rm"],
    "amp.dangerouslyAllowAll": true,
    "amp.mcpServers": { x: {} },
  });
  expect(settings).not.toHaveProperty("amp.commands.allowlist");
  expect(settings["amp.dangerouslyAllowAll"]).toBe(false);
  expect(settings).toMatchObject({ "amp.mcpServers": { x: {} } });
  expect(settings["amp.permissions"].at(-1)).toMatchObject({ tool: "*", action: "reject" });
});

it("warns when the project's own Amp rules come first", async () => {
  const root = await mkdtemp(join(tmpdir(), "amp-review-"));
  const sub = join(root, "packages", "app");
  await mkdir(join(root, ".amp"), { recursive: true });
  await mkdir(sub, { recursive: true });
  expect((await readOnlyEnv(sub)).warning).toBeUndefined();
  await writeFile(join(root, ".amp", "settings.json"), '{"amp.dangerouslyAllowAll": true}');
  const { env, warning } = await readOnlyEnv(sub);
  expect(warning).toContain(join(root, ".amp", "settings.json"));
  const written = JSON.parse(await readFile(env.AMP_SETTINGS_FILE, "utf8"));
  expect(written["amp.permissions"].at(-1)).toMatchObject({ action: "reject" });
});
