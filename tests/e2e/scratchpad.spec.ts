import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("⌘⇧N opens a Scratchpad chat in a folder of its own, outside Projects", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-scratch-"))),
    data = join(root, "data"),
    bin = join(root, "bin");
  await mkdir(bin);
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
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  const folders = () => readdir(join(data, "Scratchpad")).catch(() => []);
  try {
    const page = await app.firstWindow();
    const headline = page.getByRole("heading", {
      name: "What should we work on in Scratchpad?",
    });
    const sidebar = page.locator(".sb");
    await expect(
      page.getByText("Your project. Your conversation."),
    ).toBeVisible();

    await page.keyboard.press("ControlOrMeta+Shift+N");
    await expect(headline).toBeVisible();
    await expect(sidebar.locator(".sb-scratchpad")).toContainText("New chat");
    await expect(sidebar.locator(".sb-project")).toHaveCount(0);
    expect(await folders()).toHaveLength(1);

    // Leaving it unused and opening another keeps the one folder.
    await page.keyboard.press("ControlOrMeta+Shift+N");
    await expect(headline).toBeVisible();
    expect(await folders()).toHaveLength(1);

    await page.getByLabel("Message project").fill("hello");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("The cache guard prevents duplicate requests."),
    ).toBeVisible();
    await expect(
      sidebar.locator(".sb-scratchpad .sb-thread:not(.sb-ghost)"),
    ).toHaveCount(1);

    // A used folder isn't reused: the next chat gets its own.
    await page.keyboard.press("ControlOrMeta+Shift+N");
    await expect(headline).toBeVisible();
    expect(await folders()).toHaveLength(2);
    await expect(
      sidebar.locator(".sb-scratchpad .sb-thread:not(.sb-ghost)"),
    ).toHaveCount(2);
    await expect(sidebar.locator(".sb-project")).toHaveCount(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
