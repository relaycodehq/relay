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
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("an answer shows the local images it embeds and drops the ones that don't load", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-images-"))),
    data = join(root, "data"),
    bin = join(root, "bin");
  await mkdir(bin);
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
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
      ...pathWith(env, bin),
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByText("Your project. Your conversation."),
    ).toBeVisible();
    const shot = join(root, "after.png");
    await writeFile(shot, await page.screenshot());
    await writeFile(join(root, "fake.png"), "not an image");

    await page.keyboard.press("ControlOrMeta+Shift+N");
    await page
      .getByLabel("Message project")
      .fill(
        [
          `fixture echo: Before ![](${join(root, "missing.png")}) after:`,
          `![the welcome screen](file://${shot})`,
          `Broken ![](${join(root, "fake.png")}) and remote ![logo](https://example.com/logo.png) done.`,
        ].join("\n\n"),
      );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();

    const answer = page.locator(".project-message.assistant");
    await expect(answer).toContainText("done.");
    const image = answer.getByRole("img", { name: "the welcome screen" });
    await expect(image).toBeVisible();
    expect(
      await image.evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(100);
    // The missing and non-image files leave nothing, not even a placeholder.
    await expect(answer.locator("img")).toHaveCount(1);
    await expect(answer).not.toContainText("[Image");
    await expect(answer.getByRole("link", { name: "logo" })).toBeVisible();
    // Shown in the text, so not again in the strip below it.
    await expect(answer.locator(".message-images")).toHaveCount(0);
    await page.screenshot({ path: "test-results/answer-images.png" });

    await image.click();
    await expect(
      page.getByRole("dialog").getByRole("img", { name: "after.png" }),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
