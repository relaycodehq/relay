import {
  relayEnv,
  test as relayTest,
  expect,
  _electron as electron,
  type Page,
} from "../fixtures/electron";
import { mkdtemp, mkdir, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { screenshot } from "../fixtures/screenshot";

const test = relayTest.extend<{ composer: Page }>({
  composer: async ({}, use) => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-commands-")),
    );
    const repo = join(root, "project"),
      bin = join(root, "bin");
    await Promise.all([mkdir(repo), mkdir(bin)]);
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    await fakeCli(
      join(bin, "codex"),
      await readFile(resolve("tests/fixtures/composer-codex.cjs"), "utf8"),
    );
    await fakeCli(
      join(bin, "claude"),
      await readFile(resolve("tests/fixtures/slow-claude.cjs"), "utf8"),
    );
    const env = relayEnv();
    const app = await electron.launch({
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: join(root, "data"),
        SLOW_CLAUDE_MODELS: JSON.stringify([
          {
            value: "sonnet",
            displayName: "Claude Test",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high"],
          },
        ]),
      },
    });
    try {
      const page = await app.firstWindow();
      await app.evaluate(({ dialog }, repo) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [repo],
        });
      }, repo);
      await page.evaluate(() => window.relay.addProject());
      await page.reload();
      await use(page);
      const project = (await page.evaluate(() => window.relay.projects()))[0];
      expect(
        await page.evaluate((id) => window.relay.projectChats(id), project.id),
      ).toHaveLength(0);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
});

test("changes effort and plan mode locally, including commands inside a sentence", async ({
  composer: page,
}) => {
  const input = page.getByLabel("Message project");
  await input.fill("/");
  await expect(page.getByRole("listbox", { name: "Commands" })).toBeVisible();
  await expect(
    page.getByRole("option", { name: /skill:explain/i }),
  ).toBeVisible();
  await screenshot(page, {
    path: join(tmpdir(), "relay-composer-commands.png"),
    animations: "disabled",
  });
  await input.fill("/effort hi");
  await expect(
    page.getByRole("option", { name: /\/effort high/ }),
  ).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveText("");
  await expect(
    page.getByRole("combobox", { name: "Reasoning effort", exact: true }),
  ).toContainText("High");
  await input.fill("Fix the bug /eff");
  await input.press("Enter");
  await expect(
    page.getByRole("option", { name: /\/effort high.*Current/ }),
  ).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveText(/^Fix the bug\s*$/);
  await expect(
    page.getByRole("combobox", { name: "Reasoning effort", exact: true }),
  ).toContainText("Extra high");
  await input.fill("Fix the bug");
  for (let i = 0; i < " the bug".length; i++) await input.press("ArrowLeft");
  await input.pressSequentially(" /pla");
  await expect(page.getByRole("option", { name: /\/plan/ })).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveText("Fix the bug");
  await expect(
    page.getByRole("button", { name: "Mode: Plan", exact: true }),
  ).toBeVisible();
  await input.fill("Fix the bug /plan of");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "Mode: Plan", exact: true }),
  ).toHaveCount(0);
  await expect(input).toHaveText(/^Fix the bug\s*$/);
  for (const literal of ["The output lands in /build", "See /usr/lib"]) {
    await input.fill(literal);
    await expect(page.getByRole("listbox", { name: "Commands" })).toHaveCount(
      0,
    );
  }
});

test("switches provider and model from commands without sending the draft", async ({
  composer: page,
}) => {
  const input = page.getByLabel("Message project");
  const model = page.getByRole("button", {
    name: "Choose model and provider",
    exact: true,
  });
  await input.fill("Explain /provider cl");
  await input.press("Enter");
  await expect(model).toContainText("Claude");
  await input.fill("Explain /model sol");
  await input.press("Enter");
  await expect(model).toContainText("GPT-6-Sol");
  await expect(input).toHaveText(/^Explain\s*$/);
});

test("restores a skill pill after undo and reload", async ({
  composer: page,
}) => {
  const input = page.getByLabel("Message project");
  await input.fill("Please use $exp");
  await expect(page.getByRole("option", { name: /explain/i })).toBeVisible();
  await input.press("Tab");
  const pill = input.locator(".prompt-pill.skill");
  await expect(pill).toContainText(/explain/i);
  await input.press("End");
  await input.press("Backspace");
  await input.press("Backspace");
  if (await pill.count()) await input.press("Backspace");
  await expect(pill).toHaveCount(0);
  await input.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(pill).toHaveCount(1);
  await page.reload();
  await expect(pill).toContainText(/explain/i);
});
