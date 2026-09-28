import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("works in a folder without Git: threads, files and saves, no Git controls", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-plain-"))),
    folder = join(root, "notes"),
    bin = join(root, "bin");
  await mkdir(folder);
  await mkdir(bin);
  await writeFile(join(folder, "README.md"), "# Notes\n");
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
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, folder);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();

    const prompt = page.getByLabel("Message project");
    await prompt.fill("hello");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("The cache guard prevents duplicate requests."),
    ).toBeVisible();
    // Branches, changes, history and PRs need Git; nothing asks it here.
    for (const name of ["Changes", "History", "Create PR"])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
        0,
      );
    await expect(
      page.locator(".composer-branch-trigger:not(.workspace-trigger)"),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page
      .locator(".project-file-list")
      .getByRole("button", { name: /README\.md/ })
      .click();
    const editor = page
      .locator(".project-inline-editor")
      .getByRole("textbox", { name: "README.md", exact: true });
    await expect(editor).toContainText("# Notes");
    await editor.press("ControlOrMeta+End");
    await editor.pressSequentially("Saved without Git.");
    await page
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    await expect
      .poll(() => readFile(join(folder, "README.md"), "utf8"))
      .toContain("Saved without Git.");
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
