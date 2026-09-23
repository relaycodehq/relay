import { test, expect, _electron as electron } from "@playwright/test";
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
test("runs slash actions locally, previews a PR, creates it explicitly and opens its review", async () => {
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
  await writeFile(
    join(bin, "codex"),
    `#!${process.execPath}\n` +
      (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8")),
    { mode: 0o700 },
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      PATH: bin + ":" + env.PATH,
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
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
    await expect(page.locator(".composer-branch-trigger")).toContainText(
      "feature",
    );
    await input.fill("/");
    await expect(page.getByRole("listbox", { name: "Commands" })).toBeVisible();
    await expect(
      page.getByRole("option", { name: /skill:Explain/ }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/screenshots/55-slash-commands.png",
      animations: "disabled",
    });
    await input.fill("/effort hi");
    await expect(
      page.getByRole("option", { name: /\/effort high/ }),
    ).toBeVisible();
    await input.press("Enter");
    await expect(input).toHaveText("");
    await expect(
      page.getByRole("combobox", { name: "Reasoning effort" }),
    ).toContainText("High");
    // Settings commands work mid-sentence and take out only their own text.
    await input.fill("Fix the bug /eff");
    await input.press("Enter");
    await expect(
      page.getByRole("option", { name: /\/effort high.*Current/ }),
    ).toHaveAttribute("aria-selected", "true");
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(input).toHaveText(/^Fix the bug\s*$/);
    await expect(
      page.getByRole("combobox", { name: "Reasoning effort" }),
    ).toContainText("Extra high");
    await input.fill("Fix the bug");
    for (let i = 0; i < " the bug".length; i++) await input.press("ArrowLeft");
    await input.pressSequentially(" /pla");
    await expect(page.getByRole("option", { name: /\/plan/ })).toBeVisible();
    await input.press("Enter");
    await expect(input).toHaveText("Fix the bug");
    await expect(
      page.getByRole("button", { name: /^Plan mode/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await input.fill("Fix the bug /bui");
    await input.press("Enter");
    await expect(
      page.getByRole("button", { name: /^Default mode/ }),
    ).toBeVisible();
    const model = page.getByRole("button", {
      name: "Choose model and provider",
    });
    await input.fill("Explain /provider cl");
    await input.press("Enter");
    await expect(model).toContainText("Claude");
    await input.fill("Explain /model sol");
    await input.press("Enter");
    await expect(model).toContainText("GPT-6-Sol");
    await expect(input).toHaveText(/^Explain\s*$/);
    await input.fill("See /usr/lib");
    await expect(page.getByRole("listbox", { name: "Commands" })).toHaveCount(
      0,
    );
    await input.fill("Please use $exp");
    await expect(page.getByRole("option", { name: /Explain/ })).toBeVisible();
    await input.press("Tab");
    await expect(input.locator(".composer-skill-chip")).toContainText(
      "Explain",
    );
    await input.press("End");
    await input.press("Backspace");
    await input.press("Backspace");
    if (await input.locator(".composer-skill-chip").count())
      await input.press("Backspace");
    await expect(input.locator(".composer-skill-chip")).toHaveCount(0);
    await input.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(input.locator(".composer-skill-chip")).toHaveCount(1);
    await page.reload();
    await expect(input.locator(".composer-skill-chip")).toContainText(
      "Explain",
    );
    await input.fill("/openpr");
    await input.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Create pull request" });
    await expect(dialog.getByLabel("PR title")).toHaveValue(
      "Improve the feature",
    );
    await expect(dialog.getByLabel("PR target branch")).toHaveValue("main");
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
    await page.screenshot({
      path: "test-results/screenshots/56-create-pr.png",
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
    await expect(
      page.getByRole("button", { name: "PR #8 ↗", exact: true }),
    ).toBeVisible();
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
