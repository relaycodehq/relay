import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { openInFileTree } from "../fixtures/navigation";

const modifier = process.platform === "darwin" ? "Meta" : "Control";
const LOCKED = "Save or close the edited file first.";

test("an unsaved file holds every way out with the same message until it's saved", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-lock-"))),
    repo = join(root, "project");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  await mkdir(join(repo, "src"), { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "src/a.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
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
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, repo);
    await page
      .getByRole("button", { name: "Add project folder", exact: true })
      .click();
    await page
      .getByRole("group", { name: "Workspace panes" })
      .getByRole("button", { name: /^Files\b/ })
      .click();
    await openInFileTree(page, "src/a.ts");
    const editor = page
      .locator(".project-inline-editor")
      .getByRole("textbox", { name: "src/a.ts", exact: true });
    await editor.press(`${modifier}+End`);
    await editor.pressSequentially("// unsaved");
    await expect(page.locator(".editor-bar-state")).toHaveText(
      "Unsaved changes",
    );

    const toast = page.locator(".toast.error");
    const dismiss = () =>
      toast.getByRole("button", { name: "Dismiss", exact: true }).click();
    const sidebar = page.getByRole("complementary", { name: "Projects" });
    // The sidebar's buttons stay clickable and say why nothing happened.
    await sidebar
      .getByRole("button", { name: "New thread", exact: true })
      .click();
    await expect(toast.getByRole("alert")).toHaveText(LOCKED);
    await dismiss();
    await sidebar
      .getByRole("button", { name: "Pull requests", exact: true })
      .click();
    await expect(toast.getByRole("alert")).toHaveText(LOCKED);
    await dismiss();
    // So does the keyboard, typed from inside the editor.
    await editor.press(`${modifier}+n`);
    await expect(toast.getByRole("alert")).toHaveText(LOCKED);
    await dismiss();
    await expect(editor).toContainText("// unsaved");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await editor.press(`${modifier}+s`);
    await expect(page.locator(".editor-bar-state")).toHaveText("Saved");
    expect(await readFile(join(repo, "src/a.ts"), "utf8")).toContain(
      "// unsaved",
    );
    await sidebar
      .getByRole("button", { name: "New thread", exact: true })
      .click();
    await expect(toast).toHaveCount(0);
    await expect(page.getByLabel("Message project")).toBeFocused();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
