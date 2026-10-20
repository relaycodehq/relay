import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

test("project setup keeps computer choice in the flow and opens a selected folder", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-project-setup-")),
  );
  const folder = join(root, "web");
  await mkdir(folder);
  await mkdir(join(folder, "src"));
  await writeFile(join(folder, "README.md"), "Preview fixture");
  execFileSync("git", ["-C", folder, "init", "-q", "-b", "main"]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) =>
        k !== "ELECTRON_RUN_AS_NODE" &&
        k !== "RELAY_DEV_URL" &&
        v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Add a project",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "This computer", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await dialog
      .getByRole("button", { name: "Another computer", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Choose a computer" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: "Computer", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Clone a repository", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Clone from a URL…", exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: "Repository", exact: true })
      .fill("acme/web");
    const destination = dialog.getByRole("textbox", {
      name: "Destination folder",
    });
    // Typing through the home folder keeps what was typed, not a ~ for it.
    await destination.fill("");
    await destination.pressSequentially(`${homedir()}x`);
    await expect(destination).toHaveValue(`${homedir()}x`);
    await destination.fill(root);
    await dialog
      .getByRole("button", { name: "This computer", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      dialog.getByRole("textbox", { name: "Repository", exact: true }),
    ).toHaveValue("acme/web");
    await expect(
      dialog.getByRole("textbox", { name: "Destination folder" }),
    ).toHaveValue(root);
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Open a folder", exact: true })
      .click();
    const folderPath = dialog.getByRole("textbox", { name: "Folder path" });
    await folderPath.fill("~");
    await dialog.getByRole("button", { name: "Go", exact: true }).click();
    await dialog.getByRole("button", { name: "Parent folder" }).click();
    await expect(folderPath).not.toHaveValue("~");
    await folderPath.fill(root);
    await dialog.getByRole("button", { name: "Go", exact: true }).click();
    await dialog.getByRole("button", { name: "web", exact: true }).click();
    const contents = dialog.getByLabel("Contents of web", { exact: true });
    await expect(contents.getByText("src", { exact: true })).toBeVisible();
    await expect(
      contents.getByText("README.md", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "web", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({
      path: join(tmpdir(), "relay-project-setup-folder.png"),
    });
    await dialog.getByRole("button", { name: "Open web", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.relay.projects()).map((p) => p.path),
        ),
      )
      .toEqual([folder]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
