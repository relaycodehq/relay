import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { readsOnly } from "../../agent-host/read-only-bash";
import { readOnlyEnv, readOnlyShellPattern, readOnlySettings } from "./amp-review";

/**
 * Whether Amp runs `command` under the rule: it matches with `^` and `$` at
 * every line (`amp permissions test`, Amp 0.0.1793868001).
 */
const ampAllows = (command: string) =>
  new RegExp(readOnlyShellPattern.source, "m").test(command);

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
  "rg -n 'useEffect$' src",
  "rg --glob='*.ts' -e foo",
  "sed -n '40,$p' a.ts",
  "git log --format='%h %s' -5",
  "git log --oneline --no-ext-diff",
  "git show HEAD@{1}",
  "sort -k2 -n a",
  "rg -n -C3 --glob '*.ts' -t ts useEffect src 2>&1",
  "sort -t, -k2,2 -rn data.csv",
  "find . -type f -mtime -1 -size +10k -print",
  "tree -L 2 -I node_modules",
];

/** Flags the shell hands the command in a form a look at the words misses. */
const disguised = [
  "git diff '--output=x'",
  'git diff "--output"=x',
  "git diff --out\"put\"=x",
  "git grep --open-fi=sh foo",
  "git grep -lOsh foo",
  "find . '-delete'",
  "find . -de''lete",
  "find . -\\delete",
  "find . -{delete,true}",
  "find . {-delete,-true}",
  "find . ${X:--delete}",
  "find . $'\\x2ddelete'",
  "find . $IFS-delete",
  "find . -del*",
  "sort '-o' f a",
  "sort -ro f a",
  "sort --out=f a",
  "tree -ao f",
  "rg '--pre=sh' x",
];

const writes = [
  "touch marker.txt",
  "git checkout -- src",
  "git commit -am wip",
  "git branch -D old",
  "git stash",
  "git -c core.pager=sh log",
  "git diff --output=patch.diff",
  "git cat-file --filters HEAD:a.ts",
  "git show --textconv HEAD:a.ts",
  "git status && rm -rf src",
  "rg --pre ./run.sh foo",
  "rg --hostname-bin=./evil.sh --hyperlink-format='file://{host}{path}' TODO .",
  "rg -z hello .",
  "sort -S 1000 --compress-program=./evil.sh package-lock.json",
  "sort --comp=./comp.sh big.txt",
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
  "file -C -m magic",
  "ls;",
  "",
];

/** Each ran a program or wrote in bash or zsh while the pattern took it for a read. */
const splitByTheShell = [
  "rg foo ';echo x' --pre=./evil.sh .",
  "rg foo \"|echo x\" --pre=./evil.sh .",
  "rg foo 'a\necho x' --pre=./evil.sh .",
  "find src \\\necho -delete",
  "rg foo\ntouch pwned",
  "touch pwned\nls",
  "ls\ntouch pwned",
  "sed -n 1p a.ts\ntouch pwned",
  "cat #'\ntouch pwned\n'",
  "git -C ';x' status\ntouch pwned",
];

/** The shell turns these into something else before the command sees its words. */
const expandedByTheShell = [
  "rg foo *",
  "rg foo ''*",
  "rg foo ?-pre=sh",
  "sort *",
  "git diff *",
  "sed -n 1p *",
  "sed -n 1p '-i' f",
  "rg foo \"$X\" .",
  "ls *(e:'touch pwned':)",
  "cat =(touch pwned)",
  "echo ${x@P}",
  "echo ${PATH[_]}",
  "echo $_",
];

it("reads quotes, comments and continued lines as the shell does", () => {
  for (const command of splitByTheShell)
    expect(ampAllows(command), command).toBe(false);
});

it("turns down what the shell expands into flags or code", () => {
  for (const command of expandedByTheShell) {
    expect(readsOnly(command), command).toBe(false);
    expect(ampAllows(command), command).toBe(false);
  }
});

it("keeps quoted separators and quoted dollars that only search", () => {
  for (const command of [
    "rg -n 'foo|bar' src",
    "rg 'a;b' src && git log --format='%h; %s' -3",
    "grep -n \"$HOME\" a.txt",
    "ls src/*.ts",
  ]) {
    expect(readsOnly(command), command).toBe(true);
    expect(ampAllows(command), command).toBe(true);
  }
});

it("lets through what readsOnly does", () => {
  for (const command of reads) {
    expect(readsOnly(command), command).toBe(true);
    expect(ampAllows(command), command).toBe(true);
  }
});

it("turns down whatever readsOnly does", () => {
  for (const command of writes)
    expect(ampAllows(command), command).toBe(false);
});

it("turns down flags spelled to slip past the look", () => {
  for (const command of disguised) {
    expect(readsOnly(command), command).toBe(false);
    expect(ampAllows(command), command).toBe(false);
  }
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

it("writes the settings for reviewers starting together", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "amp-review-"));
  await expect(
    Promise.all([readOnlyEnv(cwd), readOnlyEnv(cwd), readOnlyEnv(cwd)]),
  ).resolves.toHaveLength(3);
});

it("keeps the settings where no other user of a shared /tmp can swap them", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "amp-review-"));
  const { env } = await readOnlyEnv(cwd);
  const dir = dirname(env.AMP_SETTINGS_FILE);
  expect(dir).not.toBe(join(tmpdir(), "relay-amp-read-only"));
  expect((await stat(dir)).mode & 0o077).toBe(0);
});

it("keeps one settings folder for every start, and makes a new one once it's cleared out", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "amp-review-"));
  const first = (await readOnlyEnv(cwd)).env.AMP_SETTINGS_FILE;
  expect((await readOnlyEnv(cwd)).env.AMP_SETTINGS_FILE).toBe(first);
  await rm(dirname(first), { recursive: true });
  const next = (await readOnlyEnv(cwd)).env.AMP_SETTINGS_FILE;
  expect(next).not.toBe(first);
  expect(JSON.parse(await readFile(next, "utf8"))).toHaveProperty("amp.permissions");
});
