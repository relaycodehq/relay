import { screenshot } from "../fixtures/screenshot";
import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
test("previews a PR without writing, creates it explicitly and opens its review", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-pr-ui-"))),
    repo = join(root, "project"),
    bin = join(root, "bin");
  const fixture = await fixtureServer({ createPull: true });
  await mkdir(repo);
  await mkdir(bin);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(repo, "test.ts"), "base\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  fixture.setBase(git("rev-parse", "HEAD"));
  git("switch", "-c", "feature");
  await writeFile(join(repo, "test.ts"), "feature\n");
  git("commit", "-qam", "Improve the feature");
  fixture.setHead(git("rev-parse", "HEAD"));
  await writeFile(join(repo, "test.ts"), "keep this local edit\n");
  git("remote", "add", "origin", fixture.serverUrl + "/Web/web-store.git");
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/composer-codex.cjs"), "utf8"),
  );
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_AGENT_CAPTURE: join(root, "capture.jsonl"),
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, repo);
    await page.evaluate(async (url) => {
      await window.relay.connect(url, "test-token");
      await window.relay.addProject();
    }, fixture.serverUrl);
    await page.reload();
    const input = page.getByLabel("Message project");
    await expect(
      page.getByRole("button", { name: "feature", exact: true }),
    ).toBeVisible();
    await input.fill("/openpr");
    await input.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Create pull request" });
    await expect(dialog.getByLabel("PR title")).toHaveValue(
      "Improve the feature",
    );
    await expect(dialog.getByLabel("PR target branch")).toHaveText("main");
    await expect(dialog).toContainText("1 uncommitted file is excluded");
    expect(
      fixture.requests.filter(
        (r) => r.method === "POST" && r.path.endsWith("/pulls"),
      ),
    ).toHaveLength(0);
    const selected = (await page.evaluate(() => window.relay.projects()))[0];
    expect(
      await page.evaluate((id) => window.relay.projectChats(id), selected.id),
    ).toHaveLength(0);
    await dialog.getByLabel("PR title").fill("A useful PR");
    await dialog.getByLabel("PR description").fill("Reviewed locally.");
    await dialog.getByRole("checkbox").check();
    await screenshot(page, {
      path: join(tmpdir(), "relay-create-pr.png"),
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Create PR", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "PR #8 is ready" }),
    ).toBeVisible();
    expect(
      fixture.requests.filter(
        (r) => r.method === "POST" && r.path.endsWith("/pulls"),
      ),
    ).toHaveLength(1);
    expect(
      fixture.requests.find(
        (r) => r.method === "POST" && r.path.endsWith("/pulls"),
      )!.body,
    ).toMatchObject({
      head: "feature",
      base: "main",
      title: "WIP: A useful PR",
      body: "Reviewed locally.",
    });
    expect(await readFile(join(repo, "test.ts"), "utf8")).toBe(
      "keep this local edit\n",
    );
    await page
      .getByRole("button", { name: "Review this PR", exact: true })
      .click();
    // The local edit leads with Commit & push; the PR waits under the arrow.
    await expect(page.locator(".git-actions-main")).toHaveText("Commit & push");
    await page.getByRole("button", { name: "More Git actions" }).click();
    await expect(
      page.getByRole("menuitem", { name: "View PR #8", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[data-pane="changes"] .pane-header'),
    ).toBeVisible();
    const chats = await page.evaluate(
      (id) => window.relay.projectChats(id),
      selected.id,
    );
    expect(chats[0].scope).toMatchObject({ kind: "pr", ref: { number: 8 } });
    expect(
      (await readFile(join(root, "capture.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s))
        .every((c) => c.discovery),
    ).toBe(true);
  } finally {
    await app.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
